import test from 'node:test'
import assert from 'node:assert/strict'
import { GoogleGenAI } from '@google/genai'
import { BlockAssembler, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { GoogleNativeAdapter, buildGenerationConfig } from '../lib/adapter.js'
import { defaultProfile } from '../lib/config.js'
import { translateStream } from '../lib/stream.js'
import { translateMessages } from '../lib/messages.js'

const ai = 'google-ai-studio'
const vertex = 'google-vertex-native'
const profileSet = () => ({ [ai]: defaultProfile(ai), [vertex]: defaultProfile(vertex) })
const input = (provider = ai) => ({ provider, model: 'gemini-2.5-flash', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] })
const stop = { candidates: [{ content: { role: 'model', parts: [{ text: 'response' }] }, finishReason: 'STOP' }] }
async function collect(iterable) { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks }
async function* events(...items) { yield* items }

test('official SDK wire preserves native search, structured output, thinking, headers and cancellation', async t => {
  const profiles = profileSet()
  const profile = profiles[ai]
  profile.nativeTools.search = true
  profile.generationConfig = { thinkingConfig: { includeThoughts: true }, responseMimeType: 'application/json', responseJsonSchema: { type: 'object' }, topP: 0.8,
    httpOptions: { extraBody: { generationConfig: { seed: 7 } }, headers: { 'x-custom': 'yes' } } }
  const captured = []
  const controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    captured.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers), signal: init.signal })
    return new Response(`data: ${JSON.stringify(stop)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const adapter = new GoogleNativeAdapter({ attachments: {} }, { profiles: () => profiles, resolveApiKey: async () => 'offline-test-key' })
  const chunks = await collect(adapter.stream({ ...input(), reasoningEffort: 'low', signal: controller.signal, tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }] }))
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(captured.length, 1)
  const request = captured[0]
  assert.match(request.url, /generativelanguage.googleapis.com\/v1beta\/models\/gemini-2.5-flash:streamGenerateContent/)
  assert.equal(request.headers.get('x-goog-api-key'), 'offline-test-key')
  assert.match(request.headers.get('user-agent'), /deepseek-harness/)
  assert.equal(request.headers.get('x-custom'), 'yes')
  assert.equal(request.body.generationConfig.thinkingConfig.thinkingBudget, 1024)
  assert.equal(request.body.generationConfig.thinkingConfig.includeThoughts, true)
  assert.equal(request.body.generationConfig.responseMimeType, 'application/json')
  assert.deepEqual(request.body.generationConfig.responseJsonSchema, { type: 'object' })
  assert.equal(request.body.generationConfig.seed, 7)
  assert.ok(request.body.tools.some(tool => tool.googleSearch))
  assert.ok(request.body.tools.some(tool => tool.functionDeclarations?.[0].name === 'lookup'))
  assert.ok(request.signal)
})

test('Vertex Express wire uses Vertex endpoint, API key, no project resource path', async t => {
  const profiles = profileSet()
  profiles[vertex].vertexAuth = 'api-key'
  profiles[vertex].project = 'ignored-project'
  profiles[vertex].keyFile = '/ignored.json'
  let request
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    request = { url: String(url), headers: new Headers(init.headers) }
    return new Response(`data: ${JSON.stringify(stop)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const adapter = new GoogleNativeAdapter({ attachments: {} }, { profiles: () => profiles, resolveApiKey: async () => 'express-test-key' })
  await collect(adapter.stream(input(vertex)))
  assert.match(request.url, /aiplatform.googleapis.com/)
  assert.doesNotMatch(request.url, /projects\//)
  assert.equal(request.headers.get('x-goog-api-key'), 'express-test-key')
})

test('standard Vertex wire uses project/location and OAuth auth client instead of API key', async t => {
  const profiles = profileSet()
  profiles[vertex].project = 'offline-project'
  profiles[vertex].location = 'global'
  profiles[vertex].keyFile = '/container/private/service-account.json'
  let request
  let options
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    request = { url: String(url), headers: new Headers(init.headers) }
    return new Response(`data: ${JSON.stringify(stop)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const adapter = new GoogleNativeAdapter({ attachments: {} }, { profiles: () => profiles, resolveApiKey: async () => { throw new Error('must use ADC') },
    createClient: config => {
      options = config
      return new GoogleGenAI({ ...config, googleAuthOptions: { authClient: { getRequestHeaders: async () => new Headers({ authorization: 'Bearer offline-token' }) } } })
    } })
  await collect(adapter.stream(input(vertex)))
  assert.equal(options.googleAuthOptions.keyFile, '/container/private/service-account.json')
  assert.equal(options.apiKey, undefined)
  assert.match(request.url, /aiplatform.googleapis.com\/v1beta1\/projects\/offline-project\/locations\/global\/publishers\/google\/models\/gemini-2.5-flash/)
  assert.equal(request.headers.get('authorization'), 'Bearer offline-token')
})

test('stream signatures and parallel calls survive assembly, persistence and tool reply replay', async () => {
  const parts = [
    { text: 'Reasoning ', thought: true }, { text: 'summary', thought: true, thoughtSignature: 'thought-signature' },
    { functionCall: { name: 'first', args: { a: 1 } }, thoughtSignature: 'first-call-signature' },
    { functionCall: { id: 'native-second', name: 'second', args: {} } },
    { thoughtSignature: 'tail-signature' },
  ]
  const chunks = await collect(translateStream(events(
    { candidates: [{ content: { parts: parts.slice(0, 1) } }] },
    { candidates: [{ content: { parts: parts.slice(1) }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 10, thoughtsTokenCount: 5, totalTokenCount: 115 } },
  ), input(), {}))
  const assembler = new BlockAssembler()
  chunks.forEach(chunk => assembler.push(chunk))
  assert.equal(assembler.finish.kind, 'tool-calls')
  assert.deepEqual(assembler.usage, { inputTokens: 60, cacheReadTokens: 40, outputTokens: 15, reasoningTokens: 5, totalTokens: 115 })
  const message = JSON.parse(JSON.stringify(assembler.message({ provider: ai, model: input().model, replayState: assembler.replayState })))
  const calls = message.content.filter(block => block.type === 'tool-call')
  const replay = await translateMessages({ ...input(), messages: [message, ...calls.map(call => createToolResultMessage({ callId: call.id, content: [{ type: 'text', text: 'result' }], isError: false }))] }, {})
  assert.deepEqual(replay.contents[0].parts, parts)
  assert.equal(replay.contents[1].parts[0].functionResponse.id, undefined)
  assert.equal(replay.contents[1].parts[1].functionResponse.id, 'native-second')
})

test('search citations are visible and complete native grounding metadata is retained', async () => {
  const groundingMetadata = { groundingChunks: [{ web: { uri: 'https://example.com/page', title: 'Example' } }], webSearchQueries: ['query'], searchEntryPoint: { renderedContent: '<div>Google suggestions</div>' } }
  const chunks = await collect(translateStream(events({ candidates: [{ content: { parts: [{ text: 'Answer' }] }, groundingMetadata, finishReason: 'STOP' }] }), input(), {}))
  assert.match(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), /\[Example\]\(https:\/\/example.com\/page\)/)
  assert.deepEqual(chunks.at(-1).replayState.response.candidates[0].groundingMetadata, groundingMetadata)
})

test('blocked, empty and truncated streams never produce a successful terminal finish', async () => {
  await assert.rejects(collect(translateStream(events({ promptFeedback: { blockReason: 'SAFETY' } }), input(), {})), error => error.code === 'CONTENT_FILTER')
  await assert.rejects(collect(translateStream(events({ candidates: [{ finishReason: 'STOP' }] }), input(), {})), error => error.code === 'EMPTY_RESPONSE')
  await assert.rejects(collect(translateStream(events({ candidates: [{ content: { parts: [{ text: 'partial' }] } }] }), input(), {})), error => error.code === 'INCOMPLETE_RESPONSE')
})

test('adjacent generated audio chunks become one durable native file', async () => {
  let saved
  const chunks = await collect(translateStream(events({ candidates: [{ content: { parts: [
    { inlineData: { mimeType: 'audio/pcm', data: Buffer.from('one').toString('base64') } },
    { inlineData: { mimeType: 'audio/pcm', data: Buffer.from('two').toString('base64') } },
  ] }, finishReason: 'STOP' }] }), input(), { async saveFile(file) { saved = file; return { attachmentId: 'output', name: file.name, bytes: file.data.length } } }))
  assert.equal(saved.data.toString(), 'onetwo')
  assert.equal(chunks.filter(chunk => chunk.type === 'block-end').length, 1)
  assert.equal(chunks.at(-1).replayState.blocks[0].parts.length, 2)
})

test('prepared calls bind profile parameters and preserve per-call precedence', async () => {
  const profiles = profileSet()
  profiles[ai].generationConfig.topP = 0.7
  let requested
  const adapter = new GoogleNativeAdapter({ attachments: {} }, { profiles: () => profiles, resolveApiKey: async () => 'test-key',
    createClient: () => ({ models: { async generateContentStream(parameters) { requested = parameters; return events(stop) } } }) })
  const prepared = await adapter.prepareCall(ai, input().model)
  profiles[ai].generationConfig.topP = 0.2
  await collect(prepared.stream({ ...input(), temperature: 0.1, maxTokens: 64 }))
  assert.equal(requested.config.topP, 0.7)
  assert.equal(requested.config.temperature, 0.1)
  assert.equal(requested.config.maxOutputTokens, 64)
  assert.throws(() => buildGenerationConfig({ ...profiles[ai], generationConfig: { candidateCount: 2 } }, undefined, input()), error => error.code === 'UNSUPPORTED_PARAMETER')
})

test('HTTP auth/rate errors are classified without leaking provider bodies or secrets', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'secret-key-should-not-appear' } }), { status: 429 }))
  const profiles = profileSet()
  const adapter = new GoogleNativeAdapter({ attachments: {} }, { profiles: () => profiles, resolveApiKey: async () => 'secret-key-should-not-appear' })
  await assert.rejects(collect(adapter.stream(input())), error => error.code === 'RATE_LIMIT' && !error.message.includes('secret-key-should-not-appear'))
})
