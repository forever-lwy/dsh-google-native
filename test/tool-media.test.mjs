import test from 'node:test'
import assert from 'node:assert/strict'
import { GoogleNativeAdapter } from '../lib/adapter.js'
import { defaultProfile } from '../lib/config.js'
import { translateMessages } from '../lib/messages.js'

const provider = 'google-ai-studio'
const model = 'gemini-test'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
const image = { attachmentId: 'sha256:screen', name: 'screen.png', mediaType: 'image/png', width: 1, height: 1, bytes: png.length }
const file = { attachmentId: 'sha256:pdf', name: 'result.pdf', bytes: 13 }
const call = (id, name = 'instabox_desktop') => ({ type: 'tool-call', id, name, arguments: '{}' })
const assistant = (...content) => ({ role: 'assistant', source: { kind: 'model', provider, model }, content })
const result = (id, content, isError = false) => ({ role: 'tool', toolCallId: id, source: { kind: 'tool', callId: id }, isError, content })
const options = messages => ({ provider, model, messages })
const imageBlock = (attachment = image) => ({ type: 'image', attachment })
const fileBlock = (attachment = file) => ({ type: 'file', attachment })
const files = {
  async imagePart() { return { inlineData: { mimeType: 'image/png', data: png.toString('base64') } } },
  async filePart() { return { fileData: { mimeType: 'application/pdf', fileUri: 'https://files.example/result' } } },
}

test('parallel responses stay together before ordinary screenshot and uploaded-file media', async () => {
  const first = call('synthetic-first')
  const second = call('native-second', 'read_document')
  const nativeParts = [
    { functionCall: { name: first.name, args: {} }, thoughtSignature: 'FIRST_SIGNATURE' },
    { functionCall: { name: second.name, id: second.id, args: {} }, thoughtSignature: 'SECOND_SIGNATURE' },
  ]
  const message = assistant(first, second)
  message.source.replayState = { response: { format: 'google-native-v1' }, blocks: nativeParts.map(part => ({ parts: [part] })) }
  const messages = [message,
    result(first.id, [{ type: 'text', text: 'Screenshot 818x564' }, imageBlock()]),
    result(second.id, [{ type: 'text', text: 'Read document' }, fileBlock()]),
  ]
  const original = structuredClone(messages)
  const translated = await translateMessages(options(messages), files)
  assert.deepEqual(translated.contents[0].parts, nativeParts, 'signed model parts are replayed exactly')
  const parts = translated.contents[1].parts
  assert.equal(parts.length, 2)
  assert.deepEqual(parts.slice(0, 2).map(part => [part.functionResponse.name, part.functionResponse.id]), [
    ['instabox_desktop', undefined], ['read_document', 'native-second'],
  ])
  assert.ok(parts.slice(0, 2).every(part => part.functionResponse.parts === undefined))
  assert.match(parts[0].functionResponse.response.output, /^Screenshot 818x564\nMedia returned/)
  const media = translated.contents[2]
  assert.equal(media.role, 'user')
  assert.ok(media.parts.every(part => part.functionResponse === undefined))
  assert.match(media.parts[0].text, /instabox_desktop.*synthetic-first.*screen.png/)
  assert.deepEqual(media.parts[1], await files.imagePart(image))
  assert.match(media.parts[2].text, /read_document.*native-second.*result.pdf/)
  assert.deepEqual(media.parts[3], await files.filePart(file))
  assert.deepEqual(messages, original)
})

test('the same screenshot is sent once per response batch and remains available in a later batch', async () => {
  let reads = 0
  const store = { async imagePart(ref) { reads++; return files.imagePart(ref) } }
  const translated = await translateMessages(options([
    assistant(call('first'), call('second')),
    result('first', [imageBlock(), imageBlock()]),
    result('second', [imageBlock()]),
    assistant(call('later')),
    result('later', [imageBlock()]),
  ]), store)
  assert.equal(reads, 2, 'deduplication does not re-read repeated references in a parallel batch')
  assert.equal(translated.contents.flatMap(content => content.parts).filter(part => part.inlineData).length, 2)
  assert.ok(translated.contents.flatMap(content => content.parts).every(part => !part.functionResponse?.parts))
  assert.equal(translated.contents[1].parts[0].functionResponse.name, 'instabox_desktop')
  assert.equal(translated.contents[1].parts[1].functionResponse.name, 'instabox_desktop')
})

test('offloaded screenshots keep their omission notice without reading or attaching bytes', async () => {
  const translated = await translateMessages(options([
    assistant(call('offloaded')), result('offloaded', [{ ...imageBlock(), offloaded: true }]),
  ]), { imagePart() { throw new Error('must not read offloaded image') } }, ['text'])
  const response = translated.contents[1].parts[0].functionResponse
  assert.match(response.response.output, /was offloaded/)
  assert.equal(translated.contents[1].parts.length, 1)
  assert.equal(response.parts, undefined)
})

test('diagnostic images from failed ordinary tools remain explicitly paired with an error', async () => {
  const translated = await translateMessages(options([
    assistant(call('failed')), result('failed', [{ type: 'text', text: 'Click failed' }, imageBlock()], true),
  ]), files)
  const parts = translated.contents[1].parts
  assert.equal(parts[0].functionResponse.response.output, undefined)
  assert.match(parts[0].functionResponse.response.error, /^Click failed\nMedia returned by this failed tool call/)
  assert.equal(parts[0].functionResponse.parts, undefined)
  assert.equal(parts.length, 1)
  assert.deepEqual(translated.contents[2].parts[1], await files.imagePart(image))
})

test('unverified native attachment tool results cannot use the ordinary-media path', async () => {
  for (const isError of [false, true]) {
    const translated = await translateMessages(options([
      assistant(call('unverified', 'google_native_attach_file')),
      result('unverified', [imageBlock(), fileBlock()], isError),
    ]), {
      imagePart() { throw new Error('must not read unverified image') },
      filePart() { throw new Error('must not read unverified file') },
      validateInputType() { throw new Error('must not inspect unverified file') },
    }, ['text'])
    const parts = translated.contents[1].parts
    assert.equal(parts.length, 1)
    assert.match(parts[0].functionResponse.response[isError ? 'error' : 'output'], /could not be verified/)
  }
})

test('tool media obeys declared input types and propagates attachment failures before dispatch', async () => {
  const messages = [assistant(call('screen')), result('screen', [imageBlock()])]
  await assert.rejects(translateMessages(options(messages), files, ['text']), error => error.code === 'UNSUPPORTED_INPUT_TYPE')
  await assert.rejects(translateMessages(options(messages), { async imagePart() { throw new Error('attachment unavailable') } }), /attachment unavailable/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(translateMessages({ ...options(messages), signal: controller.signal }, files), error => error.name === 'AbortError')
})

for (const route of ['google-ai-studio', 'google-vertex-native', 'custom-ai-studio']) {
  test(`${route}: actual SDK wire carries an exact screenshot as top-level user media after all function responses`, async t => {
    const selected = route === 'google-vertex-native' ? route : provider
    const profiles = { [provider]: defaultProfile(provider), 'google-vertex-native': defaultProfile('google-vertex-native') }
    const profile = profiles[selected]
    profile.vertexAuth = 'api-key'
    if (route === 'custom-ai-studio') profile.baseURL = 'https://relay.example/native'
    let request
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      request = { url: String(url), body: JSON.parse(init.body) }
      return new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Received image' }] }, finishReason: 'STOP' }] })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    })
    let reads = 0
    const adapter = new GoogleNativeAdapter({ attachments: { async readImage(ref) { reads++; return { ref, data: png } } } }, {
      profiles: () => profiles, resolveApiKey: async () => 'offline-test-key',
    })
    const messages = [
      { ...assistant(call('screen'), call('status')), source: { kind: 'model', provider: selected, model: 'gemini-2.5-flash' } },
      result('screen', [{ type: 'text', text: 'Screenshot' }, imageBlock()]),
      result('status', [{ type: 'text', text: 'Machine running' }]),
    ]
    const chunks = await Array.fromAsync(adapter.stream({ provider: selected, model: 'gemini-2.5-flash', messages }))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.equal(reads, 1)
    assert.equal(request.body.contents.length, 3)
    assert.deepEqual(request.body.contents.map(content => content.role), ['model', 'user', 'user'])
    const parts = request.body.contents[1].parts
    assert.deepEqual(parts.slice(0, 2).map(part => part.functionResponse.id), ['screen', 'status'])
    assert.equal(parts.length, 2)
    assert.ok(parts.slice(0, 2).every(part => part.functionResponse.parts === undefined))
    const media = request.body.contents[2].parts
    assert.ok(media.every(part => part.functionResponse === undefined), 'a proxy classifying function responses as tool messages sees a separate ordinary user image')
    assert.match(media[0].text, /instabox_desktop.*screen/)
    assert.equal(media[1].inlineData.mimeType, 'image/png')
    assert.deepEqual(Buffer.from(media[1].inlineData.data, 'base64'), png)
    assert.equal(media.filter(part => part.inlineData).length, 1)
    if (route === 'custom-ai-studio') assert.match(request.url, /^https:\/\/relay\.example\/native\//)
    else assert.match(request.url, selected === provider ? /generativelanguage.googleapis.com/ : /aiplatform.googleapis.com/)
  })
}

test('actual SDK tool-file upload produces a top-level fileData after the complete parallel response group', async t => {
  const pdf = Buffer.from('%PDF-1.7\nTool-produced binary document')
  const ref = { attachmentId: 'sha256:uploaded-pdf', name: 'tool-result.pdf', bytes: pdf.length }
  const profiles = { [provider]: defaultProfile(provider), 'google-vertex-native': defaultProfile('google-vertex-native') }
  profiles[provider].files.inlineThresholdBytes = 1
  let wire
  let uploads = 0
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const headers = new Headers(init.headers)
    if (headers.get('x-goog-upload-command') === 'start') return new Response('{}', {
      headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload-session/tool-media' },
    })
    if (headers.get('x-goog-upload-command')?.includes('finalize')) {
      uploads++
      assert.deepEqual(Buffer.from(await init.body.arrayBuffer()), pdf)
      return new Response(JSON.stringify({ file: {
        name: 'files/tool-media', state: 'ACTIVE', uri: 'https://generativelanguage.googleapis.com/v1beta/files/tool-media', mimeType: 'application/pdf',
      } }), { headers: { 'x-goog-upload-status': 'final' } })
    }
    wire = JSON.parse(init.body)
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Received file' }] }, finishReason: 'STOP' }] })}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    })
  })
  const adapter = new GoogleNativeAdapter({ attachments: { async *readFileStream() { yield pdf } } }, {
    profiles: () => profiles, resolveApiKey: async () => 'offline-test-key',
  })
  const chunks = await Array.fromAsync(adapter.stream({ provider, model: 'gemini-2.5-flash', messages: [
    { ...assistant(call('file', 'read_document'), call('other')), source: { kind: 'model', provider, model: 'gemini-2.5-flash' } },
    result('file', [fileBlock(ref)]), result('other', [{ type: 'text', text: 'Done' }]),
  ] }))
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(uploads, 1)
  const parts = wire.contents[1].parts
  assert.deepEqual(parts.slice(0, 2).map(part => part.functionResponse.id), ['file', 'other'])
  assert.equal(parts.length, 2)
  assert.ok(parts.slice(0, 2).every(part => part.functionResponse.parts === undefined))
  const media = wire.contents[2].parts
  assert.ok(media.every(part => part.functionResponse === undefined))
  assert.deepEqual(media[1], { fileData: { mimeType: 'application/pdf', fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/tool-media' } })
})

test('PTC-injected user media never merges into the preceding function-response Content', async () => {
  const translated = await translateMessages(options([
    assistant(call('run', 'run_code')),
    result('run', [{ type: 'text', text: 'Program completed' }]),
    { role: 'user', source: { kind: 'instabox-screen' }, content: [imageBlock()] },
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue using this screenshot' }] },
  ]), files)
  assert.deepEqual(translated.contents.map(content => content.role), ['model', 'user', 'user'])
  assert.equal(translated.contents[1].parts.length, 1)
  assert.equal(translated.contents[1].parts[0].functionResponse.name, 'run_code')
  assert.deepEqual(translated.contents[2].parts, [await files.imagePart(image), { text: 'Continue using this screenshot' }])
  assert.ok(translated.contents[2].parts.every(part => part.functionResponse === undefined))
})
