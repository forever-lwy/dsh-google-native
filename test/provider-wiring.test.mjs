import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import * as plugin from '../lib/index.js'

test('actual main plugin mounts chat and provider settings together and disposes every Remote contribution', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new LlmRuntime(ctx)
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  new TypertRegistry(ctx)
  ctx.provide('attachments', { fileHostPath: () => undefined })
  ctx.provide('sessionController', {})
  ctx.provide('sessionPersistence', {})
  ctx.provide('settings', { writable: true, describe: () => [{ ns: 'dsh-google-native', revision: 1 }] })
  ctx.provide('credentials', {
    async describe() { return { configured: true, writable: true, source: 'managed' } },
    async resolve() { throw new Error('reading a settings page must not resolve secret values') },
  })
  const fiber = await ctx.plugin(plugin, {})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(typeof ctx.nativeGoogleChat.get, 'function')
  assert.equal(typeof ctx.nativeGoogleSettings.get, 'function')
  const endpoints = ctx.typert.remotes.list().map(item => `${item.namespace}/${item.method}`).sort()
  assert.deepEqual(endpoints, ['nativeGoogleChat/get', 'nativeGoogleChat/set', 'nativeGoogleSettings/discover', 'nativeGoogleSettings/get', 'nativeGoogleSettings/save'])
  const state = await ctx.nativeGoogleSettings.get({}, new AbortController().signal)
  assert.equal(state.profiles.length, 2)
  assert.equal(state.revision, 1)
  assert.ok(state.profiles.every(profile => profile.credential.configured))
  assert.equal(JSON.stringify(state).includes('apiKey"'), false)
  await fiber.dispose()
  assert.equal(ctx.get('nativeGoogleSettings'), undefined)
  assert.equal(ctx.get('nativeGoogleChat'), undefined)
  assert.equal(ctx.typert.remotes.list().length, 0)
})

test('the mounted plugin admits the attach tool only on its own route while the session keeps native files on', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new LlmRuntime(ctx)
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  new TypertRegistry(ctx)
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx)
  ctx.provide('attachments', { fileHostPath: () => undefined })
  ctx.provide('fs', {})
  ctx.provide('workingDirectory', { get: () => '/workspace' })
  ctx.provide('sessionQuery', {})
  const session = ctx.sessions.create(SessionId('wiring-session'), {})
  const agent = { id: session.id, session, status: 'idle', options: { provider: 'google-ai-studio', model: 'gemini-4-argon' } }
  ctx.provide('sessionController', { async resolveAgent() { return { agent } } })
  ctx.provide('sessionPersistence', {})
  await ctx.plugin(plugin, {})
  await new Promise(resolve => setImmediate(resolve))
  const visible = async (provider, model) => {
    const toolSet = await ctx.tools.resolve({ agent, modelSelection: { provider, model }, signal: new AbortController().signal })
    try { return ctx.tools.schemas(agent, toolSet).some(tool => tool.name === plugin.GOOGLE_NATIVE_FILE_TOOL) } finally { toolSet.dispose() }
  }
  assert.equal(await visible('google-ai-studio', 'gemini-4-argon'), true)
  assert.equal(await visible('claude-native', 'claude-opus-5-5'), false)
  assert.equal(await visible('deepseek', 'gemini-4-argon'), false)
  const request = { sessionId: 'wiring-session', provider: 'google-ai-studio', model: 'gemini-4-argon' }
  const signal = new AbortController().signal
  const before = await ctx.nativeGoogleChat.get(request, signal)
  const off = await ctx.nativeGoogleChat.set({ ...request, choices: { ...before.choices, nativeFiles: false }, expectedRevision: before.revision }, signal)
  assert.equal(await visible('google-ai-studio', 'gemini-4-argon'), false, 'the saved switch removes the tool from the next step')
  assert.equal(await visible('google-ai-studio', 'gemini-3.8-flash'), true, 'another model of the session keeps its own switch')
  await ctx.nativeGoogleChat.set({ ...request, choices: { ...off.choices, nativeFiles: true }, expectedRevision: off.revision }, signal)
  assert.equal(await visible('google-ai-studio', 'gemini-4-argon'), true)
})
