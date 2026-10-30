import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { realSettingsProfile } from './helpers/real-settings-profile.mjs'

const signal = () => new AbortController().signal

test('real profile settings read, persist and apply provider changes without remounting the plugin', async t => {
  const { ctx, dir, values, credentialWrites } = await realSettingsProfile(t, { config: {
    aiStudio: { generationConfig: { temperature: 0.2 }, models: [{ id: 'custom-original', generationConfig: { topP: 0.4 } }] },
  } })
  const entry = ctx.configEditor.entries().find(item => item.options.id === 'dsh-google-native')
  assert.equal(entry.id, 'include:dsh-google-native')
  assert.equal(entry.fiber.state, 2)
  const fiber = entry.fiber
  const before = await ctx.nativeGoogleSettings.get({}, signal())
  assert.equal(before.settingsNs, 'dsh-google-native')
  assert.equal(before.revision, 0)
  assert.equal(before.writable, true)
  assert.equal(before.profiles[0].credential.configured, false)
  const saved = await ctx.nativeGoogleSettings.save({
    provider: 'google-ai-studio',
    connection: { ...before.profiles[0].connection, baseURL: 'https://proxy.example/google/v1beta' },
    models: [{ id: 'custom-original' }, { id: 'gemini-3.8-flash' }],
    apiKey: 'fixture-managed-key', expectedRevision: before.revision,
  }, signal())
  assert.equal(saved.revision, 1)
  assert.equal(saved.profiles[0].connection.baseURL, 'https://proxy.example/google/v1beta')
  assert.deepEqual(saved.profiles[0].models.map(model => model.id), ['custom-original', 'gemini-3.8-flash'])
  assert.equal(saved.profiles[0].credential.configured, true)
  assert.equal(entry.fiber, fiber, 'volatile edits apply through the existing rc.5 fiber')
  assert.equal(entry.fiber.config.aiStudio.get().generationConfig.temperature, 0.2)
  assert.equal(entry.fiber.config.aiStudio.get().models[0].generationConfig.topP, 0.4)
  assert.equal(values.get('GOOGLE_API_KEY'), 'fixture-managed-key')
  assert.equal(credentialWrites.length, 1)
  const stored = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
  assert.match(stored, /https:\/\/proxy\.example\/google\/v1beta/)
  assert.doesNotMatch(stored, /fixture-managed-key/)
  assert.doesNotMatch(JSON.stringify(saved), /fixture-managed-key/)
  const catalog = await ctx.llm.listModels('google-ai-studio')
  assert.ok(catalog.some(model => model.provider === 'google-ai-studio' && model.id === 'gemini-3.8-flash'))
  assert.ok(!catalog.some(model => model.provider === 'google-ai-studio' && model.id === 'gemini-2.5-flash'))
})
