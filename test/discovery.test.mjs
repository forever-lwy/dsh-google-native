import test from 'node:test'
import assert from 'node:assert/strict'
import { GoogleGenAI } from '@google/genai'
import { discoverGoogleModels } from '../lib/discovery.js'
import { googleFetch } from '../lib/transport.js'

const asResponse = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const model = (name, supportedGenerationMethods = ['generateContent']) => ({ name, supportedGenerationMethods })
const client = (backend = 'ai-studio', options = {}) => new GoogleGenAI({ vertexai: backend === 'vertex', apiKey: 'offline-test-key',
  apiVersion: backend === 'vertex' ? 'v1beta1' : 'v1beta',
  httpOptions: { baseUrl: 'https://gateway.test/native', fetch: googleFetch, retryOptions: { attempts: 1 } }, ...options })

test('actual AI Studio SDK discovery follows native pages through custom Base URL and filters declared actions', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const parsed = new URL(url)
    requests.push(parsed)
    assert.equal(init.method, 'GET')
    assert.equal(parsed.pathname, '/native/v1beta/models')
    assert.equal(parsed.searchParams.get('pageSize'), '100')
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'offline-test-key')
    assert.match(new Headers(init.headers).get('user-agent'), /deepseek-harness/)
    if (!parsed.searchParams.has('pageToken')) return asResponse({ models: [
      { ...model('models/gemini-4-argon'), displayName: 'Gemini Argon', description: 'Native model', inputTokenLimit: 1_000_000, outputTokenLimit: 65_536,
        supportedInputModalities: ['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'PDF'], supportedOutputModalities: ['TEXT', 'IMAGE'] },
      model('models/gemini-embedding-2', ['embedContent']), model('models/gemini-live', ['bidiGenerateContent']),
      model('models/empty-actions', []),
    ], nextPageToken: 'second-page' })
    assert.equal(parsed.searchParams.get('pageToken'), 'second-page')
    return asResponse({ models: [model('models/gemini-4-argon'), { name: 'models/custom-chat', displayName: 'Custom Chat' },
      { name: 'models/veo-3' }, { name: 'models/text-embedding-004' }, { name: 'models/gemini-3.8-live' },
      model('projects/p/locations/l/models/tuned-model'), model('publishers/custom/models/custom-route'),
    ] })
  })
  const models = await discoverGoogleModels(client(), 'ai-studio')
  assert.equal(requests.length, 2)
  assert.deepEqual(models, [
    { id: 'gemini-4-argon', name: 'Gemini Argon', description: 'Native model', contextWindow: 1_000_000, maxTokens: 65_536,
      inputTypes: ['text', 'image', 'audio', 'video', 'pdf'], outputTypes: ['text', 'image'], supportsGenerateContent: true },
    { id: 'custom-chat', name: 'Custom Chat' },
    { id: 'projects/p/locations/l/models/tuned-model', name: 'projects/p/locations/l/models/tuned-model', supportsGenerateContent: true },
    { id: 'publishers/custom/models/custom-route', name: 'publishers/custom/models/custom-route', supportsGenerateContent: true },
  ])
})

for (const auth of ['express', 'adc']) {
  test(`actual Vertex ${auth} SDK retains returned gateway metadata, normalizes Google IDs and generates with the selected ID`, async t => {
    const requests = []
    const options = auth === 'adc' ? { apiKey: undefined, project: 'offline-project', location: 'global', googleAuthOptions: {
      authClient: { getRequestHeaders: async () => new Headers({ authorization: 'Bearer offline-token' }) },
    } } : {}
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const parsed = new URL(url)
      requests.push(parsed)
      const headers = new Headers(init.headers)
      if (auth === 'adc') assert.equal(headers.get('authorization'), 'Bearer offline-token')
      else assert.equal(headers.get('x-goog-api-key'), 'offline-test-key')
      if (init.method === 'POST') {
        const project = auth === 'adc' ? '/projects/offline-project/locations/global' : ''
        assert.equal(parsed.pathname, `/native/v1beta1${project}/publishers/google/models/gemini-3.8-flash:generateContent`)
        return asResponse({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] })
      }
      assert.equal(parsed.pathname, '/native/v1beta1/publishers/google/models')
      if (!parsed.searchParams.has('pageToken')) return asResponse({ publisherModels: [
        { name: 'publishers/google/models/gemini-3.8-flash', displayName: 'Gemini Flash', inputTokenLimit: 12345, outputTokenLimit: 678,
          inputModalities: ['TEXT', 'AUDIO', 'VIDEO', 'PDF'], outputModalities: ['TEXT'],
          supportedActions: { openGenerationAiStudio: { title: 'Playground' } } },
        { name: 'publishers/google/models/imagen-4' }, { name: 'publishers/google/models/gemini-live' },
      ], nextPageToken: 'next-vertex' })
      assert.equal(parsed.searchParams.get('pageToken'), 'next-vertex')
      return asResponse({ publisherModels: [{ name: 'publishers/google/models/custom-alias' }] })
    })
    const sdk = client('vertex', options)
    const models = await discoverGoogleModels(sdk, 'vertex')
    assert.deepEqual(models, [{ id: 'gemini-3.8-flash', name: 'Gemini Flash', contextWindow: 12345, maxTokens: 678,
      inputTypes: ['text', 'audio', 'video', 'pdf'], outputTypes: ['text'] }, { id: 'custom-alias', name: 'custom-alias' }])
    assert.equal(models[0].supportsGenerateContent, undefined, 'PublisherModel CallToAction objects do not declare generation methods')
    assert.equal(requests.length, 2, 'metadata capture adds no per-model detail or generation requests')
    await sdk.models.generateContent({ model: models[0].id, contents: 'hello' })
    assert.equal(requests.length, 3)
  })
}

test('discovery abort propagates to a later SDK page and never requests another page', async t => {
  const controller = new AbortController()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (++calls === 1) return asResponse({ models: [model('models/first')], nextPageToken: 'next' })
    return new Promise((_resolve, reject) => {
      assert.ok(init.signal)
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
      controller.abort()
    })
  })
  await assert.rejects(discoverGoogleModels(client(), 'ai-studio', controller.signal), error => error.code === 'ABORTED')
  assert.equal(calls, 2)
})

test('native and explicit gateway metadata aliases survive the actual SDK converters without inferring missing declarations', async t => {
  t.mock.method(globalThis, 'fetch', async () => asResponse({ models: [
    { ...model('models/snake-fields'), input_token_limit: 8192, output_token_limit: 256,
      supported_input_modalities: ['TEXT', 'AUDIO', 'PDF', 'TEXT'], supported_output_modalities: ['TEXT', 'AUDIO'] },
    { ...model('models/nested-fields'), architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
      limits: { context_length: 16384, max_output_tokens: 512 } },
    { ...model('models/capability-fields'), capabilities: { contextWindow: 2048, maxOutputTokens: 4096,
      inputTypes: ['text', 'video'], outputTypes: ['text'] } },
    { ...model('models/gemini-3.8-flash-image'), inputTokenLimit: 10000, outputTokenLimit: 1000, responseModalities: ['TEXT', 'IMAGE'] },
  ] }))
  assert.deepEqual(await discoverGoogleModels(client(), 'ai-studio'), [
    { id: 'snake-fields', name: 'snake-fields', contextWindow: 8192, maxTokens: 256,
      inputTypes: ['text', 'audio', 'pdf'], outputTypes: ['text', 'audio'], supportsGenerateContent: true },
    { id: 'nested-fields', name: 'nested-fields', contextWindow: 16384, maxTokens: 512,
      inputTypes: ['text', 'image'], outputTypes: ['image'], supportsGenerateContent: true },
    { id: 'capability-fields', name: 'capability-fields', contextWindow: 2048, maxTokens: 4096,
      inputTypes: ['text', 'video'], outputTypes: ['text'], supportsGenerateContent: true },
    { id: 'gemini-3.8-flash-image', name: 'gemini-3.8-flash-image', contextWindow: 10000, maxTokens: 1000, supportsGenerateContent: true },
  ])
})

test('official-style catalogs leave undisclosed types and capacities unknown on either backend', async t => {
  let backend = 'ai-studio'
  t.mock.method(globalThis, 'fetch', async () => asResponse(backend === 'ai-studio' ? { models: [
    { ...model('models/gemini-3.8-flash'), inputTokenLimit: 1000000, outputTokenLimit: 65536 },
  ] } : { publisherModels: [{ name: 'publishers/google/models/gemini-3.8-flash', versionId: '001',
    supportedActions: { viewRestApi: { title: 'Documentation' } } }] }))
  assert.deepEqual(await discoverGoogleModels(client(), backend), [{ id: 'gemini-3.8-flash', name: 'gemini-3.8-flash',
    contextWindow: 1000000, maxTokens: 65536, supportsGenerateContent: true }])
  backend = 'vertex'
  assert.deepEqual(await discoverGoogleModels(client(backend), backend), [{ id: 'gemini-3.8-flash', name: 'gemini-3.8-flash' }])
})

test('invalid or unrepresentable type declarations remain manual without rejecting other model metadata', async t => {
  const rows = [
    { ...model('models/empty-types'), inputModalities: [], outputModalities: [] },
    { ...model('models/only-audio'), inputModalities: ['AUDIO'], outputModalities: ['VIDEO'] },
    { ...model('models/partly-unknown'), inputModalities: ['TEXT', 'DOCUMENT'], outputModalities: ['TEXT', 'VIDEO'] },
    { ...model('models/malformed'), inputModalities: ['TEXT', 42], outputModalities: 'TEXT' },
    { ...model('models/huge-arrays'), inputModalities: Array(33).fill('TEXT'), outputModalities: [null] },
  ]
  t.mock.method(globalThis, 'fetch', async () => asResponse({ models: rows }))
  assert.deepEqual(await discoverGoogleModels(client(), 'ai-studio'), rows.map(row => {
    const id = row.name.slice('models/'.length)
    return { id, name: id, supportsGenerateContent: true }
  }))
})

test('repeating SDK pagination tokens are rejected before an unbounded list loop', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return asResponse({ models: [model(`models/model-${calls}`)], nextPageToken: 'unchanging' })
  })
  await assert.rejects(discoverGoogleModels(client(), 'ai-studio'), error => error.code === 'MODEL_DISCOVERY_PAGINATION')
  assert.equal(calls, 2)
})

test('empty terminal page tokens finish without requesting the same catalog again', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return asResponse({ models: [model('models/only')], nextPageToken: '' })
  })
  const result = await discoverGoogleModels(client(), 'ai-studio')
  assert.equal(calls, 1)
  assert.equal(result[0].id, 'only')
})

test('catalog pagination has a fixed upper bound even when the upstream invents new tokens forever', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return asResponse({ models: [model(`models/model-${calls}`)], nextPageToken: `next-${calls}` })
  })
  await assert.rejects(discoverGoogleModels(client(), 'ai-studio'), error => error.code === 'MODEL_DISCOVERY_LIMIT')
  assert.equal(calls, 100)
})

test('candidate limits match the UI/RPC maximum instead of returning an unusable oversized result', async t => {
  t.mock.method(globalThis, 'fetch', async () => asResponse({ models: Array.from({ length: 1001 }, (_, i) => model(`models/model-${i}`)) }))
  await assert.rejects(discoverGoogleModels(client(), 'ai-studio'), error => error.code === 'MODEL_DISCOVERY_LIMIT' && error.message.includes('1000'))
})

test('invalid resource paths and non-finite limits are never promoted to catalog configuration', async t => {
  t.mock.method(globalThis, 'fetch', async () => asResponse({ models: [
    model('https://other.test/models/key'), model('models/../traversal'), model('models/unsafe?key=value'), model('models/new\nline'),
    { ...model('models/custom'), displayName: '', inputTokenLimit: -1, outputTokenLimit: 1.5 },
    { ...model('models/gemini-native-audio'), displayName: 'Explicit native content endpoint' },
  ] }))
  assert.deepEqual(await discoverGoogleModels(client(), 'ai-studio'), [
    { id: 'custom', name: 'custom', supportsGenerateContent: true },
    { id: 'gemini-native-audio', name: 'Explicit native content endpoint', supportsGenerateContent: true },
  ])
})

test('upstream catalog errors retain safe classifications without reflecting provider bodies or credentials', async t => {
  const secret = 'provider-body-offline-secret'
  let status = 404
  // Use one mock registration so cleanup restores the real process-wide fetch
  // when this suite shares a realm with subsequent real-network tests.
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: secret } }), { status, headers: { 'content-type': 'application/json' } }))
  await assert.rejects(discoverGoogleModels(client(), 'ai-studio'), error => error.code === 'MODEL_DISCOVERY_UNAVAILABLE' && !error.message.includes(secret))
  status = 403
  await assert.rejects(discoverGoogleModels(client(), 'ai-studio'), error => error.code === 'AUTH' && !error.message.includes(secret))
})

test('a canceled or backend-mismatched operation never calls the upstream', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not fetch') })
  const signal = AbortSignal.abort()
  await assert.rejects(discoverGoogleModels(client(), 'ai-studio', signal), error => error.code === 'ABORTED')
  await assert.rejects(discoverGoogleModels(client(), 'vertex'), error => error.code === 'INVALID_CONFIG')
  assert.equal(calls, 0)
})
