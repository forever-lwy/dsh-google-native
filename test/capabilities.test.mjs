import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCapabilities, unsupportedChoices, applyNativeToolChoices, configuredToolChoices, activeNativeToolChoices } from '../lib/capabilities.js'
import { Config, profilesOf, defaultProfile } from '../lib/config.js'

test('chat native controls belong to exact Google models and never leak to another provider', () => {
  const known = resolveCapabilities('google-ai-studio', { id: 'gemini-3.8-flash' })
  assert.deepEqual(known, { nativeFiles: true, search: true, urlContext: true, codeExecution: true, maps: true, functionCallingWithNativeTools: true })
  assert.deepEqual(resolveCapabilities('google-vertex-native', { id: 'gemini-3.8-flash' }), { ...known, functionCallingWithNativeTools: false })
  const none = { nativeFiles: false, search: false, urlContext: false, codeExecution: false, maps: false, functionCallingWithNativeTools: false }
  assert.deepEqual(resolveCapabilities('another-provider', { id: 'gemini-3.8-flash', capabilities: known }), none)
  assert.deepEqual(resolveCapabilities('google-ai-studio', { id: 'gemini-3.8-flash-custom' }), none)
})

test('custom models expose declared capabilities only and known models can opt out', () => {
  assert.deepEqual(resolveCapabilities('google-ai-studio', { id: 'custom-model', capabilities: { nativeFiles: true, search: true } }), {
    nativeFiles: true, search: true, urlContext: false, codeExecution: false, maps: false, functionCallingWithNativeTools: false,
  })
  const capabilities = resolveCapabilities('google-ai-studio', { id: 'gemini-2.5-flash', capabilities: { maps: false } })
  assert.equal(capabilities.maps, false)
  assert.deepEqual(unsupportedChoices(capabilities, { search: true, maps: true, nativeFiles: false }), ['maps'])
  assert.equal(capabilities.functionCallingWithNativeTools, false)
  assert.equal(resolveCapabilities('google-vertex-native', { id: 'custom-model', capabilities: { functionCallingWithNativeTools: true } }).functionCallingWithNativeTools, true)
})

test('custom model capabilities survive the actual Schemastery volatile configuration boundary', () => {
  const config = Config({ aiStudio: { models: [{ id: 'custom-model', capabilities: { nativeFiles: true, search: false } }] } })
  const profile = profilesOf(config)['google-ai-studio']
  assert.deepEqual(profile.models[0].capabilities, { nativeFiles: true, search: false })
  assert.equal(resolveCapabilities(profile.provider, profile.models[0]).nativeFiles, true)
  assert.equal(resolveCapabilities(profile.provider, profile.models[0]).urlContext, false)
})

test('disabling a native tool preserves adjacent native and function declarations without mutating config', () => {
  const config = { tools: [{ googleSearch: { timeRangeFilter: { startTime: '2026-01-01' } }, codeExecution: {}, functionDeclarations: [{ name: 'lookup' }] }, { urlContext: {} }], temperature: 0.4 }
  const before = JSON.stringify(config)
  const result = applyNativeToolChoices(config, { search: false })
  assert.deepEqual(result.tools, [{ codeExecution: {}, functionDeclarations: [{ name: 'lookup' }] }, { urlContext: {} }])
  assert.equal(result.temperature, 0.4)
  assert.equal(JSON.stringify(config), before)
  assert.equal(applyNativeToolChoices(config, {}), config)
})

test('explicit choices override raw REST tool declarations that would otherwise shadow SDK controls', () => {
  const config = { tools: [{ functionDeclarations: [{ name: 'lookup' }] }], httpOptions: { extraBody: { tools: [
    { google_search: { exclude_domains: ['example.com'] }, code_execution: {} },
    { googleSearchRetrieval: { dynamicRetrievalConfig: {} } },
  ], generationConfig: { seed: 123 } } } }
  const before = JSON.stringify(config)
  const result = applyNativeToolChoices(config, { search: false, maps: true })
  assert.deepEqual(result.tools, [{ functionDeclarations: [{ name: 'lookup' }] }, { googleMaps: {} }])
  assert.deepEqual(result.httpOptions.extraBody.tools, [{ code_execution: {} }, { googleMaps: {} }])
  assert.deepEqual(result.httpOptions.extraBody.generationConfig, { seed: 123 })
  assert.equal(JSON.stringify(config), before)
})

test('enabling an already configured tool keeps its native arguments and avoids duplicates', () => {
  const config = { tools: [{ googleMaps: { enableWidget: true } }] }
  assert.deepEqual(applyNativeToolChoices(config, { maps: true }).tools, config.tools)
  assert.deepEqual(applyNativeToolChoices(config, { maps: false }).tools, [])
})

test('conversation defaults reflect configured model overrides and raw REST precedence', () => {
  const profile = defaultProfile('google-ai-studio')
  profile.generationConfig.tools = [{ googleSearch: {} }, { googleMaps: {} }]
  profile.nativeTools.codeExecution = true
  const model = { id: 'custom', generationConfig: { tools: [{ urlContext: {} }] } }
  assert.deepEqual(configuredToolChoices(profile, model), { search: false, maps: false, codeExecution: true, urlContext: true })
  model.generationConfig.httpOptions = { extraBody: { tools: [{ google_search: { exclude_domains: ['example.com'] } }] } }
  assert.deepEqual(configuredToolChoices(profile, model), { search: true, maps: false, codeExecution: false, urlContext: false })
  assert.deepEqual(activeNativeToolChoices({ tools: [{ googleSearch: {} }], httpOptions: { extraBody: { tools: [] } } }), {
    search: false, maps: false, codeExecution: false, urlContext: false,
  })
})
