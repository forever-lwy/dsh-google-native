import assert from 'node:assert/strict'
import test from 'node:test'
import { withNativeFileContext, restoreNativeFiles, registerNativeFileBridge } from '../lib/file-scope.js'
import { Config, profilesOf, defaultProfile, validateProfile } from '../lib/config.js'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, LlmAdapter, createUserMessage, createAssistantMessage, createToolResultMessage, projectFilesToText, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { GoogleNativeAdapter } from '../lib/adapter.js'
import * as GooglePlugin from '../lib/index.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bundlePatchPaths, loadOverlayPatches, composeEntries, evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'

const file = name => Object.freeze({ type: 'file', attachment: Object.freeze({ attachmentId: 'a'.repeat(64), name, bytes: 12 }) })
const request = (name, id = 'user-1') => ({
  provider: 'google-ai-studio', model: 'gemini-2.5-flash',
  messages: [Object.freeze({ id, role: 'user', content: Object.freeze([file(name)]) })],
})

test('native file bridge keeps durable file references and core replay filtering without mutating frozen requests', async () => {
  const original = request('report.pdf')
  const projected = {
    ...original,
    messages: [{ ...original.messages[0], content: [{ type: 'text', text: '[file handle]' }] }],
  }
  const before = JSON.stringify(original)
  let restored
  const next = async function* () {
    restored = restoreNativeFiles(projected)
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  for await (const _ of withNativeFileContext(original, next)) { /* consume scope */ }
  assert.ok(restored.messages[0].content[0].text.startsWith(projected.messages[0].content[0].text))
  assert.equal(restored.messages[0].content[1], original.messages[0].content[0])
  assert.equal(projected.messages[0].content[0].type, 'text')
  assert.equal(JSON.stringify(original), before)
  assert.equal(restoreNativeFiles(projected), projected)
})

test('native file bridge follows stable message IDs after core removes developer updates', async () => {
  const original = request('speech.wav')
  original.messages.unshift({ id: 'developer-1', role: 'developer', content: [{ type: 'tool-removal', toolName: 'old' }] })
  const projected = { ...original, messages: [{ ...original.messages[1], content: [{ type: 'text', text: 'handle' }] }] }
  let restored
  for await (const _ of withNativeFileContext(original, async function* () {
    restored = restoreNativeFiles(projected)
    yield { type: 'finish', reason: { kind: 'stop' } }
  })) { /* consume scope */ }
  assert.equal(restored.messages.length, 1)
  assert.equal(restored.messages[0].content[1].attachment.name, 'speech.wav')
})

test('native inputs retain exact mapped and unmapped core hints in multi-file order', async () => {
  const first = file('first.pdf'), second = file('second.wav')
  const original = request('unused.pdf')
  original.messages = [Object.freeze({ id: 'multi', role: 'user', content: Object.freeze([
    { type: 'text', text: 'Before' }, first, { type: 'text', text: 'Between' }, second, { type: 'text', text: 'After' },
  ]) })]
  const projected = { ...original, messages: projectFilesToText(original.messages,
    ref => ref.name === 'first.pdf' ? '/execution/read-only/first.pdf' : undefined) }
  const before = JSON.stringify([original, projected])
  let restored
  for await (const _ of withNativeFileContext(original, async function* () {
    restored = restoreNativeFiles(projected)
    yield { type: 'finish', reason: { kind: 'stop' } }
  })) { /* consume */ }
  assert.deepEqual(restored.messages[0].content.map(block => block.type), ['text', 'text', 'file', 'text', 'text', 'file', 'text'])
  assert.equal(restored.messages[0].content[0], projected.messages[0].content[0])
  assert.equal(restored.messages[0].content[2], first)
  assert.equal(restored.messages[0].content[3], projected.messages[0].content[2])
  assert.equal(restored.messages[0].content[5], second)
  assert.equal(restored.messages[0].content[6], projected.messages[0].content[4])
  assert.ok(restored.messages[0].content[1].text.startsWith(projected.messages[0].content[1].text), 'retain the exact original core note as a prefix')
  assert.match(restored.messages[0].content[1].text, /\/execution\/read-only\/first\.pdf/)
  assert.match(restored.messages[0].content[1].text, /verbatim read-only copy/)
  assert.match(restored.messages[0].content[1].text, /copy it to a writable location/)
  assert.ok(restored.messages[0].content[4].text.startsWith(projected.messages[0].content[3].text))
  assert.match(restored.messages[0].content[4].text, /cannot access a readable path/)
  for (const index of [1, 4]) {
    assert.match(restored.messages[0].content[index].text, /Available file contents are attached natively/)
    assert.match(restored.messages[0].content[index].text, /local-path note above concerns local file tools only/)
  }
  assert.equal(JSON.stringify([original, projected]), before)
})

test('a request that already contains native files retains one copy without manufacturing a path', async () => {
  const original = request('already-native.pdf')
  let restored
  for await (const _ of withNativeFileContext(original, async function* () {
    restored = restoreNativeFiles(original)
    yield { type: 'finish', reason: { kind: 'stop' } }
  })) { /* consume */ }
  assert.equal(restored, original)
  assert.equal(restored.messages[0].content.length, 1)
  assert.equal(restored.messages[0].content[0].type, 'file')
})

test('concurrent native file contexts never exchange attachments and cleanup runs inside its own context', async () => {
  const first = request('one.mp4')
  const second = request('two.pdf')
  const projected = r => ({ ...r, messages: [{ ...r.messages[0], content: [{ type: 'text', text: 'handle' }] }] })
  const seen = []
  let release
  const wait = new Promise(resolve => { release = resolve })
  const iter = r => withNativeFileContext(r, async function* () {
    await wait
    try {
      seen.push(restoreNativeFiles(projected(r)).messages[0].content[1].attachment.name)
      yield { type: 'finish', reason: { kind: 'stop' } }
    } finally {
      seen.push(`cleanup:${restoreNativeFiles(projected(r)).messages[0].content[1].attachment.name}`)
    }
  })[Symbol.asyncIterator]()
  const one = iter(first)
  const two = iter(second)
  const pending = [one.next(), two.next()]
  release()
  await Promise.all(pending)
  await Promise.all([one.return(), two.return()])
  assert.deepEqual(seen.sort(), ['cleanup:one.mp4', 'cleanup:two.pdf', 'one.mp4', 'two.pdf'].sort())
})

test('bridge refuses a changed block shape rather than assigning the wrong attachment', async () => {
  const original = request('report.pdf')
  const projected = { ...original, messages: [{ ...original.messages[0], content: [] }] }
  const consume = async () => {
    for await (const _ of withNativeFileContext(original, async function* () {
      restoreNativeFiles(projected)
      yield { type: 'finish', reason: { kind: 'stop' } }
    })) { /* consume scope */ }
  }
  await assert.rejects(consume, error => error.code === 'NATIVE_FILE_BRIDGE_MISMATCH')
})

test('nested requests without files shadow outer native file references even when route and IDs match', async () => {
  const outer = request('outer.pdf')
  const inner = { ...outer, messages: [{ ...outer.messages[0], content: [{ type: 'text', text: 'inner text only' }] }] }
  let restored
  for await (const _ of withNativeFileContext(outer, async function* () {
    yield* withNativeFileContext(inner, async function* () {
      restored = restoreNativeFiles(inner)
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
  })) { /* consume scopes */ }
  assert.equal(restored, inner)
  assert.equal(restored.messages[0].content[0].text, 'inner text only')
})

test('default config resolves both native routes with independent snapshots', () => {
  const config = Config({})
  const one = profilesOf(config)
  const two = profilesOf(config)
  assert.equal(one['google-ai-studio'].apiKeyEnv, 'GOOGLE_API_KEY')
  assert.equal(one['google-vertex-native'].vertexAuth, 'adc')
  one['google-ai-studio'].models[0].id = 'edited'
  assert.equal(two['google-ai-studio'].models[0].id, 'gemini-2.5-flash')
})

test('native configuration rejects incompatible thinking modes and credentials in endpoint URLs', () => {
  const profile = defaultProfile('google-ai-studio')
  profile.generationConfig = { thinkingConfig: { thinkingBudget: -1, thinkingLevel: 'HIGH' } }
  assert.throws(() => validateProfile('google-ai-studio', profile), error => error.code === 'INVALID_CONFIG')
  profile.generationConfig = {}
  profile.baseURL = 'https://user:secret@example.com/'
  assert.throws(() => validateProfile('google-ai-studio', profile), error => error.code === 'INVALID_CONFIG')
})

function runtimeFixture() {
  const ctx = new Context()
  new LlmRuntime(ctx)
  const bytes = Buffer.from('%PDF-1.7\nverified native attachment')
  let reads = 0
  ctx.provide('attachments', {
    fileHostPath: () => undefined,
    async *readFileStream() { reads++; yield bytes },
  })
  let profiles = {
    'google-ai-studio': defaultProfile('google-ai-studio'),
    'google-vertex-native': defaultProfile('google-vertex-native'),
  }
  const calls = []
  const adapter = new GoogleNativeAdapter(ctx, {
    profiles: () => profiles,
    resolveApiKey: async () => 'test-only-not-a-real-key',
    createClient: () => ({ models: { generateContentStream: async parameters => {
      calls.push(parameters)
      return (async function* () {
        yield { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }
      })()
    } } }),
  })
  ctx.llm.registerAdapter(['google-ai-studio', 'google-vertex-native'], adapter)
  registerNativeFileBridge(ctx)
  const user = createUserMessage({ source: { kind: 'user' }, content: [
    { type: 'text', text: 'Read this PDF' },
    { type: 'file', attachment: { attachmentId: 'a'.repeat(64), name: 'report.pdf', bytes: bytes.byteLength } },
  ] })
  return { ctx, adapter, user, bytes, calls, reads: () => reads, setProfiles: value => { profiles = value }, profiles }
}

const collect = async iterable => { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks }

test('actual rc.5 LlmRuntime sends verified attachment bytes through the native file bridge', async () => {
  const fixture = runtimeFixture()
  const chunks = await collect(fixture.ctx.llm.stream({
    provider: 'google-ai-studio', model: 'gemini-2.5-flash', messages: [fixture.user],
  }))
  assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks.at(-1)))
  assert.equal(fixture.reads(), 1)
  assert.match(fixture.calls[0].contents[0].parts[1].text, /cannot access a readable path/)
  assert.deepEqual(fixture.calls[0].contents[0].parts[2], {
    inlineData: { mimeType: 'application/pdf', data: fixture.bytes.toString('base64') },
  })
  assert.equal(fixture.user.content[1].type, 'file')
  assert.ok(Object.isFrozen(fixture.user))
})

test('actual rc.5 prepared call preserves its captured Google generation across configuration edits', async () => {
  const fixture = runtimeFixture()
  fixture.profiles['google-ai-studio'].generationConfig.temperature = 0.2
  fixture.profiles['google-ai-studio'].models[0].maxTokens = 128
  const prepared = await fixture.ctx.llm.prepareCall({ provider: 'google-ai-studio', model: 'gemini-2.5-flash' })
  const replacement = structuredClone(fixture.profiles)
  replacement['google-ai-studio'].generationConfig.temperature = 0.9
  replacement['google-ai-studio'].models[0].maxTokens = 999
  fixture.setProfiles(replacement)
  const chunks = await collect(prepared.stream({ ...prepared.config, messages: [fixture.user] }))
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(fixture.calls[0].config.temperature, 0.2)
  assert.equal(fixture.calls[0].config.maxOutputTokens, 128)
})

test('actual rc.5 bridge retains core cross-provider replay isolation', async () => {
  const fixture = runtimeFixture()
  class Foreign extends LlmAdapter { async *stream() { yield { type: 'finish', reason: { kind: 'stop' } } } }
  fixture.ctx.llm.registerAdapter(['foreign'], new Foreign())
  const assistant = createAssistantMessage({ source: { provider: 'foreign', model: 'foreign-model',
    replayState: { response: { format: 'google-native-v1' }, blocks: [{ parts: [{ text: 'public text', thoughtSignature: 'PRIVATE_SIGNATURE' }] }] } },
    content: [{ type: 'text', text: 'public text' }],
  })
  assert.ok(JSON.stringify(assistant).includes('PRIVATE_SIGNATURE'))
  const chunks = await collect(fixture.ctx.llm.stream({
    provider: 'google-ai-studio', model: 'gemini-2.5-flash', messages: [assistant, fixture.user],
  }))
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.ok(!JSON.stringify(fixture.calls[0]).includes('PRIVATE_SIGNATURE'))
  assert.equal(fixture.calls[0].contents[1].parts[2].inlineData.mimeType, 'application/pdf')
})

test('actual rc.5 bridge keeps assistant media, text and function signatures byte-identical', async () => {
  const fixture = runtimeFixture()
  const thought = { type: 'reasoning', text: 'Recorded thought' }
  const media = { type: 'file', attachment: { attachmentId: 'b'.repeat(64), name: 'generated.wav', bytes: 4 } }
  const text = { type: 'text', text: 'Recorded answer' }
  const call = { type: 'tool-call', id: 'local-call', name: 'inspect_file', arguments: '{"q":"next"}' }
  const parts = [
    { text: thought.text, thought: true, thoughtSignature: 'THOUGHT_SIGNATURE' },
    { inlineData: { mimeType: 'audio/wav', data: 'AAECAw==' }, thoughtSignature: 'MEDIA_SIGNATURE' },
    { text: text.text, thoughtSignature: 'TEXT_SIGNATURE' },
    { functionCall: { id: 'native-call', name: call.name, args: { q: 'next' } }, thoughtSignature: 'CALL_SIGNATURE' },
  ]
  const content = [thought, media, text, call]
  const assistant = createAssistantMessage({ content, source: { provider: 'google-ai-studio', model: 'gemini-2.5-flash',
    replayState: { response: { format: 'google-native-v1' }, blocks: content.map((block, index) => ({ block, parts: [parts[index]] })) } },
  })
  const original = JSON.stringify(assistant)
  const result = createToolResultMessage({ callId: call.id, content: [{ type: 'text', text: 'Done' }], isError: false })
  const followup = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue' }] })
  const chunks = await collect(fixture.ctx.llm.stream({ provider: 'google-ai-studio', model: 'gemini-2.5-flash', messages: [assistant, result, followup] }))
  assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks.at(-1)))
  assert.deepEqual(fixture.calls[0].contents[0].parts, parts)
  assert.equal(fixture.calls[0].contents[1].parts[0].functionResponse.id, 'native-call')
  assert.equal(fixture.reads(), 0, 'generated native media must replay without reading or reuploading storage')
  assert.equal(JSON.stringify(assistant), original)
})

test('actual rc.5 bridge preserves pre-network reasoning validation and terminal error normalization', async () => {
  const fixture = runtimeFixture()
  const chunks = await collect(fixture.ctx.llm.stream({
    provider: 'google-ai-studio', model: 'gemini-2.5-flash', messages: [fixture.user],
    reasoningEffort: ReasoningEffortId('unsupported'),
  }))
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].reason.kind, 'error')
  assert.equal(fixture.calls.length, 0)
  assert.equal(fixture.reads(), 0)
})

test('actual Cordis plugin mounts both provider routes and removes service, directory and bridge on disposal', async () => {
  const ctx = new Context()
  new LlmRuntime(ctx)
  ctx.provide('attachments', { fileHostPath: () => undefined })
  const fiber = await ctx.plugin(GooglePlugin, {})
  assert.deepEqual(ctx.llm.listProviders().map(value => value.id), ['google-ai-studio', 'google-vertex-native'])
  assert.equal(typeof ctx.nativeGoogle.client, 'function')
  assert.equal(ctx.llm.listConfigurableProviders().length, 2)
  assert.equal((await ctx.llm.listModels('google-ai-studio'))[0].id, 'gemini-2.5-flash')
  await fiber.dispose()
  assert.deepEqual(ctx.llm.listProviders(), [])
  assert.deepEqual(ctx.llm.listConfigurableProviders(), [])
  assert.equal(ctx.get('nativeGoogle'), undefined)
})

test('rc.5 bundle reader accepts the published manifest and composes its installable plugin row', async () => {
  const directory = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const paths = bundlePatchPaths(directory, manifest.dsh.bundle)
  const patches = paths.map(path => loadOverlayPatches('dsh-google-native packaging test', path))
  const entries = composeEntries(patches)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'dsh-google-native')
  const plugin = await import(new URL(manifest.exports['.'].default, new URL('../', import.meta.url)))
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  for (const runtime of ['0.2.1-rc.5', '0.2.2-rc.1', '0.3.0-alpha.1', '1.0.0']) assert.equal(evaluatePluginCompatibility(manifest, {}, runtime), undefined, runtime)
})
