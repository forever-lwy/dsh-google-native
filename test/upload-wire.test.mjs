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

test('changing a file threshold uses inline audio instead of a cached upload while prepared calls keep their original settings', async t => {
  const audio = Buffer.from('0000ftypmp42original M4A bytes')
  const profiles = { [provider]: defaultProfile(provider), 'google-vertex-native': defaultProfile('google-vertex-native') }
  profiles[provider].baseURL = 'https://gateway.example'
  profiles[provider].files.inlineThresholdBytes = audio.length - 1
  let starts = 0
  let binaries = 0
  const media = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const headers = new Headers(init.headers)
    if (headers.get('x-goog-upload-command') === 'start') {
      starts++
      assert.equal(String(url), 'https://gateway.example/upload/v1beta/files')
      assert.equal(headers.get('x-goog-upload-header-content-type'), 'audio/mp4')
      assert.equal(headers.get('x-goog-upload-header-content-length'), String(audio.length))
      return new Response('{}', { headers: { 'x-goog-upload-url': 'https://gateway.example/upload-session/audio' } })
    }
    if (headers.get('x-goog-upload-command')?.includes('finalize')) {
      binaries++
      assert.deepEqual(Buffer.from(await init.body.arrayBuffer()), audio)
      return new Response(JSON.stringify({ file: {
        name: 'files/audio', state: 'ACTIVE', uri: 'https://gateway.example/v1beta/files/audio', mimeType: 'audio/mp4',
      } }), { headers: { 'x-goog-upload-status': 'final' } })
    }
    const body = JSON.parse(init.body)
    media.push(body.contents.flatMap(content => content.parts).find(part => part.inlineData || part.fileData))
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Audio understood' }] }, finishReason: 'STOP' }] })}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    })
  })
  const instance = new GoogleNativeAdapter({ attachments: { async *readFileStream() { yield audio } } }, {
    profiles: () => profiles, resolveApiKey: async () => 'offline-key',
  })
  const request = { provider, model: 'gemini-2.5-flash', messages: [{ role: 'user', content: [
    { type: 'file', attachment: { attachmentId: 'same-recording', name: 'meeting.m4a', bytes: audio.length } },
  ] }] }
  const prepared = await instance.prepareCall(provider, request.model)
  await collect(instance.stream(request))
  assert.deepEqual(media.at(-1), { fileData: { fileUri: 'https://gateway.example/v1beta/files/audio', mimeType: 'audio/mp4' } })
  assert.equal(starts, 1)
  assert.equal(binaries, 1)

  profiles[provider].files.inlineThresholdBytes = audio.length
  await collect(instance.stream(request))
  assert.deepEqual(media.at(-1), { inlineData: { mimeType: 'audio/mp4', data: audio.toString('base64') } })
  assert.equal(starts, 1, 'the newly configured connection must not upload or reuse the previous fileData handle')
  assert.equal(binaries, 1)

  await collect(prepared.stream(request))
  assert.deepEqual(media.at(-1), { fileData: { fileUri: 'https://gateway.example/v1beta/files/audio', mimeType: 'audio/mp4' } })
  assert.equal(starts, 1, 'already prepared calls retain their original connection and its valid upload handle')
  assert.equal(binaries, 1)
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
