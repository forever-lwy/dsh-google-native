import test from 'node:test'
import assert from 'node:assert/strict'
import { GoogleGenAI } from '@google/genai'
import { createNativeGoogleClient, normalizeNativeEndpoint } from '../lib/client-factory.js'
import { defaultProfile } from '../lib/config.js'
import { GoogleNativeAdapter } from '../lib/adapter.js'

test('custom native roots accept version suffixes and preserve proxy prefixes without duplicate versions', () => {
  assert.deepEqual(normalizeNativeEndpoint(' https://proxy.example/native/v1beta/ ', undefined), { baseURL: 'https://proxy.example/native', apiVersion: 'v1beta' })
  assert.deepEqual(normalizeNativeEndpoint('https://proxy.example/native/v1beta1', 'v1'), { baseURL: 'https://proxy.example/native', apiVersion: 'v1' })
  assert.deepEqual(normalizeNativeEndpoint('https://proxy.example/native/', ''), { baseURL: 'https://proxy.example/native' })
  assert.deepEqual(normalizeNativeEndpoint('', ''), {})
  assert.deepEqual(normalizeNativeEndpoint(undefined, 'v1'), { apiVersion: 'v1' })
  for (const url of ['https://user:key@proxy.example', 'https://proxy.example?key=private', 'https://proxy.example#key', 'file:///etc/passwd', 'not-a-url']) {
    assert.throws(() => normalizeNativeEndpoint(url, undefined), error => error.code === 'INVALID_CONFIG')
  }
  assert.throws(() => normalizeNativeEndpoint('https://proxy.example', '../v1'), error => error.code === 'INVALID_CONFIG')
})

test('chat generation and model listing share a custom AI Studio endpoint and transient key', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: new Headers(init.headers) })
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'draft-only-key')
    assert.match(new Headers(init.headers).get('user-agent'), /deepseek-harness/)
    return String(url).includes(':generateContent')
      ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] }), { headers: { 'content-type': 'application/json' } })
  })
  const profile = defaultProfile('google-ai-studio')
  profile.enabled = false
  profile.baseURL = 'https://proxy.example/gemini/v1beta/'
  const client = createNativeGoogleClient(profile, 'draft-only-key')
  await client.models.list({ config: { queryBase: true } })
  await client.models.generateContent({ model: 'gemini-3.8-flash', contents: 'Hello' })
  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /^https:\/\/proxy.example\/gemini\/v1beta\/models(?:\?|$)/)
  assert.equal(calls[1].url, 'https://proxy.example/gemini/v1beta/models/gemini-3.8-flash:generateContent')
  assert.equal(profile.baseURL, 'https://proxy.example/gemini/v1beta/', 'unsaved draft is not rewritten')
})

test('standard Vertex keeps OAuth/project routing while using the configured prefix and explicit version', async t => {
  let wire
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    wire = { url: String(url), headers: new Headers(init.headers) }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } })
  })
  const profile = defaultProfile('google-vertex-native')
  profile.project = 'example-project'
  profile.keyFile = '/private/key.json'
  profile.baseURL = 'https://proxy.example/vertex/v1beta1'
  profile.apiVersion = 'v1'
  let options
  const client = createNativeGoogleClient(profile, 'must-not-use-key', value => {
    options = value
    return new GoogleGenAI({ ...value, googleAuthOptions: { authClient: { getRequestHeaders: async () => new Headers({ authorization: 'Bearer fake-token' }) } } })
  })
  await client.models.generateContent({ model: 'gemini-3.8-flash', contents: 'Hello' })
  assert.equal(options.apiKey, undefined)
  assert.equal(options.googleAuthOptions.keyFile, '/private/key.json')
  assert.equal(wire.url, 'https://proxy.example/vertex/v1/projects/example-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent')
  assert.equal(wire.headers.get('authorization'), 'Bearer fake-token')
  assert.equal(wire.headers.get('x-goog-api-key'), null)
})

test('a prepared chat keeps its original endpoint and key after the settings UI changes both', async () => {
  const profile = defaultProfile('google-ai-studio')
  profile.baseURL = 'https://old.example/google'
  const profiles = { 'google-ai-studio': profile, 'google-vertex-native': defaultProfile('google-vertex-native') }
  let key = 'old-key'
  const connected = []
  const dispatched = []
  const adapter = new GoogleNativeAdapter({ attachments: {} }, { profiles: () => profiles, resolveApiKey: async () => key,
    createClient: options => {
      connected.push(options)
      return { models: { async generateContentStream() {
        dispatched.push({ endpoint: options.httpOptions.baseUrl, key: options.apiKey })
        return (async function* () { yield { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] } })()
      } } }
    } })
  const prepared = await adapter.prepareCall('google-ai-studio', 'gemini-3.8-flash')
  profile.baseURL = 'https://new.example/google'
  key = 'new-key'
  const request = { provider: 'google-ai-studio', model: 'gemini-3.8-flash', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] }
  await Array.fromAsync(prepared.stream(request))
  await Array.fromAsync(adapter.stream(request))
  assert.equal(connected.length, 2)
  assert.deepEqual(dispatched, [{ endpoint: 'https://old.example/google', key: 'old-key' }, { endpoint: 'https://new.example/google', key: 'new-key' }])
})
