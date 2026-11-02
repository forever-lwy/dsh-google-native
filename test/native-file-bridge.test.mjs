import assert from 'node:assert/strict'
import test from 'node:test'
import { projectFilesToText } from '@deepseek-ai/dsh-llm'
import { withNativeFileContext, restoreNativeFiles } from '../lib/file-scope.js'
import { verifiedNativeFileMessages } from '../lib/native-file-provenance.js'
import { translateMessages } from '../lib/messages.js'
import { NativeFileStore } from '../lib/files.js'

const bytes = Buffer.from('%PDF-1.7\noriginal workspace binary\0\xff')
const attachment = { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'original.pdf', bytes: bytes.length }
const block = () => ({ type: 'file', attachment: { ...attachment } })
const event = (type, data, seq) => ({ type, data, seq })
function fixture(provider = 'google-ai-studio', nested = false) {
  const model = 'gemini-2.5-flash'
  const callId = nested ? 'root:ptc:1' : 'direct'
  const rootCallId = nested ? 'root' : callId
  const receipt = { version: 1, sessionId: 'same-session', provider, model, callId, rootCallId, attachment: { ...attachment } }
  const prompt = { id: 'prompt', role: 'user', source: { kind: 'user', googleNative: { version: 1, selections: [{ provider, model,
    choices: { nativeFiles: false, search: false, urlContext: false, codeExecution: false, maps: false } }] } }, content: [{ type: 'text', text: 'Read the workspace file.' }] }
  const assistant = { id: 'assistant', role: 'assistant', source: { kind: 'model', provider, model }, content: [{
    type: 'tool-call', id: rootCallId, name: nested ? 'run_code' : 'google_native_attach_file', arguments: '{"path":"original.pdf"}',
  }] }
  const tool = { id: 'result', role: 'tool', source: { kind: 'tool', callId: rootCallId }, toolCallId: rootCallId,
    content: nested ? [{ type: 'text', text: 'Program completed.' }] : [block()], isError: false }
  const context = { id: 'file-context', role: 'user', source: { kind: 'google-native-file', googleNativeFile: receipt }, content: [block()] }
  const events = [event('assistant/message', { message: assistant, turn: 1, step: 2 }, 0)]
  if (nested) events.push(event('tool/ptc-dispatch', { name: 'google_native_attach_file', rootCallId,
    parentCallId: rootCallId, subCallId: callId, content: [block()], isError: false, meta: { googleNativeFile: receipt } }, 1))
  events.push(event('tool/result', { message: tool, turn: 1, step: 2,
    ...(!nested ? { meta: { googleNativeFile: receipt } } : {}) }, events.length))
  if (nested) events.push(event('user/message', context, events.length))
  return { receipt, events, tool, context, options: { provider, model, sessionId: 'same-session', messages: [prompt, assistant, tool, ...(nested ? [context] : [])] } }
}

async function translated(f, events = f.events) {
  let reads = 0
  const files = new NativeFileStore({}, 'ai-studio', { async *readFileStream() { reads++; yield bytes } })
  const projected = { ...f.options, messages: projectFilesToText(f.options.messages, () => '/read-only/file') }
  let result
  const authorized = verifiedNativeFileMessages(f.options, events)
  for await (const _ of withNativeFileContext(f.options, async function* () {
    result = await translateMessages(restoreNativeFiles(projected), files)
    yield { type: 'finish', reason: { kind: 'stop' } }
  }, authorized)) { /* consume */ }
  return { result, reads }
}

for (const provider of ['google-ai-studio', 'google-vertex-native']) {
  test(`verified ${provider} direct tool files bypass the user-upload toggle and use ordinary native media`, async () => {
    const f = fixture(provider)
    f.tool.content.unshift({ type: 'text', text: 'Keep this policy feedback alongside the native attachment.' })
    const original = JSON.stringify(f.options)
    const { result, reads } = await translated(f)
    const parts = result.contents.at(-2).parts
    assert.equal(parts[0].functionResponse.name, 'google_native_attach_file')
    assert.ok(parts[0].functionResponse.response.output.startsWith('Keep this policy feedback alongside the native attachment.\n'))
    assert.ok(parts[0].functionResponse.response.output.includes('/read-only/file'))
    assert.ok(parts[0].functionResponse.response.output.includes('verbatim read-only copy'))
    assert.equal(parts[0].functionResponse.parts, undefined, 'older models must not receive multimodal functionResponse.parts')
    assert.equal(parts.length, 1)
    const media = result.contents.at(-1).parts
    assert.ok(media.every(part => !part.functionResponse), 'native attachments are in a separate ordinary user Content')
    assert.match(media[0].text, /Media returned by google_native_attach_file/)
    assert.deepEqual(media[1], { inlineData: { mimeType: 'application/pdf', data: bytes.toString('base64') } })
    assert.equal(reads, 1)
    assert.equal(JSON.stringify(f.options), original)
  })
}

test('PTC contexts require successful inner and outer outcomes and retain exact file bytes', async () => {
  const f = fixture('google-ai-studio', true)
  assert.deepEqual([...verifiedNativeFileMessages(f.options, f.events)], ['file-context'])
  const { result } = await translated(f)
  assert.deepEqual(result.contents.at(-1).parts.at(-1), { inlineData: { mimeType: 'application/pdf', data: bytes.toString('base64') } })
  const cases = [
    events => { events[1].data.isError = true },
    events => { events[2].data.message.isError = true },
    events => { events[1].data.content = [{ type: 'text', text: 'policy removed file' }] },
    events => { events[1].data.subCallId = 'another-call' },
    events => { events[3].data.id = 'different-message' },
  ]
  for (const mutate of cases) {
    const events = structuredClone(f.events)
    mutate(events)
    assert.equal(verifiedNativeFileMessages(f.options, events).size, 0)
  }
})

test('a successful parallel sibling cannot authorize a failed PTC root from the same assistant message', () => {
  const f = fixture('google-ai-studio', true)
  f.events[0].data.message.content.push({ type: 'tool-call', id: 'sibling', name: 'other_tool', arguments: '{}' })
  f.events[2].data.message.isError = true
  f.events.push(event('tool/result', { turn: 1, step: 2, message: {
    id: 'sibling-result', role: 'tool', toolCallId: 'sibling', source: { kind: 'tool', callId: 'sibling' },
    content: [{ type: 'text', text: 'OK' }], isError: false,
  } }, 4))
  assert.equal(verifiedNativeFileMessages(f.options, f.events).size, 0)
})

test('foreign routes, changed attachments, failed results and missing durable proof never grant a native upload', async () => {
  const f = fixture()
  const alterations = [
    events => { events[1].data.meta.googleNativeFile.sessionId = 'other-session' },
    events => { events[1].data.meta.googleNativeFile.provider = 'google-vertex-native' },
    events => { events[1].data.meta.googleNativeFile.model = 'other-model' },
    events => { events[1].data.meta.googleNativeFile.callId = 'other-call' },
    events => { events[1].data.meta.googleNativeFile.rootCallId = 'other-root' },
    events => { events[1].data.meta.googleNativeFile.attachment.name = 'changed.pdf' },
    events => { events[1].data.message.isError = true },
    events => { events[1].data.message.id = 'other-result' },
    events => { events[0].data.message.source.model = 'other-model' },
    events => { events[1].data.message.content = [] },
  ]
  for (const alter of alterations) {
    const events = structuredClone(f.events)
    alter(events)
    assert.equal(verifiedNativeFileMessages(f.options, events).size, 0)
  }
  const { result, reads } = await translated(f, [])
  assert.equal(reads, 0)
  assert.equal(result.contents.at(-1).parts.some(part => part.inlineData || part.fileData), false)
  assert.equal(verifiedNativeFileMessages({ ...f.options, purpose: 'compaction' }, f.events).size, 0)
  assert.equal(verifiedNativeFileMessages({ ...f.options, sessionId: undefined }, f.events).size, 0)
})

test('deferred source fields and file handles alone cannot impersonate a successful attachment call', async () => {
  const f = fixture('google-ai-studio', true)
  const { reads } = await translated(f, [f.events.at(-1)])
  assert.equal(reads, 0)
  const changed = structuredClone(f.options)
  changed.messages.at(-1).content[0].attachment.bytes++
  assert.equal(verifiedNativeFileMessages(changed, f.events).size, 0)
})

test('the projection boundary cannot reattribute an approved file to another tool call', async () => {
  for (const field of ['toolCallId', 'source.callId']) {
    const f = fixture()
    const projected = { ...f.options, messages: structuredClone(projectFilesToText(f.options.messages, () => '/read-only/file')) }
    if (field === 'toolCallId') projected.messages.at(-1).toolCallId = 'another-call'
    else projected.messages.at(-1).source.callId = 'another-call'
    const authorized = verifiedNativeFileMessages(f.options, f.events)
    const consume = async () => {
      for await (const _ of withNativeFileContext(f.options, async function* () {
        restoreNativeFiles(projected)
        yield { type: 'finish', reason: { kind: 'stop' } }
      }, authorized)) { /* consume */ }
    }
    await assert.rejects(consume, error => error.code === 'NATIVE_FILE_BRIDGE_MISMATCH', field)
  }
})
