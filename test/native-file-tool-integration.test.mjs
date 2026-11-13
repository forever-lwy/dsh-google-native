import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { chmod, copyFile, link, mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry, agentEvents, assembleContextFor } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as PtcToolExecutor from '@deepseek-ai/dsh-tool-executor-ptc'
import { AssistantStreamAccumulator, BlockAssembler, LlmRuntime, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { GoogleNativeAdapter } from '../lib/adapter.js'
import { defaultProfile } from '../lib/config.js'
import { registerNativeFileBridge } from '../lib/file-scope.js'
import { registerNativeFileTool } from '../lib/native-file-tool.js'
import * as GooglePlugin from '../lib/index.js'

const TOOL = 'google_native_attach_file'
const MODEL = 'offline-native-file-model'
const providers = ['google-ai-studio', 'google-vertex-native']
const originalFetch = globalThis.fetch
const nativeClarification = 'Available file contents are attached natively below. The local-path note above concerns local file tools only.'
const pdf = Buffer.from('%PDF-1.7\n\0original binary document\xff', 'latin1')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64')
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.from([0, 255, 0, 128])])
const video = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.from([0, 0, 0, 0]), Buffer.from('isommp42mdat'), Buffer.from([0, 255, 42])])

class OfflineQueries extends SessionQueryEngine {
  async searchSessions() { throw new Error('Search is outside this fixture') }
  async searchEvents() { throw new Error('Search is outside this fixture') }
}

/** Real rc.5 registries, session persistence and Google SDK. Only the filesystem,
 * attachment backend, PTC program substrate and driver sequencing are fixtures.
 * No parser, submodel, live API, deployment profile or resident service is used.
 */
async function fixture(t, { provider = providers[0], model = MODEL, mode = 'native', path = 'report.pdf', bytes = pdf,
  inputTypes = ['text', 'image', 'audio', 'video', 'pdf'], enabled = true, nativeCapability = true, humanUpload = false, mountPlugin = false, mapped = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-native-file-tool-'))
  const hostStorage = await mkdtemp(join(tmpdir(), 'dsh-native-file-objects-'))
  const executionStorage = join(directory, 'readonly-attachments')
  await mkdir(executionStorage)
  await writeFile(join(directory, path), bytes)
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }); await rm(hostStorage, { recursive: true, force: true }) })
  new LlmRuntime(ctx)
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  new AgentRegistry(ctx)
  new OfflineQueries(ctx)
  new SystemPrompt(ctx, { includeHarnessIdentity: false })
  const rawReads = [], parserReads = [], writes = [], stored = new Map(), readIds = []
  const attachmentPaths = new Map()
  const locations = new Map()
  let onRawRead, afterNested
  const digest = data => createHash('sha256').update(data).digest('hex')
  async function remember(data, name) {
    const copy = Buffer.from(data)
    const ref = { attachmentId: digest(copy), name: name ?? 'file', bytes: copy.length }
    if (!attachmentPaths.has(ref.attachmentId)) {
      const paths = { host: join(hostStorage, ref.attachmentId), execution: join(executionStorage, ref.attachmentId) }
      await writeFile(paths.host, copy, { mode: 0o444, flag: 'wx' })
      await link(paths.host, paths.execution)
      attachmentPaths.set(ref.attachmentId, paths)
    }
    stored.set(ref.attachmentId, copy)
    return ref
  }
  ctx.provide('attachments', {
    fileHostPath: ref => attachmentPaths.get(ref.attachmentId)?.host,
    async saveFile(input) { const ref = await remember(input.data, input.name); writes.push(ref); return ref },
    async saveFileStream(input) {
      const chunks = []
      for await (const chunk of input.data) { input.signal?.throwIfAborted(); chunks.push(Buffer.from(chunk)) }
      input.signal?.throwIfAborted()
      const ref = await remember(Buffer.concat(chunks), input.name)
      writes.push(ref)
      return ref
    },
    async *readFileStream(ref, signal) {
      signal?.throwIfAborted()
      assert.ok(attachmentPaths.has(ref.attachmentId), 'the request reads an attachment committed by the tool')
      const data = await readFile(attachmentPaths.get(ref.attachmentId).host)
      assert.equal(digest(data), ref.attachmentId)
      assert.equal(data.length, ref.bytes)
      readIds.push(ref.attachmentId)
      yield data.subarray(0, 7)
      signal?.throwIfAborted()
      yield data.subarray(7)
    },
    async saveImage() { throw new Error('Native file inputs must not use image normalization') },
    async readImage() { throw new Error('Native file inputs must retain original bytes') },
  })
  ctx.provide('fs', {
    async resolve(pathname, options = {}) {
      options.signal?.throwIfAborted()
      const canonical = await realpath(resolve(options.cwd ?? directory, pathname))
      const target = { targetKey: `opaque:${digest(canonical)}`, displayPath: canonical }
      locations.set(target.targetKey, canonical)
      return target
    },
    contains(parent, child) {
      const name = relative(locations.get(parent.targetKey), locations.get(child.targetKey))
      return name === '' || (!isAbsolute(name) && name !== '..' && !name.startsWith(`..${sep}`))
    },
    async stat(target, signal) {
      signal?.throwIfAborted()
      const info = await stat(locations.get(target.targetKey))
      return { version: `${info.mtimeMs}:${info.size}`, type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', size: info.size }
    },
    async readByteRange(target, range, signal) {
      rawReads.push({ target, range })
      await onRawRead?.(signal)
      signal?.throwIfAborted()
      const handle = await open(locations.get(target.targetKey), 'r')
      try {
        const data = Buffer.alloc(range.length)
        const { bytesRead } = await handle.read(data, 0, range.length, range.offset)
        signal?.throwIfAborted()
        return data.subarray(0, bytesRead)
      } finally { await handle.close() }
    },
    async readBytes(target, signal, limit) {
      rawReads.push({ target, limit })
      await onRawRead?.(signal)
      signal?.throwIfAborted()
      const data = await readFile(locations.get(target.targetKey))
      assert.ok(data.length <= limit)
      return data
    },
    async readText() { parserReads.push('text'); throw new Error('No text parser is part of native attachment delivery') },
    async streamText() { parserReads.push('stream'); throw new Error('No text parser is part of native attachment delivery') },
    processPath() { throw new Error('The tool must use the mounted filesystem capability') },
    processPathFromHostPath: hostPath => mapped ? [...attachmentPaths.values()].find(paths => paths.host === hostPath)?.execution : undefined,
  })
  ctx.provide('workingDirectory', { get: () => directory, ensure: async () => directory })
  const profiles = Object.fromEntries(providers.map(id => [id, defaultProfile(id)]))
  for (const profile of Object.values(profiles)) {
    profile.baseURL = `https://offline.test/${profile.provider}`
    profile.vertexAuth = 'api-key'
    profile.enabled = enabled
    profile.models = [{ id: MODEL, inputTypes, capabilities: { nativeFiles: nativeCapability } }]
  }
  const requests = [], results = [], injections = []
  const code = `return await tools.${TOOL}({path:${JSON.stringify(path)}});`
  if (mode === 'ptc') ctx.provide('ptcRuntime', {
    language: 'typescript', isolation: 'offline-fixture', programFormat: 'function-body',
    release: async () => {},
    resolve: input => ({ ...input, cwd: input.cwd ?? directory, timeoutMs: input.timeoutMs ?? null }),
    async run(spec) {
      assert.equal(spec.program, code, 'the fixture runs only its known program')
      const tools = spec.bindings.find(namespace => namespace.global === 'tools').functions
      try {
        // The program substrate is simulated; run_code, its binding, nested
        // registry dispatch, final policies and context delivery are real.
        const value = await tools[TOOL]({ path })
        await afterNested?.(spec, value)
        return { logs: [], value }
      } catch (error) { return { logs: [], error: { kind: 'exception', message: error.message } } }
    },
  })
  new ToolRuntime(ctx)
  await ctx.plugin(mode === 'ptc' ? PtcToolExecutor : NativeToolExecutor)
  let pluginFiber
  if (mountPlugin) {
    ctx.provide('credentials', { resolve: async () => ({ value: 'offline-test-key' }) })
    const plain = profile => { const { provider: _provider, ...value } = profile; return value }
    pluginFiber = await ctx.plugin(GooglePlugin, { aiStudio: plain(profiles[providers[0]]), vertex: plain(profiles[providers[1]]) })
    await new Promise(resolve => setImmediate(resolve))
  } else {
    const adapter = new GoogleNativeAdapter(ctx, { profiles: () => profiles, resolveApiKey: async () => 'offline-test-key' })
    ctx.llm.registerAdapter(providers, adapter)
    registerNativeFileBridge(ctx)
    registerNativeFileTool(ctx, () => profiles)
  }
  const session = ctx.sessions.create(SessionId(`native-tool-${provider}-${mode}-${Math.random()}`), { meta: { cwd: directory } })
  const pending = []
  const agent = { id: session.id, session, options: { provider, model }, status: 'running',
    inject(input) { const message = input.id ? input : createUserMessage(input); pending.push(message); injections.push(message); return message.id },
    inbox: { get nextStep() { return pending }, nextTurn: [], replace() { return false } },
  }
  const scope = createScope(ctx, agent)
  agent.ctx = scope.ctx
  await ctx.agents.register(agent)
  const executionResults = []
  ctx.on('tools/result', (exec, result) => { executionResults.push({ exec, result }) })
  session.append('request/header', { header: { config: { provider, model } }, reason: 'initial' })
  const userFile = humanUpload ? await remember(Buffer.from('%PDF-1.7\nordinary human upload'), 'human-upload.pdf') : undefined
  const human = createUserMessage({ source: { kind: 'user', googleNative: { version: 1, selections: [{ provider, model,
    choices: { nativeFiles: false, search: false, urlContext: false, codeExecution: false, maps: false } }] } },
    content: [{ type: 'text', text: 'Use the native attachment tool to inspect the workspace file.' },
      ...(userFile ? [{ type: 'file', attachment: userFile }] : [])],
  })
  session.append('user/message', human, { surfaceOp: 'append' })
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.match(String(url), /offline\.test/)
    assert.match(String(url), /:streamGenerateContent/)
    const request = JSON.parse(init.body)
    requests.push({ url: String(url), body: request })
    assert.match(new Headers(init.headers).get('user-agent'), /deepseek-harness/)
    const parts = requests.length === 1 ? [{ functionCall: { id: 'offline-native-call', name: mode === 'ptc' ? 'run_code' : TOOL,
      args: mode === 'ptc' ? { code, description: 'Attach a workspace file natively' } : { path } } }] : [{ text: 'I can now inspect the original file.' }]
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts }, finishReason: 'STOP' }] })}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    })
  })
  const modelSelection = { provider, model }
  async function toolSet(signal = new AbortController().signal) {
    return ctx.tools.resolve({ agent, modelSelection, signal })
  }
  async function assembly() {
    const set = await toolSet()
    try { return await ctx.systemPrompt.assemble({ ...assembleContextFor(agent), modelSelection, toolSet: set }) }
    finally { set.dispose() }
  }
  async function bind(step = 0) {
    return agentEvents(ctx, agent).waterfall('agent/request', { turn: 1, step, signal: new AbortController().signal },
      async () => ({ provider, model }))
  }
  async function generate(messages = session.deriveMessages(), step = 0) {
    const assembled = await assembly()
    const config = await bind(step)
    const chunks = await ctx.agents.withInitiator(agent, () => Array.fromAsync(ctx.llm.stream({ ...config, sessionId: session.id, messages, tools: assembled.tools,
      ...(renderPrompt(assembled) ? { system: renderPrompt(assembled) } : {}),
    })))
    const assembler = new BlockAssembler(), stream = new AssistantStreamAccumulator()
    chunks.forEach((chunk, index) => { assembler.push(chunk); stream.push({ time: Date.now() + index, chunk }) })
    assert.notEqual(assembler.finish.kind, 'error', JSON.stringify(assembler.finish))
    const message = assembler.message({ provider, model })
    session.append('assistant/message', { turn: 1, step, message, stream: stream.snapshot() }, { surfaceOp: 'append' })
    return message
  }
  async function execute(call, signal = new AbortController().signal) {
    session.append('tool/call', { turn: 1, step: 0, callId: call.id, name: call.name, arguments: call.arguments })
    const set = await toolSet()
    let batch
    try { batch = await ctx.tools.execute({ calls: [{ type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments }], signal, agent, toolSet: set }) }
    finally { set.dispose() }
    const result = { ...batch.results[0].result, additionalContexts: batch.additionalContexts }
    results.push(result)
    const message = createToolResultMessage({ callId: call.id, content: result.content, isError: result.isError })
    session.append('tool/result', { turn: 1, step: 0, message,
      ...(result.meta === undefined ? {} : { meta: result.meta }), ...(result.isError ? { error: result.error } : {}),
    }, { surfaceOp: 'append' })
    for (const context of [...result.additionalContexts ?? [], ...pending.splice(0)]) session.append('user/message', context, { surfaceOp: 'append' })
    return result
  }
  async function restore() {
    const observed = await ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' })
    let snapshot
    try { snapshot = { id: session.id, header: observed.header, events: observed.events } }
    finally { observed[Symbol.dispose]() }
    const path = join(directory, 'session.json')
    await writeFile(path, JSON.stringify(snapshot))
    const persisted = JSON.parse(await readFile(path, 'utf8'))
    return { session: Session.create(persisted.id, persisted.events, persisted.header), events: persisted.events }
  }
  return { ctx, agent, session, profiles, requests, rawReads, parserReads, writes, stored, readIds, userFile, injections, executionResults, pluginFiber, directory, attachmentPaths, mapped,
    assembly, bind, generate, execute, restore,
    onRawRead(callback) { onRawRead = callback }, afterNested(callback) { afterNested = callback },
  }
}

const toolCall = message => message.content.find(block => block.type === 'tool-call')
const inlineParts = body => body.contents.flatMap(content => content.parts).filter(part => part.inlineData)
const requestText = body => body.contents.flatMap(content => content.parts).flatMap(part => [part.text,
  part.functionResponse?.response?.output, part.functionResponse?.response?.error].filter(value => typeof value === 'string')).join('\n')

async function assertFileToolAccess(f, body, attachment, bytes) {
  const text = requestText(body)
  const paths = f.attachmentPaths.get(attachment.attachmentId)
  assert.equal(text.includes(paths.host), false, 'the actual attachment-host path is not passed off as an execution-world path')
  if (!f.mapped) {
    assert.match(text, /cannot access a readable path/)
    assert.match(text, /do not claim to have read it/)
    assert.equal(text.includes(paths.execution), false)
    return
  }
  const advertised = [...text.matchAll(/verbatim read-only copy saved at ("(?:[^"\\]|\\.)*")/g)].map(match => JSON.parse(match[1]))
    .filter(path => path === paths.execution)
  assert.equal(advertised.length, 1, 'one file occurrence contributes one core-projected path hint')
  assert.match(text, /Read that path with your file tools/)
  assert.match(text, /copy it to a writable location before modifying it/)
  assert.equal((await stat(advertised[0])).mode & 0o222, 0)
  assert.deepEqual(await readFile(advertised[0]), bytes, 'file tools read the same original bytes the native API received')
  const copy = join(f.directory, `writable-copy-${attachment.attachmentId}`)
  await copyFile(advertised[0], copy)
  await chmod(copy, 0o600)
  await writeFile(copy, Buffer.concat([bytes, Buffer.from('\nmodified local copy')]))
  assert.deepEqual(await readFile(advertised[0]), bytes, 'editing a copied file does not modify the read-only attachment')
  assert.deepEqual(await readFile(paths.host), bytes)
}

for (const provider of providers) {
  for (const [path, bytes, mimeType] of [['report.pdf', pdf, 'application/pdf'], ['screen.png', png, 'image/png'],
    ['voice.wav', wav, 'audio/wav'], ['clip.mp4', video, 'video/mp4']]) {
    test(`${provider}: model tool call persists and sends the workspace ${path} bytes to that same model`, async t => {
      const f = await fixture(t, { provider, path, bytes, humanUpload: true })
      const assembled = await f.assembly()
      assert.ok(assembled.tools.some(tool => tool.name === TOOL))
      const first = await f.generate()
      assert.equal(f.requests.length, 1)
      assert.equal(inlineParts(f.requests[0].body).length, 0, 'the ordinary human upload switch remains disabled')
      await assertFileToolAccess(f, f.requests[0].body, f.userFile, f.stored.get(f.userFile.attachmentId))
      assert.equal(requestText(f.requests[0].body).includes(nativeClarification), false)
      const call = toolCall(first)
      assert.equal(call.name, TOOL)
      const result = await f.execute(call)
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.equal(f.requests.length, 1, 'attaching a file does not make an auxiliary model request')
      assert.equal(f.writes.length, 1)
      assert.deepEqual(f.stored.get(f.writes[0].attachmentId), bytes)
      const durable = await f.restore()
      assert.ok(durable.events.some(event => event.type === 'tool/result' && event.data.message.content.some(block => block.type === 'file')))
      const originalEvents = JSON.stringify(durable.events)
      assert.equal(originalEvents.includes(f.attachmentPaths.get(f.writes[0].attachmentId).execution), false, 'local path hints remain request projections, not durable file content')
      await writeFile(join(f.directory, path), Buffer.from('The workspace source changed after its original bytes were attached.'))
      await f.generate(durable.session.deriveMessages(), 1)
      assert.equal(f.requests.length, 2, 'only the original model step and its normal continuation are generated')
      assert.ok(f.requests.every(request => request.url.includes(MODEL)))
      const parts = inlineParts(f.requests[1].body)
      assert.equal(parts.length, 1)
      assert.equal(parts[0].inlineData.mimeType, mimeType)
      assert.deepEqual(Buffer.from(parts[0].inlineData.data, 'base64'), bytes)
      await assertFileToolAccess(f, f.requests[1].body, f.writes[0], bytes)
      assert.equal(requestText(f.requests[1].body).split(nativeClarification).length - 1, 1)
      assert.ok(f.requests[1].body.contents.flatMap(content => content.parts).some(part => part.functionResponse))
      assert.ok(f.requests[1].body.contents.flatMap(content => content.parts).every(part => !part.functionResponse?.parts), 'media is adjacent user input, independent of functionResponse media support')
      assert.equal(f.readIds.includes(f.userFile.attachmentId), false)
      assert.deepEqual(f.parserReads, [])
      await f.generate(durable.session.deriveMessages(), 2)
      assert.equal(inlineParts(f.requests[2].body).length, 1, 'replaying saved history does not duplicate a native upload')
      await assertFileToolAccess(f, f.requests[2].body, f.writes[0], bytes)
      assert.equal(requestText(f.requests[2].body).split(nativeClarification).length - 1, 1)
      assert.equal(JSON.stringify(durable.events), originalEvents)
      assert.equal(f.writes.length, 1)
    })
  }

  test(`${provider}: PTC nested attachment reaches the next normal request after durable outer success`, async t => {
    const f = await fixture(t, { provider, mode: 'ptc' })
    const assembled = await f.assembly()
    assert.deepEqual(assembled.tools.map(tool => tool.name), ['run_code'])
    assert.match(renderPrompt(assembled), new RegExp(TOOL))
    const first = await f.generate()
    const result = await f.execute(toolCall(first))
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.equal(f.injections.length, 1, 'the final successful outer call injects its approved inner file')
    const durable = await f.restore()
    assert.ok(durable.events.some(event => event.type === 'tool/ptc-dispatch'))
    const rawContext = durable.session.deriveMessages().find(message => message.role === 'user' && message.source.kind === 'google-native-file')
    assert.ok(rawContext?.content.some(block => block.type === 'file'))
    const originalEvents = JSON.stringify(durable.events)
    assert.equal(originalEvents.includes(f.attachmentPaths.get(f.writes[0].attachmentId).execution), false)
    await f.generate(durable.session.deriveMessages(), 1)
    assert.equal(f.requests.length, 2)
    assert.deepEqual(Buffer.from(inlineParts(f.requests[1].body)[0].inlineData.data, 'base64'), pdf)
    assert.equal(inlineParts(f.requests[1].body).length, 1)
    await assertFileToolAccess(f, f.requests[1].body, f.writes[0], pdf)
    assert.equal(requestText(f.requests[1].body).split(nativeClarification).length - 1, 1)
    assert.deepEqual(f.parserReads, [])
    await f.generate(durable.session.deriveMessages(), 2)
    assert.equal(inlineParts(f.requests[2].body).length, 1)
    await assertFileToolAccess(f, f.requests[2].body, f.writes[0], pdf)
    assert.equal(requestText(f.requests[2].body).split(nativeClarification).length - 1, 1)
    assert.equal(JSON.stringify(durable.events), originalEvents)
    assert.equal(f.writes.length, 1)
  })

  test(`${provider}: a configured image-only model can attach an original PNG with the non-image native-file capability disabled`, async t => {
    const f = await fixture(t, { provider, path: 'screen.png', bytes: png, inputTypes: ['text', 'image'], nativeCapability: false })
    assert.ok((await f.assembly()).tools.some(tool => tool.name === TOOL))
    const first = await f.generate()
    assert.equal((await f.execute(toolCall(first))).isError, false)
    const durable = await f.restore()
    await f.generate(durable.session.deriveMessages(), 1)
    assert.equal(f.requests.length, 2)
    assert.deepEqual(Buffer.from(inlineParts(f.requests[1].body)[0].inlineData.data, 'base64'), png)
    await assertFileToolAccess(f, f.requests[1].body, f.writes[0], png)
    assert.deepEqual(f.parserReads, [])
  })

  for (const mode of ['native', 'ptc']) test(`${provider}: ${mode === 'native' ? 'direct' : 'PTC'} self-attachment keeps native bytes and honestly reports an unmapped local path`, async t => {
    const f = await fixture(t, { provider, mode, mapped: false })
    const first = await f.generate()
    assert.equal((await f.execute(toolCall(first))).isError, false)
    const durable = await f.restore()
    await f.generate(durable.session.deriveMessages(), 1)
    const parts = inlineParts(f.requests[1].body)
    assert.equal(parts.length, 1)
    assert.deepEqual(Buffer.from(parts[0].inlineData.data, 'base64'), pdf)
    await assertFileToolAccess(f, f.requests[1].body, f.writes[0], pdf)
    assert.ok(requestText(f.requests[1].body).includes(nativeClarification))
    assert.equal(f.writes.length, 1)
  })
}

test('native attachment tool is shown only for a configured native-capable selected Google model', async t => {
  for (const mode of ['native', 'ptc']) for (const options of [
    { provider: 'foreign-provider' }, { model: 'not-configured' }, { enabled: false }, { nativeCapability: false, inputTypes: ['text'] },
  ]) {
    await t.test(`${mode}: ${JSON.stringify(options)}`, async sub => {
      const f = await fixture(sub, { mode, ...options })
      const assembled = await f.assembly()
      assert.equal(assembled.tools.some(tool => tool.name === TOOL), false)
      if (mode === 'ptc') assert.equal(renderPrompt(assembled).includes(TOOL), false)
      const refused = await f.execute({ id: 'hidden-tool-call', name: mode === 'ptc' ? 'run_code' : TOOL, arguments: JSON.stringify(mode === 'ptc'
        ? { code: `return await tools.${TOOL}({path:"report.pdf"});`, description: 'Attempt a hidden tool' } : { path: 'report.pdf' }) })
      assert.equal(refused.isError, true, 'knowing a hidden tool name does not permit dispatch')
      assert.equal(f.rawReads.length, 0)
      assert.equal(f.writes.length, 0)
      assert.equal(f.injections.length, 0)
    })
    assert.equal(globalThis.fetch, originalFetch, 'each child fixture restores fetch before the next case')
  }
})

test('native-file visibility fixtures leave the original fetch available to following tests', () => {
  assert.equal(globalThis.fetch, originalFetch)
})

test('actual main plugin mounts the native tool through rc.5 injected services and removes every contribution on disposal', async t => {
  const f = await fixture(t, { mountPlugin: true })
  assert.deepEqual(f.ctx.llm.listProviders().map(provider => provider.id).sort(), [...providers].sort())
  assert.equal(typeof f.ctx.nativeGoogle.client, 'function')
  assert.ok((await f.assembly()).tools.some(tool => tool.name === TOOL))
  assert.equal((await f.ctx.llm.listModels(providers[0]))[0].id, MODEL)
  await f.pluginFiber.dispose()
  assert.equal(f.ctx.tools.get(TOOL), undefined)
  assert.equal(f.ctx.get('nativeGoogle'), undefined)
  assert.deepEqual(f.ctx.llm.listProviders(), [])
  assert.equal((await f.assembly()).tools.some(tool => tool.name === TOOL), false)
})

for (const mode of ['native', 'ptc']) {
  test(`${mode}: unsupported file types are refused without parsing, model calls or durable file results`, async t => {
    const f = await fixture(t, { mode, path: 'unknown.bin', bytes: Buffer.from([0, 255, 0, 255]) })
    await f.assembly()
    await f.bind()
    const call = { id: 'unsupported-file-call', name: mode === 'ptc' ? 'run_code' : TOOL,
      arguments: JSON.stringify(mode === 'ptc' ? { code: `return await tools.${TOOL}({path:"unknown.bin"});`, description: 'Attach a file' } : { path: 'unknown.bin' }) }
    const result = await f.execute(call)
    assert.equal(result.isError, true)
    assert.ok(f.rawReads.length > 0, 'the refusal follows real raw file inspection')
    assert.equal(f.requests.length, 0)
    assert.equal(f.writes.length, 0)
    assert.equal(f.injections.length, 0)
    assert.equal(result.content.some(block => block.type === 'file'), false)
    assert.deepEqual(f.parserReads, [])
  })

  test(`${mode}: cancellation during raw capture publishes no attachment or model-facing file`, async t => {
    const f = await fixture(t, { mode })
    const controller = new AbortController()
    f.onRawRead(() => controller.abort(new Error('cancel raw native attachment')))
    await f.assembly()
    await f.bind()
    const result = await f.execute({ id: 'cancel-file-call', name: mode === 'ptc' ? 'run_code' : TOOL,
      arguments: JSON.stringify(mode === 'ptc' ? { code: `return await tools.${TOOL}({path:"report.pdf"});`, description: 'Attach a file' } : { path: 'report.pdf' }) }, controller.signal)
    assert.equal(result.isError, true)
    assert.ok(f.rawReads.length > 0, 'the tool entered cancellable raw capture')
    assert.equal(f.writes.length, 0)
    assert.equal(f.injections.length, 0)
    assert.equal(result.content.some(block => block.type === 'file'), false)
    assert.equal(f.requests.length, 0)
  })

  test(`${mode}: a model input declaration refuses PDF before storage when only text and images are supported`, async t => {
    const f = await fixture(t, { mode, inputTypes: ['text', 'image'] })
    await f.assembly()
    await f.bind()
    const result = await f.execute({ id: 'unsupported-model-input-call', name: mode === 'ptc' ? 'run_code' : TOOL,
      arguments: JSON.stringify(mode === 'ptc' ? { code: `return await tools.${TOOL}({path:"report.pdf"});`, description: 'Attach a file' } : { path: 'report.pdf' }) })
    assert.equal(result.isError, true)
    assert.ok(f.rawReads.length > 0)
    assert.equal(f.writes.length, 0)
    assert.equal(f.injections.length, 0)
    assert.equal(f.requests.length, 0)
  })
}

for (const failure of ['late-cancel', 'inner-block', 'inner-file-removal', 'outer-block']) {
  test(`PTC ${failure} never injects an approved-looking native file into the next model step`, async t => {
    const f = await fixture(t, { mode: 'ptc' })
    const controller = new AbortController()
    if (failure === 'late-cancel') f.afterNested(() => controller.abort(new Error('cancel after nested attachment success')))
    f.ctx.on('tools/post-execute', async (exec, result, next) => {
      if (exec.name === TOOL && failure === 'inner-block') return { kind: 'block', feedback: [{ type: 'text', text: 'Attachment refused by policy' }] }
      if (exec.name === TOOL && failure === 'inner-file-removal') return { kind: 'accept', content: [{ type: 'text', text: 'File content withheld' }] }
      if (exec.name === 'run_code' && failure === 'outer-block') return { kind: 'block', feedback: [{ type: 'text', text: 'Program result refused by policy' }] }
      return next()
    })
    await f.assembly()
    await f.bind()
    const result = await f.execute({ id: 'ptc-policy-call', name: 'run_code', arguments: JSON.stringify({
      code: `return await tools.${TOOL}({path:"report.pdf"});`, description: 'Attach a file',
    }) }, controller.signal)
    assert.equal(result.isError, failure !== 'inner-file-removal')
    assert.equal(f.writes.length, 1, 'the nested raw attachment succeeded before its final delivery was stopped')
    const inner = f.executionResults.find(item => item.exec.name === TOOL)
    assert.ok(inner)
    assert.equal(inner.result.isError, failure === 'inner-block')
    assert.equal(inner.result.content.some(block => block.type === 'file'), !['inner-block', 'inner-file-removal'].includes(failure))
    assert.equal(f.injections.length, 0)
    const durable = await f.restore()
    assert.equal(durable.session.deriveMessages().some(message => message.source.kind === 'google-native-file'), false)
    assert.equal(result.additionalContexts?.some(message => message.content.some(block => block.type === 'file')) ?? false, false)
    assert.equal(f.requests.length, 0)
  })
}

for (const provider of providers) {
  test(provider + ': PTC self-attached PNG reaches the next same-model request and survives history replay with user uploads disabled', async t => {
    const f = await fixture(t, { provider, mode: 'ptc', path: 'screen.png', bytes: png,
      inputTypes: ['text', 'image'], nativeCapability: false })
    const first = await f.generate()
    assert.equal(inlineParts(f.requests[0].body).length, 0)
    const result = await f.execute(toolCall(first))
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.equal(f.injections.length, 1)
    assert.equal(f.injections[0].source.kind, 'google-native-file')
    assert.equal(f.injections[0].source.googleNativeFile.provider, provider)
    assert.equal(f.injections[0].source.googleNativeFile.model, MODEL)
    const durable = await f.restore()
    await writeFile(join(f.directory, 'screen.png'), Buffer.from('source changed after capture'))
    for (const step of [1, 2]) {
      await f.generate(durable.session.deriveMessages(), step)
      const body = f.requests[step].body
      const parts = inlineParts(body)
      assert.equal(parts.length, 1, 'the approved original PNG appears exactly once in a normal continuation')
      assert.equal(parts[0].inlineData.mimeType, 'image/png')
      assert.deepEqual(Buffer.from(parts[0].inlineData.data, 'base64'), png)
      assert.ok(body.contents.flatMap(content => content.parts).every(part => !part.functionResponse?.parts))
      assert.equal(requestText(body).split(nativeClarification).length - 1, 1)
    }
    assert.equal(f.writes.length, 1)
    assert.deepEqual(f.parserReads, [])
    assert.ok(f.requests.every(request => request.url.includes(MODEL)))
  })

  for (const mode of ['native', 'ptc']) for (const failure of [
    'inner-block', 'inner-file-removal', 'late-cancel', ...(mode === 'ptc' ? ['outer-block'] : []),
  ]) test(provider + ': ' + mode + ' ' + failure + ' cannot restore captured PNG bytes into the following model request', async t => {
    const f = await fixture(t, { provider, mode, path: 'screen.png', bytes: png })
    const controller = new AbortController()
    const first = await f.generate()
    if (mode === 'ptc' && failure === 'late-cancel') f.afterNested(() => controller.abort(new Error('cancel final PNG delivery')))
    f.ctx.on('tools/post-execute', async (exec, _result, next) => {
      if (exec.name === TOOL && failure === 'inner-block') return { kind: 'block', feedback: [{ type: 'text', text: 'PNG refused by policy' }] }
      if (exec.name === TOOL && failure === 'inner-file-removal') return { kind: 'accept', content: [{ type: 'text', text: 'PNG bytes withheld by policy' }] }
      if (exec.name === TOOL && mode === 'native' && failure === 'late-cancel') controller.abort(new Error('cancel final PNG delivery'))
      if (exec.name === 'run_code' && failure === 'outer-block') return { kind: 'block', feedback: [{ type: 'text', text: 'PTC output refused by policy' }] }
      return next()
    })
    const result = await f.execute(toolCall(first), controller.signal)
    assert.equal(result.isError, failure !== 'inner-file-removal')
    assert.equal(f.writes.length, 1, 'capture finished before the final policy/cancellation decision')
    assert.equal(f.injections.length, 0)
    const durable = await f.restore()
    await f.generate(durable.session.deriveMessages(), 1)
    assert.equal(f.requests.length, 2)
    assert.equal(inlineParts(f.requests[1].body).length, 0)
    assert.ok(f.requests[1].body.contents.flatMap(content => content.parts).every(part => !part.fileData && !part.functionResponse?.parts))
    assert.deepEqual(f.readIds, [], 'an unapproved stored image is not read back for the model API')
    assert.equal(requestText(f.requests[1].body).includes(nativeClarification), false)
    assert.deepEqual(f.parserReads, [])
  })
}
