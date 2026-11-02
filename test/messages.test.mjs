import test from 'node:test'
import assert from 'node:assert/strict'
import { translateMessages } from '../lib/messages.js'

const provider = 'google-ai-studio'
const model = 'gemini-test'
const base = { provider, model }
const files = {
  async filePart(ref) { return { inlineData: { mimeType: 'application/pdf', data: ref.attachmentId } } },
  async imagePart(ref) { return { inlineData: { mimeType: 'image/png', data: ref.attachmentId } } },
}

test('native attachment blocks retain bytes and ordering with leading system instruction', async () => {
  const result = await translateMessages({ ...base, system: 'System', messages: [{ role: 'user', content: [
    { type: 'text', text: 'Read this' }, { type: 'file', attachment: { attachmentId: 'pdf-bytes' } },
    { type: 'image', attachment: { attachmentId: 'image-bytes' } },
  ] }] }, files)
  assert.deepEqual(result, { systemInstruction: { parts: [{ text: 'System' }] }, contents: [{ role: 'user', parts: [
    { text: 'Read this' }, { inlineData: { mimeType: 'application/pdf', data: 'pdf-bytes' } },
    { inlineData: { mimeType: 'image/png', data: 'image-bytes' } },
  ] }] })
})

test('replays exact native thought signatures including trailing signature-only Part', async () => {
  const block = { type: 'reasoning', text: 'A thought' }
  const parts = [{ text: 'A thought', thought: true }, { thoughtSignature: 'opaque-base64' }]
  const result = await translateMessages({ ...base, messages: [{ role: 'assistant', content: [block], source: { kind: 'model', provider, model,
    replayState: { response: { format: 'google-native-v1' }, blocks: [{ parts }] },
  } }] }, files)
  assert.deepEqual(result.contents[0].parts, parts)
})

test('stale or foreign replay cannot replace edited visible message content', async () => {
  for (const historicalProvider of [provider, 'other-provider']) {
    const result = await translateMessages({ ...base, messages: [{ role: 'assistant', content: [{ type: 'text', text: 'edited' }], source: {
      kind: 'model', provider: historicalProvider, model,
      replayState: { response: { format: 'google-native-v1' }, blocks: [{ parts: [{ text: 'old', thoughtSignature: 'old-signature' }] }] },
    } }] }, files)
    assert.deepEqual(result.contents[0].parts, [{ text: 'edited' }])
  }
})

test('parallel function calls preserve native names/ids/signatures and match tool results', async () => {
  const block = { type: 'tool-call', id: 'synthetic-call', name: 'lookup', arguments: '{"q":"test"}' }
  const nativePart = { functionCall: { name: 'lookup', args: { q: 'test' } }, thoughtSignature: 'signature' }
  const result = await translateMessages({ ...base, messages: [
    { role: 'assistant', content: [block], source: { kind: 'model', provider, model,
      replayState: { response: { format: 'google-native-v1' }, blocks: [{ parts: [nativePart] }] },
    } },
    { role: 'tool', toolCallId: 'synthetic-call', content: [{ type: 'text', text: 'found' }, { type: 'file', attachment: { attachmentId: 'native-file' } }] },
  ] }, files)
  assert.deepEqual(result.contents[0].parts, [nativePart])
  assert.equal(result.contents[1].parts[0].functionResponse.name, 'lookup')
  assert.match(result.contents[1].parts[0].functionResponse.response.output, /^found\nMedia returned/)
  assert.equal(result.contents[1].parts[0].functionResponse.parts, undefined)
  assert.equal(result.contents[1].parts.length, 1)
  assert.match(result.contents[2].parts[0].text, /Media returned by lookup/)
  assert.deepEqual(result.contents[2].parts[1], { inlineData: { mimeType: 'application/pdf', data: 'native-file' } })
})

test('native opaque output replays only with an identical recorded placeholder block', async () => {
  const block = { type: 'text', text: '[native audio output]' }
  const parts = [{ inlineData: { mimeType: 'audio/pcm', data: 'YQ==' }, thoughtSignature: 'sig' }]
  const result = await translateMessages({ ...base, messages: [{ role: 'assistant', content: [block], source: { kind: 'model', provider, model,
    replayState: { response: { format: 'google-native-v1' }, blocks: [{ block: structuredClone(block), parts }] },
  } }] }, files)
  assert.deepEqual(result.contents[0].parts, parts)
})

test('unknown content and unpaired tool results fail explicitly', async () => {
  await assert.rejects(translateMessages({ ...base, messages: [{ role: 'user', content: [{ type: 'unknown' }] }] }, files), error => error.code === 'UNSUPPORTED_CONTENT')
  await assert.rejects(translateMessages({ ...base, messages: [{ role: 'tool', toolCallId: 'absent', content: [{ type: 'text', text: 'value' }] }] }, files), error => error.code === 'INVALID_TOOL_RESULT')
})
