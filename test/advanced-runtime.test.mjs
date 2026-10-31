import assert from 'node:assert/strict'
import test from 'node:test'
import { GoogleNativeAdapter, buildGenerationConfig } from '../lib/adapter.js'
import { defaultProfile } from '../lib/config.js'
import { NativeFileStore } from '../lib/files.js'
import { translateMessages } from '../lib/messages.js'
import { resolveCapabilities } from '../lib/capabilities.js'

const providers = ['google-ai-studio', 'google-vertex-native']
const profilesFor = () => Object.fromEntries(providers.map(provider => [provider, defaultProfile(provider)]))
const request = (provider, model, messages) => ({ provider, model, messages })
const user = content => ({ role: 'user', content })
const text = value => ({ type: 'text', text: value })
const pdf = Buffer.from('%PDF-1.7\nmodel input policy')
const audio = Buffer.from('RIFF0000WAVEvalid test content')
const file = (bytes, name = 'report.pdf', attachmentId = name) => ({ type: 'file', attachment: { attachmentId, name, bytes: bytes.length } })

for (const provider of providers) {
  test(`actual SDK ${provider} sends per-model capacities, output modalities and thinking dialect`, async t => {
    const calls = []
    const headers = []
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      calls.push(JSON.parse(init.body))
      headers.push(new Headers(init.headers))
      return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } })
    })
    const profiles = profilesFor()
    const profile = profiles[provider]
    profile.vertexAuth = 'api-key'
    profile.generationConfig.thinkingConfig = { thinkingBudget: 512, includeThoughts: true }
    profile.generationConfig.httpOptions = { headers: { 'x-keep-header': 'preserved' }, extraBody: {
      customRoot: 'preserved',
      generationConfig: { maxOutputTokens: 777, responseModalities: ['AUDIO'], topK: 7,
        thinkingConfig: { thinkingBudget: 900, includeThoughts: false, customThinking: 'preserved' } },
      generation_config: { max_output_tokens: 888, response_modalities: ['AUDIO'], top_p: 0.4,
        thinking_config: { thinking_budget: 100, thinking_level: 'LOW', include_thoughts: false, custom_thinking: 'preserved' } },
    } }
    const raw = structuredClone(profile.generationConfig.httpOptions)
    profile.models = [{ id: 'custom-advanced-model', name: 'Advanced model', contextWindow: 20000, maxTokens: 321,
      inputTypes: ['text', 'pdf'], generationConfig: {
        maxOutputTokens: 999, responseModalities: ['TEXT', 'IMAGE'], thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: true },
      } }]
    const adapter = new GoogleNativeAdapter({ attachments: {} }, { profiles: () => profiles, resolveApiKey: async () => 'offline-model-settings-key' })
    const resolved = await adapter.resolveModel(provider, profile.models[0].id)
    assert.equal(resolved.context.contextWindow, 20000)
    assert.equal(resolved.defaultMaxTokens, 321)
    assert.deepEqual(resolved.inputModalities, ['text'])
    await Array.fromAsync(adapter.stream(request(provider, profile.models[0].id, [user([text('hello')])])))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].generationConfig.maxOutputTokens, 321)
    assert.deepEqual(calls[0].generationConfig.responseModalities, ['TEXT', 'IMAGE'])
    assert.deepEqual(calls[0].generationConfig.thinkingConfig, { includeThoughts: true, thinkingLevel: 'HIGH', customThinking: 'preserved', custom_thinking: 'preserved' })
    assert.equal(calls[0].generationConfig.topK, 7)
    assert.equal(calls[0].customRoot, 'preserved')
    assert.equal(headers[0].get('x-keep-header'), 'preserved')
    assert.equal(calls[0].generationConfig.top_p, 0.4)
    assert.equal(calls[0].generation_config, undefined, 'there must be only one generation wrapper on the wire')
    assert.equal(calls[0].generationConfig.thinking_config, undefined, 'there must be only one thinking wrapper on the wire')
    assert.deepEqual(profile.generationConfig.httpOptions, raw, 'narrow alias cleanup must not mutate stored advanced settings')
  })
}

test('request output limits and selected effort override per-model defaults without mixing thinking dialects', () => {
  const profile = defaultProfile(providers[0])
  profile.generationConfig.thinkingConfig = { thinkingBudget: 1024, includeThoughts: true }
  const model = { id: 'custom', maxTokens: 4000,
    generationConfig: { maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: 'HIGH' } },
    reasoning: [{ id: 'summary-only', name: 'Keep model dialect', includeThoughts: false },
      { id: 'budget', name: 'Budget', thinkingBudget: 2048 }], defaultReasoning: 'summary-only' }
  const base = { provider: providers[0], model: model.id, messages: [] }
  const configured = buildGenerationConfig(profile, model, base)
  assert.equal(configured.maxOutputTokens, 4000)
  assert.deepEqual(configured.thinkingConfig, { thinkingLevel: 'HIGH', includeThoughts: false })
  const selected = buildGenerationConfig(profile, model, { ...base, maxTokens: 99, reasoningEffort: 'budget' })
  assert.equal(selected.maxOutputTokens, 99)
  assert.deepEqual(selected.thinkingConfig, { thinkingBudget: 2048, includeThoughts: true })
  assert.equal(profile.generationConfig.thinkingConfig.thinkingBudget, 1024)
  assert.equal(model.generationConfig.thinkingConfig.thinkingLevel, 'HIGH')
})

test('unowned raw generation fields remain effective, while nonobject overrides cannot erase explicit controls', () => {
  const profile = defaultProfile(providers[0])
  profile.generationConfig.httpOptions = { extraBody: { generationConfig: {
    responseModalities: ['AUDIO'], maxOutputTokens: 123, thinkingConfig: { thinkingBudget: 1024 }, custom: true,
  } } }
  const options = request(providers[0], 'custom', [])
  const kept = buildGenerationConfig(profile, { id: 'custom' }, options)
  assert.deepEqual(kept.httpOptions.extraBody, profile.generationConfig.httpOptions.extraBody)
  profile.generationConfig.httpOptions.extraBody.generationConfig = null
  assert.throws(() => buildGenerationConfig(profile, { id: 'custom', maxTokens: 42 }, options), error => error.code === 'INVALID_CONFIG')
})

test('owning a thinking dialect preserves an unowned raw summary flag in one canonical object', () => {
  const profile = defaultProfile(providers[0])
  profile.generationConfig.thinkingConfig = { thinkingBudget: 512, includeThoughts: true }
  profile.generationConfig.httpOptions = { extraBody: { generation_config: { thinking_config: {
    thinking_budget: 32, include_thoughts: false, custom: 'retained',
  } } } }
  const config = buildGenerationConfig(profile, { id: 'custom', generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } } },
    request(providers[0], 'custom', []))
  assert.deepEqual(config.thinkingConfig, { thinkingLevel: 'HIGH', includeThoughts: true })
  assert.deepEqual(config.httpOptions.extraBody, { generationConfig: { thinkingConfig: { includeThoughts: false, custom: 'retained' } } })
})

test('native file controls follow explicit input declarations without inferring search tools for custom models', () => {
  const custom = resolveCapabilities(providers[0], { id: 'private-pdf-model', inputTypes: ['text', 'pdf'] })
  assert.equal(custom.nativeFiles, true)
  assert.equal(custom.search, false)
  assert.equal(custom.urlContext, false)
  assert.equal(custom.codeExecution, false)
  assert.equal(custom.maps, false)
  assert.equal(resolveCapabilities(providers[0], { id: 'gemini-2.5-flash', inputTypes: ['text'] }).nativeFiles, false)
  assert.equal(resolveCapabilities(providers[0], { id: 'custom', inputTypes: ['text', 'pdf'], capabilities: { nativeFiles: false } }).nativeFiles, false)
})

test('an excluded MIME type rejects the complete request before even an earlier allowed file uploads', async () => {
  let uploads = 0
  let generations = 0
  const profiles = profilesFor()
  const profile = profiles[providers[0]]
  profile.models = [{ id: 'audio-only-media', inputTypes: ['text', 'audio'] }]
  profile.files.inlineThresholdBytes = 1
  const data = new Map([['audio', audio], ['pdf-disguised-as-audio', pdf]])
  const adapter = new GoogleNativeAdapter({ attachments: { async *readFileStream(ref) { yield data.get(ref.attachmentId) } } }, {
    profiles: () => profiles, resolveApiKey: async () => 'offline-key', createClient: () => ({
      files: { async upload() { uploads++; throw new Error('must not upload') } },
      models: { async generateContentStream() { generations++; throw new Error('must not generate') } },
    }),
  })
  await assert.rejects(Array.fromAsync(adapter.stream(request(providers[0], profile.models[0].id,
    [user([file(audio, 'sound.wav', 'audio'), file(pdf, 'disguised.wav', 'pdf-disguised-as-audio')])]))),
  error => error.code === 'UNSUPPORTED_INPUT_TYPE' && /pdf/.test(error.message))
  assert.equal(uploads, 0)
  assert.equal(generations, 0)
})

test('accepted declared PDF input retains original bytes, while a rejected image does not read storage', async () => {
  let images = 0
  const files = new NativeFileStore({}, 'ai-studio', {
    async *readFileStream() { yield pdf },
    async readImage() { images++; throw new Error('excluded image must not be read') },
  })
  const result = await translateMessages(request(providers[0], 'pdf-only-media', [user([file(pdf)])]), files, ['text', 'pdf'])
  assert.deepEqual(result.contents[0].parts, [{ inlineData: { mimeType: 'application/pdf', data: pdf.toString('base64') } }])
  await assert.rejects(translateMessages(request(providers[0], 'pdf-only-media', [user([{ type: 'image', attachment: { attachmentId: 'image' } }])]),
    files, ['text', 'pdf']), error => error.code === 'UNSUPPORTED_INPUT_TYPE')
  assert.equal(images, 0)
})

test('declared image, audio, video, PDF and text file inputs send original native MIME bytes', async () => {
  const samples = [
    ['image', 'picture.png', 'image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['audio', 'sound.wav', 'audio/wav', audio],
    ['video', 'movie.mp4', 'video/mp4', Buffer.from('0000ftypmp42native video fixture')],
    ['pdf', 'report.pdf', 'application/pdf', pdf],
    ['text', 'notes.txt', 'text/plain', Buffer.from('native text fixture')],
  ]
  for (const [type, name, mimeType, bytes] of samples) {
    const files = new NativeFileStore({}, 'vertex', { async *readFileStream() { yield bytes } })
    const input = request(providers[1], 'declared-media', [user([file(bytes, name)])])
    const result = await translateMessages(input, files, type === 'text' ? ['text'] : ['text', type])
    assert.deepEqual(result.contents[0].parts, [{ inlineData: { mimeType, data: bytes.toString('base64') } }])
    if (type !== 'text') await assert.rejects(translateMessages(input, files, ['text']), error => error.code === 'UNSUPPORTED_INPUT_TYPE')
  }
})

test('upload handle reuse rechecks the current model MIME declaration', async () => {
  let uploads = 0
  const files = new NativeFileStore({ files: {
    async upload() { uploads++; return { name: 'files/checked', state: 'ACTIVE', uri: 'https://generativelanguage.googleapis.com/v1beta/files/checked',
      mimeType: 'application/pdf', expirationTime: new Date(Date.now() + 3600000).toISOString() } },
  } }, 'ai-studio', { async *readFileStream() { yield pdf } }, { inlineThresholdBytes: 1 })
  const ref = file(pdf).attachment
  await files.filePart(ref, undefined, ['text', 'pdf'])
  await assert.rejects(files.filePart(ref, undefined, ['text']), error => error.code === 'UNSUPPORTED_INPUT_TYPE')
  await assert.rejects(files.validateInputType(ref, ['text']), error => error.code === 'UNSUPPORTED_INPUT_TYPE')
  assert.equal(uploads, 1)
})

test('exact assistant media replay survives a later declaration change without reading or uploading it again', async () => {
  const block = file(pdf)
  const parts = [{ inlineData: { mimeType: 'application/pdf', data: pdf.toString('base64') }, thoughtSignature: 'opaque-signature' }]
  const message = { role: 'assistant', content: [block], source: { kind: 'model', provider: providers[0], model: 'same-model',
    replayState: { response: { format: 'google-native-v1' }, blocks: [{ block: structuredClone(block), parts }] },
  } }
  const files = new NativeFileStore({}, 'ai-studio', { async *readFileStream() { throw new Error('exact replay must not read files') } })
  const result = await translateMessages(request(providers[0], 'same-model', [message]), files, ['text'])
  assert.deepEqual(result.contents[0].parts, parts)
})
