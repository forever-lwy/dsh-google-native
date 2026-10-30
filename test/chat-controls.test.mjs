import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionStore, SessionSeq, buildForkSeed } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { registerGoogleChatControls } from '../lib/chat-controls.js'
import { chatRemoteInfo, readChatChoices } from '../lib/chat-remote.js'
import { defaultProfile } from '../lib/config.js'

const provider = 'google-ai-studio'
const model = 'gemini-3.8-flash'
const choices = { nativeFiles: false, search: true, urlContext: false, codeExecution: false, maps: false }
const signal = () => new AbortController().signal

function fixture(seed = [], actualRegistry = false) {
  const ctx = new Context()
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  const session = ctx.sessions.create(SessionId(`chat-test-${Math.random()}`), { seed })
  const profiles = { [provider]: defaultProfile(provider), 'google-vertex-native': defaultProfile('google-vertex-native') }
  let flushes = 0
  ctx.on('session/flush', () => { flushes++ })
  const descriptors = []
  if (actualRegistry) new TypertRegistry(ctx)
  else ctx.provide('typert', { remotes: { register(info) { descriptors.push(...info.descriptors); return async () => {} } } })
  const agent = { id: session.id, session, status: 'idle', inbox: { replace() { return false } } }
  ctx.provide('sessionController', {
    async resolveAgent(id) { return id === session.id ? { agent } : { error: new Error('wrong session') } },
    async inspect() { throw new Error('wrong session') },
  })
  const controls = registerGoogleChatControls(ctx, () => profiles)
  const request = { sessionId: session.id, provider, model }
  return { ctx, session, profiles, agent, controls, request, descriptors, flushes: () => flushes }
}

test('per-session options save complete durable preferences and await the normal flush checkpoint', async () => {
  const one = fixture()
  const before = await one.controls.get(one.request, signal())
  assert.equal(before.choices.nativeFiles, true)
  assert.equal(before.choices.search, false)
  assert.equal(before.revision, 0)
  const after = await one.controls.set({ ...one.request, choices, expectedRevision: 0 }, signal())
  assert.equal(after.revision, 1)
  assert.deepEqual(after.choices, choices)
  assert.equal(one.flushes(), 1)
  assert.deepEqual((await one.controls.get(one.request, signal())).choices, choices)
  assert.equal(one.session.snapshotEvents().at(-1).type, 'plugin:dsh-google-native/chat-controls')
  const two = fixture()
  assert.equal((await two.controls.get(two.request, signal())).choices.search, false)
})

test('enqueue captures immutable exact choices while retaining RPC identity, caller and timezone', async () => {
  const instance = fixture()
  await instance.controls.set({ ...instance.request, choices, expectedRevision: 0 }, signal())
  const prompt = createUserMessage({ source: { kind: 'user', rpcId: 'rpc-original', principal: { kind: 'agent', id: 'caller' }, clientTimeZone: 'Asia/Shanghai' }, content: [{ type: 'text', text: 'Read attachment' }] })
  let replacements = 0
  let stamped
  instance.agent.inbox.replace = (id, message) => {
    replacements++
    assert.equal(id, prompt.id)
    stamped = message
    instance.controls.stamp(instance.agent, message)
    return true
  }
  instance.controls.stamp(instance.agent, prompt)
  assert.equal(replacements, 1, 'replacement notifications cannot recursively restamp')
  assert.equal(stamped.id, prompt.id)
  assert.equal(stamped.source.rpcId, 'rpc-original')
  assert.deepEqual(stamped.source.principal, prompt.source.principal)
  assert.equal(stamped.source.clientTimeZone, 'Asia/Shanghai')
  assert.ok(Object.isFrozen(stamped.source.googleNative.selections[0].choices))
  assert.deepEqual(readChatChoices(stamped.source, provider, model), choices)
  await instance.controls.set({ ...instance.request, choices: { ...choices, nativeFiles: true, search: false }, expectedRevision: 1 }, signal())
  assert.deepEqual(readChatChoices(stamped.source, provider, model), choices, 'later UI edits cannot alter queued prompts')
  assert.equal(readChatChoices(stamped.source, 'foreign-provider', model), undefined)
  assert.ok(!('googleNative' in prompt.source), 'original frozen input remains unchanged')
})

test('serialized preferences and accepted prompt source survive restore and an actual fork seed', async () => {
  const instance = fixture()
  await instance.controls.set({ ...instance.request, choices, expectedRevision: 0 }, signal())
  let stamped
  instance.agent.inbox.replace = (_id, message) => { stamped = message; return true }
  instance.controls.stamp(instance.agent, createUserMessage({ source: { kind: 'user', rpcId: 'rpc' }, content: [{ type: 'text', text: 'Hi' }] }))
  instance.session.append('user/message', stamped, { surfaceOp: 'append' })
  const seed = JSON.parse(JSON.stringify(instance.session.snapshotEvents()))
  const restored = fixture(seed)
  assert.deepEqual((await restored.controls.get(restored.request, signal())).choices, choices)
  const durableSource = restored.session.deriveMessages().at(-1).source
  assert.deepEqual(readChatChoices(durableSource, provider, model), choices)
  const forkSeed = buildForkSeed(instance.session.snapshotEvents(), SessionSeq(instance.session.seq - 1))
  const forked = Session.create(SessionId('forked-chat'), forkSeed, { ...instance.session.header, id: SessionId('forked-chat'), isSeeded: true, parentSession: instance.session.id }, instance.session.seq)
  assert.deepEqual(readChatChoices(forked.deriveMessages().at(-1).source, provider, model), choices)
})

test('busy saves, stale revisions, unsupported flags and unconfigured models are refused without append', async () => {
  const instance = fixture()
  const start = instance.session.seq
  instance.agent.status = 'running'
  await assert.rejects(instance.controls.set({ ...instance.request, choices, expectedRevision: 0 }, signal()), error => error.code === 'session/agent-busy')
  instance.agent.status = 'idle'
  await assert.rejects(instance.controls.set({ ...instance.request, choices, expectedRevision: 4 }, signal()), error => error.code === 'native-google/conflict')
  instance.profiles[provider].models.find(entry => entry.id === model).capabilities = { search: false }
  await assert.rejects(instance.controls.set({ ...instance.request, choices, expectedRevision: 0 }, signal()), error => error.code === 'gateway/bad-request')
  await assert.rejects(instance.controls.set({ ...instance.request, model: 'unconfigured', choices: { ...choices, search: false }, expectedRevision: 0 }, signal()), error => error.code === 'gateway/bad-request')
  await assert.rejects(instance.controls.get({ ...instance.request, sessionId: 'another-session' }, signal()), /wrong session/)
  assert.equal(instance.session.seq, start)
})

test('strict Remote descriptors and method resources address only the requested session', () => {
  const instance = fixture()
  for (const method of ['get', 'set']) {
    const descriptor = instance.descriptors.find(item => item.method === method)
    assert.equal(descriptor.namespace, 'nativeGoogleChat')
    assert.equal(descriptor.service, 'nativeGoogleChat')
    assert.equal(descriptor.parameters[0].codec.mode, 'strict')
    const marker = remoteMethods(instance.controls).find(item => item.method === method)
    assert.equal(marker.resources.session(instance.request), instance.session.id)
  }
  const schema = chatRemoteInfo.methods['nativeGoogleChat/set'].input({ strict: true }).create()
  assert.throws(() => schema.parse({ request: { ...instance.request, choices, expectedRevision: 0, apiKey: 'not-accepted' } }))
  assert.throws(() => schema.parse({ request: { ...instance.request, choices: { ...choices, search: 'true' }, expectedRevision: 0 } }))
})

test('invalid capability descriptions fail closed in the durable source snapshot', () => {
  const instance = fixture()
  instance.profiles[provider].models.find(entry => entry.id === model).generationConfig = { tools: {} }
  let stamped
  instance.agent.inbox.replace = (_id, message) => { stamped = message; return true }
  instance.controls.stamp(instance.agent, createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hi' }] }))
  assert.deepEqual(readChatChoices(stamped.source, provider, model), { nativeFiles: false, search: false, urlContext: false, codeExecution: false, maps: false })
})

test('actual rc.5 Gateway checks the exact requested session before dispatching controls', async () => {
  const instance = fixture([], true)
  const decisions = []
  instance.ctx.provide('remoteAccess', { decide(input) {
    decisions.push(input)
    return input.resources.every(resource => resource.kind === 'session' && resource.id === instance.session.id)
      ? { kind: 'allow' } : { kind: 'deny', reason: 'not-authorized' }
  } })
  const gateway = new TypertGatewayService(instance.ctx, {})
  const peer = { id: 'peer-test', ctx: instance.ctx, principal: { kind: 'external-test' }, signal: signal(), interactions: 'none', async dispose() {} }
  const result = await gateway.invoke({ namespace: 'nativeGoogleChat', method: 'get', args: { request: instance.request }, peer })
  assert.equal(result.model, model)
  assert.deepEqual(decisions[0].resources, [{ kind: 'session', id: instance.session.id }])
  await assert.rejects(gateway.invoke({ namespace: 'nativeGoogleChat', method: 'get', args: { request: { ...instance.request, sessionId: 'forbidden-session' } }, peer }), error => error.code === 'remote-access/denied')
  assert.deepEqual(decisions[1].resources, [{ kind: 'session', id: 'forbidden-session' }])
})

test('reading attached or cold options never activates an Agent or drains pending work', async () => {
  const instance = fixture()
  await instance.controls.set({ ...instance.request, choices, expectedRevision: 0 }, signal())
  const stored = JSON.parse(JSON.stringify(instance.session.snapshotEvents()))
  let activations = 0
  let inspections = 0
  instance.ctx.sessionController.resolveAgent = async () => { activations++; throw new Error('read must not activate an Agent') }
  instance.ctx.sessionController.inspect = async (id, suppliedSignal) => {
    inspections++
    assert.equal(id, 'cold-with-pending-work')
    assert.ok(suppliedSignal)
    return { meta: { ...instance.session.header, id }, inheritedEventCount: 0, events: stored }
  }
  assert.deepEqual((await instance.controls.get(instance.request, signal())).choices, choices)
  assert.equal(inspections, 0, 'attached reads use the current projection')
  const cold = await instance.controls.get({ ...instance.request, sessionId: 'cold-with-pending-work' }, signal())
  assert.deepEqual(cold.choices, choices)
  assert.equal(cold.revision, 1)
  assert.equal(inspections, 1)
  assert.equal(activations, 0)
  assert.equal(instance.ctx.sessions.get(SessionId('cold-with-pending-work')), undefined)
})
