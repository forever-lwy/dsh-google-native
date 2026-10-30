import test from 'node:test'
import assert from 'node:assert/strict'
import { GoogleNativeAdapter } from '../lib/adapter.js'
import { defaultProfile } from '../lib/config.js'

const data = Buffer.from('%PDF-1.7\nNative binary PDF contents')
const provider = 'google-ai-studio'
function adapter() {
  const profiles = { [provider]: defaultProfile(provider), 'google-vertex-native': defaultProfile('google-vertex-native') }
  profiles[provider].files.inlineThresholdBytes = 1
  return new GoogleNativeAdapter({ attachments: { async *readFileStream() { yield data } } }, { profiles: () => profiles, resolveApiKey: async () => 'offline-key' })
}
function options(signal) {
  return { provider, model: 'gemini-2.5-flash', signal, messages: [{ role: 'user', content: [
    { type: 'file', attachment: { attachmentId: 'pdf-attachment', name: 'native.pdf', bytes: data.length } },
  ] }] }
}
async function collect(stream) { return Array.fromAsync(stream) }

test('actual SDK resumable upload sends correct start URL, protocol headers, bytes and fileData', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const headers = new Headers(init.headers)
    requests.push({ url: String(url), headers })
    assert.match(headers.get('user-agent'), /deepseek-harness/)
    if (headers.get('x-goog-upload-command') === 'start') {
      assert.equal(String(url), 'https://generativelanguage.googleapis.com/upload/v1beta/files')
      assert.equal(headers.get('x-goog-upload-protocol'), 'resumable')
      assert.equal(headers.get('x-goog-upload-header-content-length'), String(data.length))
      assert.equal(headers.get('x-goog-upload-header-content-type'), 'application/pdf')
      return new Response('{}', { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload-session/offline' } })
    }
    if (headers.get('x-goog-upload-command')?.includes('finalize')) {
      assert.deepEqual(Buffer.from(await init.body.arrayBuffer()), data)
      return new Response(JSON.stringify({ file: { name: 'files/offline', state: 'ACTIVE', uri: 'https://generativelanguage.googleapis.com/v1beta/files/offline', mimeType: 'application/pdf' } }), { headers: { 'x-goog-upload-status': 'final' } })
    }
    const body = JSON.parse(init.body)
    assert.equal(body.contents[0].parts[0].fileData.fileUri, 'https://generativelanguage.googleapis.com/v1beta/files/offline')
    assert.equal(body.contents[0].parts[0].fileData.mimeType, 'application/pdf')
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'PDF understood' }] }, finishReason: 'STOP' }] })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  })
  const instance = adapter()
  const chunks = await collect(instance.stream(options()))
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(requests.length, 3)
  await collect(instance.stream(options()))
  assert.equal(requests.length, 4, 'second request reuses valid uploaded file handle')
})

for (const stage of ['start', 'upload']) {
  test(`actual SDK ${stage} request aborts during upload rather than continuing after cancellation`, async t => {
    const controller = new AbortController()
    let reached = false
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      const headers = new Headers(init.headers)
      if (stage === 'upload' && headers.get('x-goog-upload-command') === 'start') {
        return new Response('{}', { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload-session/offline' } })
      }
      reached = true
      assert.ok(init.signal, 'SDK upload must receive scoped cancellation signal')
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        controller.abort()
      })
    })
    await assert.rejects(collect(adapter().stream(options(controller.signal))), error => error.code === 'ABORTED')
    assert.equal(reached, true)
  })
}
