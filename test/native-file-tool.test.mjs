import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { defaultProfile } from '../lib/config.js'
import { GOOGLE_NATIVE_FILE_TOOL, registerNativeFileTool } from '../lib/native-file-tool.js'

async function fixture(t, { provider = 'google-ai-studio', model = 'gemini-2.5-flash', cwd = '/workspace', data = Buffer.from('%PDF-1.7\noriginal\u0000bytes'), path = '/workspace/example.pdf', headerRoot = '/workspace' } = {}) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx)
  await ctx.plugin(NativeToolExecutor)
  const profiles = { 'google-ai-studio': defaultProfile('google-ai-studio'), 'google-vertex-native': defaultProfile('google-vertex-native') }
  const entries = new Map([[path, { bytes: data, version: 'v1', type: 'file' }]])
  const reads = [], saved = [], injected = []
  let readHook = () => {}
  const fs = {
    async resolve(path, options = {}) { options.signal?.throwIfAborted(); const key = posix.resolve(options.cwd ?? '/workspace', path); return { targetKey: entries.get(key)?.alias ?? key, displayPath: key } },
    contains(parent, child) { return child.targetKey === parent.targetKey || child.targetKey.startsWith(parent.targetKey + '/') },
    async stat(target, signal) { signal?.throwIfAborted(); const value = entries.get(target.targetKey); return value && { type: value.type, size: value.size ?? value.bytes.length, version: value.version } },
    async readByteRange(target, range, signal) { signal?.throwIfAborted(); reads.push({ target, ...range }); readHook(target, range); signal?.throwIfAborted(); return entries.get(target.targetKey).bytes.subarray(range.offset, range.offset + range.length) },
  }
  ctx.provide('fs', fs)
  ctx.provide('workingDirectory', { get: () => cwd })
  ctx.provide('attachments', {
    async saveFileStream({ data, name, signal }) {
      const chunks = []
      for await (const chunk of data) { signal.throwIfAborted(); chunks.push(Buffer.from(chunk)) }
      signal.throwIfAborted()
      const bytes = Buffer.concat(chunks)
      const ref = { attachmentId: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, name }
      saved.push({ bytes, ref })
      return ref
    },
  })
  const agent = { options: { provider, model }, session: { id: 'session-under-test', header: { cwd: headerRoot }, requestHeader: () => ({ config: agent.options }) }, inject: message => injected.push(message) }
  registerNativeFileTool(ctx, () => profiles)
  // 0.2.2: a model step resolves its admitted tool set from the selected route,
  // then the deployment executor runs the call batch against that set.
  const resolveTools = (signal = new AbortController().signal) => ctx.tools.resolve({ agent, modelSelection: { ...agent.options }, signal })
  const call = async (args = { path }, { signal = new AbortController().signal } = {}) => {
    const toolSet = await resolveTools()
    try {
      const batch = await ctx.tools.execute({ calls: [{ type: 'tool-call', id: 'native-call', name: GOOGLE_NATIVE_FILE_TOOL, arguments: JSON.stringify(args) }], agent, signal, toolSet })
      return batch.results[0].result
    } finally { toolSet.dispose() }
  }
  return { ctx, profiles, entries, reads, saved, injected, agent, call, resolveTools, data, setReadHook: value => { readHook = value } }
}

test('native attachment tool stores exact original bytes and renders only a durable FileBlock for both providers, including images', async t => {
  for (const provider of ['google-ai-studio', 'google-vertex-native']) for (const [path, bytes] of [
    ['/workspace/example.pdf', Buffer.from('%PDF-1.7\nraw\u0000payload')],
    ['/workspace/screenshot.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 20])],
  ]) {
    const f = await fixture(t, { provider, path, data: bytes })
    const result = await f.call()
    assert.equal(result.isError, false)
    assert.deepEqual(f.saved[0].bytes, bytes)
    assert.deepEqual(result.content, [{ type: 'file', attachment: f.saved[0].ref }])
    assert.equal(result.meta.googleNativeFile.provider, provider)
    assert.equal(result.meta.googleNativeFile.sessionId, f.agent.session.id)
    assert.equal(result.meta.googleNativeFile.callId, 'native-call')
    assert.equal(result.meta.googleNativeFile.rootCallId, 'native-call')
    assert.equal(f.injected.length, 0, 'native tool calls carry their file directly, without duplicate context')
  }
})

test('workspace containment follows canonical targets, original workspace roots and current relative paths', async t => {
  const f = await fixture(t, { cwd: '/workspace/subdir', path: '/workspace/report.pdf' })
  assert.equal((await f.call({ path: '../report.pdf' })).isError, false)
  f.entries.set('/outside/private.pdf', { bytes: Buffer.from('%PDF-private'), version: 'v1', type: 'file' })
  f.entries.set('/workspace/link.pdf', { alias: '/outside/private.pdf', bytes: Buffer.alloc(0), version: 'v1', type: 'file' })
  const before = f.reads.length
  for (const path of ['/outside/private.pdf', '../../outside/private.pdf', '/workspace/link.pdf', 'https://example.test/file.pdf']) {
    assert.equal((await f.call({ path })).isError, true)
  }
  assert.equal(f.reads.length, before, 'outside targets are refused before any raw byte read')
})

test('unsupported models, unsupported declared media and nonregular or oversized files fail before attachment storage', async t => {
  const f = await fixture(t)
  f.agent.options = { provider: 'other-provider', model: 'other' }
  assert.equal((await f.call()).isError, true)
  assert.equal(f.reads.length, 0)
  f.agent.options = { provider: 'google-ai-studio', model: 'custom-image-only' }
  f.profiles['google-ai-studio'].models = [{ id: 'custom-image-only', inputTypes: ['text', 'image'], capabilities: { nativeFiles: false } }]
  assert.equal((await f.call()).isError, true, 'an image-only model refuses PDF without committing its bytes')
  assert.equal(f.saved.length, 0)
  f.profiles['google-ai-studio'].models[0].capabilities.nativeFiles = true
  f.profiles['google-ai-studio'].models[0].inputTypes.push('pdf')
  f.entries.get('/workspace/example.pdf').type = 'directory'
  assert.equal((await f.call()).isError, true)
  f.entries.get('/workspace/example.pdf').type = 'file'
  f.profiles['google-ai-studio'].files.maxFileBytes = 2
  const before = f.reads.length
  assert.equal((await f.call()).isError, true)
  assert.equal(f.reads.length, before)
  assert.equal(f.saved.length, 0)
})

test('capture uses bounded chunks and refuses file mutation or cancellation before publishing a durable reference', async t => {
  const large = Buffer.alloc(2 * 1024 * 1024 + 7, 65)
  Buffer.from('%PDF-').copy(large)
  const f = await fixture(t, { data: large })
  assert.equal((await f.call()).isError, false)
  assert.deepEqual(f.saved[0].bytes, large)
  assert.ok(f.reads.every(read => read.length <= 1024 * 1024))
  const changed = await fixture(t, { data: large })
  changed.setReadHook((_target, range) => { if (range.offset > 0) changed.entries.get('/workspace/example.pdf').version = 'changed' })
  assert.equal((await changed.call()).isError, true)
  assert.equal(changed.saved.length, 0)
  const cancelled = await fixture(t)
  const controller = new AbortController()
  cancelled.setReadHook(() => controller.abort())
  assert.equal((await cancelled.call(undefined, { signal: controller.signal })).isError, true)
  assert.equal(cancelled.saved.length, 0)
})

// PTC nesting is exercised through the real 0.2.2 PTC executor in
// native-file-tool-integration.test.mjs (success, inner/outer block, file
// removal and late cancellation); manual `parent` dispatch is no longer public.

test('step admission shows the upload tool only for an eligible selected route and preserves unrelated tools', async t => {
  const f = await fixture(t)
  f.ctx.tools.register(defineTool({ name: 'unrelated', description: 'Unrelated', parameters: {}, output: { schema: { type: 'boolean' }, render: () => [] }, async execute() { return true } }))
  const visible = async () => {
    const toolSet = await f.resolveTools()
    try { return f.ctx.tools.schemas(f.agent, toolSet).map(tool => tool.name) } finally { toolSet.dispose() }
  }
  let names = await visible()
  assert.ok(names.includes(GOOGLE_NATIVE_FILE_TOOL))
  f.agent.options = { provider: 'other-provider', model: 'other' }
  names = await visible()
  assert.ok(!names.includes(GOOGLE_NATIVE_FILE_TOOL))
  assert.ok(names.includes('unrelated'))
  assert.equal((await f.call()).isError, true, 'a hidden tool cannot be dispatched by name')
})
