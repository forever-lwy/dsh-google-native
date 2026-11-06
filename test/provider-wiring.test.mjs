import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
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
