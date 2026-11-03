import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { detectMimeType, NativeFileStore } from '../lib/files.js'

const ref = (data, name = 'document.pdf') => ({ attachmentId: 'sha256-test', name, bytes: data.length })
const bytes = Buffer.from('%PDF-1.7\nexample')
function attachmentStore(data) {
  return { async *readFileStream() { yield data.subarray(0, 5); yield data.subarray(5) } }
}

test('recognizes native PDF/audio/video bytes and never treats a name as a filesystem path', () => {
  assert.equal(detectMimeType('../../no-extension', bytes), 'application/pdf')
  assert.equal(detectMimeType('sound.wav', Buffer.from('RIFF0000WAVE')), 'audio/wav')
  assert.equal(detectMimeType('clip.mp4', Buffer.from('0000ftypisom')), 'video/mp4')
  assert.equal(detectMimeType('sound.m4a', Buffer.from('0000ftypM4A ')), 'audio/mp4')
  assert.throws(() => detectMimeType('/etc/shadow', Buffer.from('binary')), error => error.code === 'UNSUPPORTED_FILE_TYPE')
})

test('small PDF uses unchanged native inlineData bytes', async () => {
  const store = new NativeFileStore({}, 'ai-studio', attachmentStore(bytes))
  const part = await store.filePart(ref(bytes))
  assert.deepEqual(part, { inlineData: { mimeType: 'application/pdf', data: bytes.toString('base64') } })
})

test('AI Studio sends an audio file at the configured threshold inline and uploads it above that threshold', async () => {
  const audio = Buffer.from('0000ftypmp42original M4A bytes')
  const audioRef = ref(audio, 'meeting.m4a')
  let uploads = 0
  const client = { files: { async upload(input) {
    uploads++
    assert.deepEqual(await readFile(input.file), audio)
    assert.equal(input.config.mimeType, 'audio/mp4')
    return { name: 'files/meeting', state: 'ACTIVE', uri: 'https://files.example/meeting', mimeType: 'audio/mp4' }
  } } }
  const atThreshold = new NativeFileStore(client, 'ai-studio', attachmentStore(audio), {
    inlineThresholdBytes: audio.length,
    inlineMaxBytes: 1, // Vertex's limit must not override AI Studio's chosen threshold.
    maxFileBytes: audio.length,
  })
  assert.deepEqual(await atThreshold.filePart(audioRef), {
    inlineData: { mimeType: 'audio/mp4', data: audio.toString('base64') },
  })
  assert.equal(uploads, 0)
  const aboveThreshold = new NativeFileStore(client, 'ai-studio', attachmentStore(audio), {
    inlineThresholdBytes: audio.length - 1,
    maxFileBytes: audio.length,
  })
  assert.deepEqual(await aboveThreshold.filePart(audioRef), {
    fileData: { fileUri: 'https://files.example/meeting', mimeType: 'audio/mp4' },
  })
  assert.equal(uploads, 1)
})

test('Vertex accepts the configured inline boundary without using AI Studio upload settings', async () => {
  const store = new NativeFileStore({}, 'vertex', attachmentStore(bytes), {
    inlineThresholdBytes: 1,
    inlineMaxBytes: bytes.length,
    maxFileBytes: bytes.length,
  })
  assert.deepEqual(await store.filePart(ref(bytes)), {
    inlineData: { mimeType: 'application/pdf', data: bytes.toString('base64') },
  })
})

for (const backend of ['ai-studio', 'vertex']) {
  test(`${backend} rejects files above the configured single-file limit before reading or uploading`, async () => {
    let reads = 0
    let uploads = 0
    const store = new NativeFileStore({ files: { async upload() { uploads++ } } }, backend, {
      async *readFileStream() { reads++; yield bytes },
    }, { maxFileBytes: bytes.length - 1, inlineThresholdBytes: 1 })
    await assert.rejects(store.filePart(ref(bytes)), error => error.code === 'FILE_TOO_LARGE')
    assert.equal(reads, 0)
    assert.equal(uploads, 0)
  })
}

test('large AI Studio files are verified, uploaded, polled, cached and temporary files removed', async () => {
  let uploadedPath
  let uploads = 0
  let polls = 0
  const client = { files: {
    async upload(input) {
      uploads++
      uploadedPath = input.file
      assert.deepEqual(await readFile(uploadedPath), bytes)
      assert.equal(input.config.mimeType, 'application/pdf')
      assert.equal(input.config.httpOptions, undefined, 'preserve SDK resumable upload headers')
      return { name: 'files/example', state: 'PROCESSING' }
    },
    async get() { polls++; return { name: 'files/example', state: 'ACTIVE', uri: 'https://generativelanguage.googleapis.com/v1beta/files/example', expirationTime: new Date(Date.now() + 3_600_000).toISOString() } },
  } }
  const store = new NativeFileStore(client, 'ai-studio', attachmentStore(bytes), { inlineThresholdBytes: 1, pollIntervalMs: 1 })
  const result = await store.filePart(ref(bytes))
  assert.equal(result.fileData.mimeType, 'application/pdf')
  assert.equal(uploads, 1)
  assert.equal(polls, 1)
  await assert.rejects(access(uploadedPath), { code: 'ENOENT' })
  assert.deepEqual(await store.filePart(ref(bytes)), result)
  assert.equal(uploads, 1)
})

test('Vertex large local media fails before reading or calling unsupported Files API', async () => {
  let read = false
  const store = new NativeFileStore({}, 'vertex', { async *readFileStream() { read = true; yield bytes } }, { inlineMaxBytes: 2 })
  await assert.rejects(store.filePart(ref(bytes)), error => error.code === 'FILE_TOO_LARGE' && /gs:\/\//.test(error.message))
  assert.equal(read, false)
})

test('cancelled uploads stop file processing polls and clear the temporary file', async () => {
  const controller = new AbortController()
  let uploadedPath
  let gets = 0
  const store = new NativeFileStore({ files: {
    async upload(input) { uploadedPath = input.file; controller.abort(); return { name: 'files/example', state: 'PROCESSING' } },
    async get() { gets++; throw new Error('must not be called') },
  } }, 'ai-studio', attachmentStore(bytes), { inlineThresholdBytes: 1 })
  await assert.rejects(store.filePart(ref(bytes), controller.signal), error => error.name === 'AbortError')
  assert.equal(gets, 0)
  await assert.rejects(access(uploadedPath), { code: 'ENOENT' })
})

test('rejects attachment streams that disagree with their durable byte count', async () => {
  const store = new NativeFileStore({}, 'ai-studio', attachmentStore(bytes))
  await assert.rejects(store.filePart({ ...ref(bytes), bytes: bytes.length + 1 }), error => error.code === 'INVALID_ATTACHMENT')
})

test('file processing deadline cancels polling and cleans the temporary file', async () => {
  let uploadedPath
  const store = new NativeFileStore({ files: {
    async upload(input) { uploadedPath = input.file; return { name: 'files/example', state: 'PROCESSING' } },
    async get() { throw new Error('poll delay exceeds deadline, so get must not start') },
  } }, 'ai-studio', attachmentStore(bytes), { inlineThresholdBytes: 1, pollIntervalMs: 100, processingTimeoutMs: 5 })
  await assert.rejects(store.filePart(ref(bytes)), error => error.code === 'FILE_PROCESSING_TIMEOUT')
  await assert.rejects(access(uploadedPath), { code: 'ENOENT' })
})
