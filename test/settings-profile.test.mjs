import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { realSettingsProfile } from './helpers/real-settings-profile.mjs'
import { profilesOf } from '../lib/config.js'
import { buildGenerationConfig } from '../lib/adapter.js'

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
  assert.equal(entry.fiber.resolveConfig(entry.fiber.config).aiStudio.get().generationConfig.temperature, 0.2)
  assert.equal(entry.fiber.resolveConfig(entry.fiber.config).aiStudio.get().models[0].generationConfig.topP, 0.4)
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

test('real profile persists SDK deadlines from provider cards and retains per-model timeout precedence', async t => {
  const { ctx, dir } = await realSettingsProfile(t, { config: {
    aiStudio: { generationConfig: { temperature: 0.2 },
      models: [{ id: 'custom-timeout', generationConfig: { topP: 0.4, httpOptions: { timeout: 1200 } } }] },
    vertex: { generationConfig: { httpOptions: { timeout: 240000, headers: { custom: 'retain' } } } },
  } })
  const entry = ctx.configEditor.entries().find(item => item.options.id === 'dsh-google-native')
  const fiber = entry.fiber
  let snapshot = await ctx.nativeGoogleSettings.get({}, signal())
  for (const [provider, timeout] of [['google-ai-studio', 600000], ['google-vertex-native', 0]]) {
    const before = snapshot.profiles.find(profile => profile.provider === provider)
    snapshot = await ctx.nativeGoogleSettings.save({ provider,
      connection: { ...before.connection, requestTimeoutMs: timeout }, models: before.models,
      expectedRevision: snapshot.revision,
    }, signal())
    assert.equal(snapshot.profiles.find(profile => profile.provider === provider).connection.requestTimeoutMs, timeout)
  }
  assert.equal(entry.fiber, fiber)
  const profiles = profilesOf(fiber.resolveConfig(fiber.config))
  assert.equal(profiles['google-ai-studio'].generationConfig.httpOptions.timeout, 600000)
  assert.equal(profiles['google-ai-studio'].generationConfig.temperature, 0.2)
  assert.equal(profiles['google-vertex-native'].generationConfig.httpOptions.timeout, 0)
  assert.deepEqual(profiles['google-vertex-native'].generationConfig.httpOptions.headers, { custom: 'retain' })
  const model = profiles['google-ai-studio'].models[0]
  const request = { provider: 'google-ai-studio', model: model.id, messages: [] }
  assert.equal(buildGenerationConfig(profiles['google-ai-studio'], model, request).httpOptions.timeout, 1200,
    'existing advanced model settings keep precedence over the provider default')
  assert.equal(buildGenerationConfig(profiles['google-ai-studio'], undefined, request).httpOptions.timeout, 600000)
  const stored = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
  assert.match(stored, /timeout: 600000/)
  assert.match(stored, /timeout: 0/)
})

test('real profile model advanced settings survive persistence and drive exact model metadata and native generation options', async t => {
  const { ctx, dir } = await realSettingsProfile(t, { config: {
    aiStudio: { models: [{ id: 'custom-advanced', name: 'Before edit', generationConfig: {
      topP: 0.8, httpOptions: { headers: { 'x-private': 'never-expose-this-value' } },
    } }] },
  } })
  const entry = ctx.configEditor.entries().find(item => item.options.id === 'dsh-google-native')
  const fiber = entry.fiber
  let snapshot = await ctx.nativeGoogleSettings.get({}, signal())
  for (const provider of ['google-ai-studio', 'google-vertex-native']) {
    const before = snapshot.profiles.find(profile => profile.provider === provider)
    const chosen = provider === 'google-ai-studio' ? 'custom-advanced' : before.models[0].id
    snapshot = await ctx.nativeGoogleSettings.save({ provider, connection: before.connection,
      models: [{ id: chosen, advanced: {
        name: `${provider} edited`, contextWindow: 65536, maxTokens: 4096,
        inputTypes: ['text', 'image', 'pdf'], responseModalities: ['TEXT'], requestTimeoutMs: 45000,
        reasoning: [{ id: 'custom-low', name: 'Custom low', thinkingBudget: 1024 }],
        defaultReasoning: 'custom-low', thinkingConfig: { includeThoughts: false },
      } }], expectedRevision: snapshot.revision,
    }, signal())
    const view = snapshot.profiles.find(profile => profile.provider === provider).models[0]
    assert.equal(view.advanced.maxTokens, 4096)
    assert.equal(view.advanced.defaultReasoning, 'custom-low')
    const info = await ctx.llm.resolveModelInfo(provider, chosen)
    assert.equal(info.name, `${provider} edited`)
    assert.equal(info.context.contextWindow, 65536)
    assert.equal(info.defaultMaxTokens, 4096)
    assert.deepEqual(info.inputModalities, ['text', 'image'])
    assert.equal(info.reasoning.defaultEffort, 'custom-low')
    const call = await ctx.llm.resolveCallConfig({ provider, model: chosen })
    assert.equal(call.maxTokens, 4096)
    assert.equal(call.reasoningEffort, 'custom-low')
    const profile = profilesOf(fiber.resolveConfig(fiber.config))[provider]
    const options = buildGenerationConfig(profile, profile.models[0], { ...call, messages: [] })
    assert.equal(options.maxOutputTokens, 4096)
    assert.deepEqual(options.responseModalities, ['TEXT'])
    assert.equal(options.httpOptions.timeout, 45000)
    assert.deepEqual(options.thinkingConfig, { includeThoughts: false, thinkingBudget: 1024 })
  }
  assert.equal(entry.fiber, fiber)
  const persisted = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
  assert.match(persisted, /contextWindow: 65536/)
  assert.match(persisted, /maxTokens: 4096/)
  assert.match(persisted, /inputTypes:/)
  assert.match(persisted, /responseModalities:/)
  const profile = profilesOf(fiber.resolveConfig(fiber.config))['google-ai-studio']
  assert.equal(profile.models[0].generationConfig.topP, 0.8)
  assert.deepEqual(profile.models[0].generationConfig.httpOptions.headers, { 'x-private': 'never-expose-this-value' })
  assert.doesNotMatch(JSON.stringify(snapshot), /never-expose-this-value/)
})

test('real profiles persist upstream support declarations without changing native requested output formats', async t => {
  const { ctx, dir } = await realSettingsProfile(t, { config: { aiStudio: { models: [{ id: 'metadata-partial', generationConfig: {
    responseModalities: ['AUDIO'], httpOptions: { headers: { 'x-private': 'retain-private-model-option' } },
  } }] } } })
  const entry = ctx.configEditor.entries().find(item => item.options.id === 'dsh-google-native')
  let snapshot = await ctx.nativeGoogleSettings.get({}, signal())
  const metadata = { id: 'metadata-partial', contextWindow: 65536, maxTokens: 8192,
    inputTypes: ['text', 'image', 'pdf'], outputTypes: ['text', 'image'] }
  for (const provider of ['google-ai-studio', 'google-vertex-native']) {
    const profile = snapshot.profiles.find(item => item.provider === provider)
    snapshot = await ctx.nativeGoogleSettings.save({ provider, connection: profile.connection, models: [metadata],
      expectedRevision: snapshot.revision,
    }, signal())
    const model = profilesOf(entry.fiber.resolveConfig(entry.fiber.config))[provider].models[0]
    assert.deepEqual(model.inputTypes, metadata.inputTypes)
    assert.deepEqual(model.outputTypes, metadata.outputTypes)
    const options = buildGenerationConfig(profilesOf(entry.fiber.resolveConfig(entry.fiber.config))[provider], model,
      { provider, model: model.id, messages: [] })
    assert.deepEqual(options.responseModalities, provider === 'google-ai-studio' ? ['AUDIO'] : undefined)
    assert.equal(options.maxOutputTokens, metadata.maxTokens)
    assert.deepEqual(snapshot.profiles.find(item => item.provider === provider).models[0].advanced.outputTypes, metadata.outputTypes)
  }
  const stored = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
  assert.match(stored, /outputTypes:/)
  assert.match(stored, /inputTypes:/)
  assert.doesNotMatch(JSON.stringify(snapshot), /retain-private-model-option/)
})
