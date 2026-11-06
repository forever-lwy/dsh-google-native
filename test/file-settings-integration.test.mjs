import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { realSettingsProfile } from './helpers/real-settings-profile.mjs'

test('saving the inline threshold through real rc.5 settings lets the same recording bypass an unavailable Files API', async t => {
  const audio = Buffer.from('0000ftypM4A unchanged original recording bytes')
  const provider = 'google-ai-studio'
  const model = 'gemini-2.5-flash'
  const { ctx, dir, values } = await realSettingsProfile(t, { config: {
    aiStudio: { baseURL: 'https://recording-gateway.test', models: [{ id: model }],
      files: { inlineThresholdBytes: 1, pollIntervalMs: 7, processingTimeoutMs: 9000 },
      generationConfig: { temperature: 0.2 } },
  } })
  values.set('GOOGLE_API_KEY', 'offline-fixture-key')
  ctx.attachments.readFileStream = async function* () { yield audio }
  const entry = ctx.configEditor.entries().find(item => item.options.id === 'dsh-google-native')
  const fiber = entry.fiber
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname
    requests.push(path)
    if (path === '/upload/v1beta/files') {
      // Reproduce the gateway's missing upload protocol without contacting it.
      return new Response('<html>Gateway frontend</html>', { headers: { 'content-type': 'text/html' } })
    }
    assert.match(path, /:streamGenerateContent$/)
    const body = JSON.parse(init.body)
    const parts = body.contents.flatMap(content => content.parts)
    assert.deepEqual(parts.filter(part => part.inlineData).map(part => part.inlineData), [
      { mimeType: 'audio/mp4', data: audio.toString('base64') },
    ])
    assert.equal(parts.some(part => part.fileData), false)
    assert.equal(body.generationConfig.temperature, 0.2)
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Recording received' }] }, finishReason: 'STOP' }] })}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } })
  })
  const request = () => ({ provider, model, messages: [{ id: 'same-recording-message', role: 'user', content: [
    { type: 'file', attachment: { attachmentId: 'recording-fixture', name: 'recording.m4a', bytes: audio.length } },
  ] }] })
  const first = await Array.fromAsync(ctx.llm.stream(request()))
  assert.equal(first.at(-1).reason.kind, 'error')
  assert.deepEqual(requests, ['/upload/v1beta/files'])

  const before = await ctx.nativeGoogleSettings.get({}, AbortSignal.timeout(5000))
  const profile = before.profiles.find(item => item.provider === provider)
  const saved = await ctx.nativeGoogleSettings.save({ provider, models: profile.models,
    connection: { ...profile.connection, files: { inlineThresholdBytes: 64 * 1024 * 1024 } },
    expectedRevision: before.revision,
  }, AbortSignal.timeout(5000))
  assert.equal(entry.fiber, fiber, 'saving applies to the existing running test profile')
  assert.equal(saved.profiles.find(item => item.provider === provider).connection.files.inlineThresholdBytes, 67108864)
  assert.match(await readFile(join(dir, 'cordis.patch.yml'), 'utf8'), /inlineThresholdBytes: 67108864/)
  // cordis 4.1 keeps the raw input on fiber.config; resolve it like the plugin receives it.
  const effective = fiber.resolveConfig(fiber.config)
  assert.equal(effective.aiStudio.get().files.pollIntervalMs, 7)
  assert.equal(effective.aiStudio.get().files.processingTimeoutMs, 9000)
  assert.equal(effective.aiStudio.get().files.inlineThresholdBytes, 67108864)

  const second = await Array.fromAsync(ctx.llm.stream(request()))
  assert.equal(second.at(-1).reason.kind, 'stop')
  assert.equal(requests.length, 2)
  assert.match(requests[1], /:streamGenerateContent$/)

  const after = saved.profiles.find(item => item.provider === provider)
  await ctx.nativeGoogleSettings.save({ provider, models: after.models,
    connection: { ...after.connection, files: { maxFileBytes: audio.length - 1 } },
    expectedRevision: saved.revision,
  }, AbortSignal.timeout(5000))
  const blocked = await Array.fromAsync(ctx.llm.stream(request()))
  assert.equal(blocked.at(-1).reason.kind, 'error')
  assert.equal(blocked.at(-1).reason.failure.code, 'FILE_TOO_LARGE')
  assert.equal(requests.length, 2, 'the saved single-file limit refuses the attachment before any request')
})
