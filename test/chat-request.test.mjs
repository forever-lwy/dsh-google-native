import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, copyFile, link, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, createUserMessage } from '@deepseek-ai/dsh-llm'
import { GoogleNativeAdapter } from '../lib/adapter.js'
import { defaultProfile } from '../lib/config.js'
import { registerNativeFileBridge } from '../lib/file-scope.js'
import { latestChatChoices } from '../lib/request-controls.js'
import { translateStream } from '../lib/stream.js'

const provider = 'google-ai-studio'
const model = 'gemini-2.5-flash'
const choices = (change = {}) => ({ nativeFiles: true, search: false, urlContext: false, codeExecution: false, maps: false, ...change })
const source = (selected, target = model, route = provider) => ({ kind: 'user', googleNative: { version: 1, selections: [{ provider: route, model: target, choices: selected }] } })
const pdf = Buffer.from('%PDF-1.7\nNative or local processing')
const nativeClarification = 'Available file contents are attached natively below. The local-path note above concerns local file tools only.'
const user = (selected, file = true, route = provider) => createUserMessage({ source: source(selected, model, route), content: [
  { type: 'text', text: 'Read the document' },
  ...(file ? [{ type: 'file', attachment: { attachmentId: 'a'.repeat(64), name: 'input.pdf', bytes: pdf.length } }] : []),
] })
function fixture() {
  const ctx = new Context()
  new LlmRuntime(ctx)
  let reads = 0
  const requests = []
  ctx.provide('attachments', { fileHostPath: () => undefined, async *readFileStream() { reads++; yield pdf } })
  const profiles = { [provider]: defaultProfile(provider), 'google-vertex-native': defaultProfile('google-vertex-native') }
  const adapter = new GoogleNativeAdapter(ctx, { profiles: () => profiles, resolveApiKey: async () => 'offline-key',
    createClient: () => ({ models: { async generateContentStream(request) {
      requests.push(request)
      return (async function* () { yield { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] } })()
    } } }) })
  ctx.llm.registerAdapter([provider, 'google-vertex-native'], adapter)
  registerNativeFileBridge(ctx)
  return { ctx, profiles, requests, reads: () => reads }
}
async function collect(stream) { return Array.fromAsync(stream) }

test('native file checkbox changes actual rc.5 file dispatch between verified bytes and normal handles', async () => {
  for (const enabled of [false, true]) {
    const f = fixture()
    const chunks = await collect(f.ctx.llm.stream({ provider, model, messages: [user(choices({ nativeFiles: enabled }))] }))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.equal(f.reads(), enabled ? 1 : 0)
    const parts = f.requests[0].contents[0].parts
    const native = parts.filter(part => part.inlineData)
    assert.deepEqual(native, enabled ? [{ inlineData: { mimeType: 'application/pdf', data: pdf.toString('base64') } }] : [])
    assert.equal(parts.filter(part => part.text?.includes('File "input.pdf"')).length, 1)
    assert.match(parts[1].text, /cannot access a readable path/)
  }
})

for (const route of ['google-ai-studio', 'google-vertex-native']) for (const enabled of [false, true]) for (const mapped of [true, false]) {
  test(`${route}: human ${enabled ? 'native' : 'normal'} upload keeps ${mapped ? 'usable read-only path guidance' : 'an honest unmapped-path warning'}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-human-file-path-'))
    const ctx = new Context()
    t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
    const hostPath = join(directory, 'host-immutable-object.pdf')
    const mappedPath = join(directory, 'execution-readable-object.pdf')
    await writeFile(hostPath, pdf, { mode: 0o444 })
    await link(hostPath, mappedPath)
    const attachment = { attachmentId: createHash('sha256').update(pdf).digest('hex'), name: 'input.pdf', bytes: pdf.length }
    let reads = 0
    new LlmRuntime(ctx)
    ctx.provide('attachments', { fileHostPath: () => hostPath, async *readFileStream() { reads++; yield await readFile(hostPath) } })
    ctx.provide('fs', { processPathFromHostPath: path => mapped && path === hostPath ? mappedPath : undefined })
    const profiles = { [provider]: defaultProfile(provider), 'google-vertex-native': defaultProfile('google-vertex-native') }
    profiles[route].vertexAuth = 'api-key'
    profiles[route].baseURL = `https://offline.test/human/${route}`
    const adapter = new GoogleNativeAdapter(ctx, { profiles: () => profiles, resolveApiKey: async () => 'offline-key' })
    ctx.llm.registerAdapter(['google-ai-studio', 'google-vertex-native'], adapter)
    registerNativeFileBridge(ctx)
    const requests = []
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.match(String(url), /offline\.test/)
      requests.push(JSON.parse(init.body))
      return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Received' }] }, finishReason: 'STOP' }] })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    })
    const message = createUserMessage({ source: source(choices({ nativeFiles: enabled }), model, route), content: [
      { type: 'text', text: 'Inspect the uploaded document.' }, { type: 'file', attachment },
    ] })
    const chunks = await collect(ctx.llm.stream({ provider: route, model, messages: [message] }))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.equal(requests.length, 1)
    assert.equal(reads, enabled ? 1 : 0)
    const parts = requests[0].contents.flatMap(content => content.parts)
    const native = parts.filter(part => part.inlineData)
    assert.equal(native.length, enabled ? 1 : 0, 'the same occurrence uploads at most once')
    if (enabled) assert.deepEqual(Buffer.from(native[0].inlineData.data, 'base64'), pdf)
    const hints = parts.filter(part => part.text?.includes('File "input.pdf"'))
    assert.equal(hints.length, 1)
    const hint = hints[0].text
    assert.equal(hint.includes(nativeClarification), enabled, 'only native inputs add the clarification about local file tools')
    assert.equal(hint.includes(hostPath), false, 'an attachment-host path is never offered as an execution-world path')
    if (mapped) {
      assert.ok(hint.includes(mappedPath))
      assert.match(hint, /verbatim read-only copy/)
      assert.match(hint, /Read that path with your file tools/)
      assert.match(hint, /copy it to a writable location before modifying it/)
      const match = /verbatim read-only copy saved at ("(?:[^"\\]|\\.)*")/.exec(hint)
      assert.ok(match)
      const advertised = JSON.parse(match[1])
      assert.equal((await stat(advertised)).mode & 0o222, 0)
      assert.deepEqual(await readFile(advertised), pdf, 'file tools can read the advertised native-upload copy')
      const writable = join(directory, 'copied-editable.pdf')
      await copyFile(advertised, writable)
      await chmod(writable, 0o600)
      await writeFile(writable, Buffer.concat([pdf, Buffer.from('\nlocal edit')]))
      assert.deepEqual(await readFile(advertised), pdf, 'editing the copied file leaves the stored original unchanged')
      assert.deepEqual(await readFile(hostPath), pdf)
    } else {
      assert.match(hint, /cannot access a readable path/)
      assert.match(hint, /do not claim to have read it/)
      assert.equal(hint.includes(mappedPath), false)
      assert.equal(hint.includes('copy saved at'), false)
    }
  })
}

test('later native-file changes preserve each old upload mode while applying the new mode to new files', async () => {
  const f = fixture()
  await collect(f.ctx.llm.stream({ provider, model, messages: [user(choices()), user(choices({ nativeFiles: false }))] }))
  assert.equal(f.reads(), 1)
  const parts = f.requests[0].contents[0].parts
  assert.equal(parts.filter(part => part.inlineData).length, 1)
  assert.match(parts.at(-1).text, /input.pdf/)
})

test('explicitly disabled native tools override provider/model settings and raw REST tool overrides', async t => {
  const f = fixture()
  f.profiles[provider].nativeTools.search = true
  f.profiles[provider].generationConfig.tools = [{ googleSearch: {} }, { codeExecution: {} }]
  f.profiles[provider].generationConfig.httpOptions = { extraBody: { tools: [{ google_search: {} }, { url_context: {} }] } }
  let wire
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    wire = JSON.parse(init.body)
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const adapter = new GoogleNativeAdapter({ attachments: {} }, { profiles: () => f.profiles, resolveApiKey: async () => 'offline-key' })
  await collect(adapter.stream({ provider, model, messages: [user(choices(), false)], tools: [{ name: 'local_read', description: 'Read a local file', parameters: { type: 'object' } }] }))
  assert.equal(wire.tools.length, 1)
  assert.equal(wire.tools[0].functionDeclarations[0].name, 'local_read')
  assert.equal(JSON.stringify(wire.tools).includes('google_search'), false)
  assert.equal(JSON.stringify(wire.tools).includes('codeExecution'), false)
})

test('modern AI Studio native tools coexist with harness functions using the documented mixed mode', async t => {
  const profiles = { [provider]: defaultProfile(provider), 'google-vertex-native': defaultProfile('google-vertex-native') }
  let wire
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    wire = JSON.parse(init.body)
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const adapter = new GoogleNativeAdapter({ attachments: {} }, { profiles: () => profiles, resolveApiKey: async () => 'offline-key' })
  await collect(adapter.stream({ provider, model: 'gemini-3.8-flash', messages: [createUserMessage({ source: source(choices({ search: true }), 'gemini-3.8-flash'), content: [{ type: 'text', text: 'Search and read' }] })],
    tools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object' } }] }))
  assert.ok(wire.tools.some(tool => tool.googleSearch))
  assert.ok(wire.tools.some(tool => tool.functionDeclarations?.[0].name === 'read_file'))
  assert.equal(wire.toolConfig.includeServerSideToolInvocations, true)
  assert.equal(wire.toolConfig.functionCallingConfig.mode, 'VALIDATED')
})

test('unsupported choices and malformed recorded metadata fail before upload or API dispatch', async () => {
  const f = fixture()
  f.profiles[provider].models[0].capabilities = { search: false }
  const unsupported = await collect(f.ctx.llm.stream({ provider, model, messages: [user(choices({ search: true }))] }))
  assert.equal(unsupported.at(-1).reason.failure.code, 'UNSUPPORTED_NATIVE_CAPABILITY')
  const malformed = await collect(f.ctx.llm.stream({ provider, model, messages: [createUserMessage({ source: { kind: 'user', googleNative: { version: 99 } }, content: [{ type: 'text', text: 'test' }] })] }))
  assert.equal(malformed.at(-1).reason.failure.code, 'INVALID_NATIVE_OPTIONS')
  assert.equal(f.reads(), 0)
  assert.equal(f.requests.length, 0)
})

test('new unstamped prompts and auxiliary calls do not inherit older tool selections', () => {
  const selected = user(choices({ search: true }), false)
  assert.equal(latestChatChoices({ provider, model, messages: [selected] }).search, true)
  assert.equal(latestChatChoices({ provider, model, purpose: 'session-title', messages: [selected] }), undefined)
  assert.equal(latestChatChoices({ provider, model, messages: [selected, createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'new' }] })] }), undefined)
  assert.deepEqual(latestChatChoices({ provider, model: 'unrecorded-model', messages: [selected] }), choices({ nativeFiles: false }))
})

test('native server tool events show readable activity while retaining exact replay Parts', async () => {
  const parts = [{ toolCall: { id: 'search', toolType: 'GOOGLE_SEARCH_WEB', args: { query: 'example' } }, thoughtSignature: 'opaque' },
    { toolResponse: { id: 'search', toolType: 'GOOGLE_SEARCH_WEB', response: { result: 'native-result' } } }, { text: 'Answer' }]
  const events = (async function* () { yield { candidates: [{ content: { parts }, finishReason: 'STOP' }] } })()
  const chunks = await collect(translateStream(events, { provider, model, messages: [] }, {}))
  const visible = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
  assert.match(visible, /Google 搜索/)
  assert.equal(visible.includes('native-result'), false)
  assert.equal(visible.includes('opaque'), false)
  assert.deepEqual(chunks.at(-1).replayState.blocks.flatMap(block => block.parts), parts)
})
