import test from 'node:test'
import assert from 'node:assert/strict'
import { projectFilesToText } from '@deepseek-ai/dsh-llm'
import { GoogleNativeAdapter } from '../lib/adapter.js'
import { defaultProfile } from '../lib/config.js'
import { withNativeFileContext } from '../lib/file-scope.js'
import { NativeFileStore } from '../lib/files.js'
import { realSettingsProfile } from './helpers/real-settings-profile.mjs'

const provider = 'google-ai-studio'
const file = { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'imported.pdf', bytes: 100 }
const missing = code => Object.assign(new Error('No stored attachment bytes'), { code })

for (const code of ['ATTACHMENT_NOT_FOUND', 'INVALID_ATTACHMENT_REF']) {
  test(`an imported ${code} PDF remains a text notice and the model request continues`, async t => {
    let request
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      request = JSON.parse(init.body)
      const response = { candidates: [{ content: { parts: [{ text: 'Please upload the PDF again.' }] }, finishReason: 'STOP' }] }
      return new Response(`data: ${JSON.stringify(response)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const profiles = { [provider]: defaultProfile(provider), 'google-vertex-native': defaultProfile('google-vertex-native') }
    profiles[provider].models[0].inputTypes = ['text', 'pdf']
    const adapter = new GoogleNativeAdapter({ attachments: { async *readFileStream() { throw missing(code) } } }, {
      profiles: () => profiles, resolveApiKey: async () => 'offline-test-key',
    })
    const options = { provider, model: 'gemini-2.5-flash', messages: [{ id: 'imported-user', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: 'Continue this imported conversation.' }, { type: 'file', attachment: file }] }] }
    const projected = { ...options, messages: projectFilesToText(options.messages, () => undefined) }
    for await (const _ of withNativeFileContext(options, () => adapter.stream(projected))) {}
    assert.match(JSON.stringify(request.contents), /original contents are not stored/)
    assert.doesNotMatch(JSON.stringify(request.contents), /inlineData|fileData/)
  })
}

test('missing attachments are not cached and real I/O failures still fail', async () => {
  let absent = true
  const pdf = Buffer.from('%PDF-1.7\noriginal')
  const ref = { ...file, bytes: pdf.length }
  const store = new NativeFileStore({}, 'ai-studio', { async *readFileStream() {
    if (absent) throw missing('ATTACHMENT_NOT_FOUND')
    yield pdf
  } })
  assert.match((await store.filePart(ref)).text, /unavailable/)
  absent = false
  assert.equal((await store.filePart(ref)).inlineData.mimeType, 'application/pdf')
  const failure = new Error('disk read failed')
  const broken = new NativeFileStore({}, 'ai-studio', { async *readFileStream() { throw failure } })
  await assert.rejects(broken.filePart(ref), error => error === failure)
})

test('cancellation wins over a missing-attachment fallback', async () => {
  const controller = new AbortController()
  const store = new NativeFileStore({}, 'ai-studio', { async *readFileStream() {
    controller.abort()
    throw missing('ATTACHMENT_NOT_FOUND')
  } })
  await assert.rejects(store.filePart(file, controller.signal), error => error.name === 'AbortError')
})

test('native routes publish their configured DSH retry policy', async t => {
  const { ctx } = await realSettingsProfile(t, { config: { aiStudio: { retryPolicy: {
    mode: 'normal', maxRetries: 2, retryableCodes: ['SERVER'], backoff: { initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 },
  } } } })
  assert.equal(ctx.llm.providerRetryPolicy(provider).maxRetries, 2)
  assert.deepEqual(ctx.llm.providerRetryPolicy(provider).retryableCodes, ['SERVER'])
  assert.equal(ctx.llm.providerRetryPolicy('google-vertex-native').maxRetries, 5)
})
