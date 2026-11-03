import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { readFile } from 'node:fs/promises'
import { runInThisContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import * as cordis from '@deepseek-ai/cordis'
import * as slotCore from '@deepseek-ai/dsh-client-ui-slots'
import * as clientStore from '@deepseek-ai/dsh-client-store'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { apply as installRemote } from '@deepseek-ai/dsh-api-gateway/client'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { realSettingsProfile } from './helpers/real-settings-profile.mjs'

const studio = 'google-ai-studio'
const vertex = 'google-vertex-native'
const snapshot = (change = {}) => ({ settingsNs: 'dsh-google-native', revision: 3, writable: true, profiles: [
  { provider: studio, connection: { enabled: true, apiKeyEnv: 'GOOGLE_API_KEY', vertexAuth: 'adc', baseURL: 'https://saved.example/gemini' },
    credential: { configured: true, writable: true }, models: [{ id: 'gemini-3.8-flash', name: 'Saved Flash', contextWindow: 1000000 }] },
  { provider: vertex, connection: { enabled: false, apiKeyEnv: 'GOOGLE_VERTEX_API_KEY', vertexAuth: 'adc', project: 'cloud-project', location: 'global' },
    credential: { configured: false, writable: true }, models: [{ id: 'gemini-4-argon', name: 'Argon' }] },
], ...change })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

describe('provider connection and model-selection settings in an actual DOM', () => {
  let dom, React, createRoot, Simulate, ProviderSettings
  const originals = new Map()
  before(async () => {
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://dsh.test/' })
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
      HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    React = await import('react')
    ;({ createRoot } = await import('react-dom/client'))
    ;({ Simulate } = await import('react-dom/test-utils'))
    ;({ ProviderSettings } = await import('../lib/client/ProviderSettings.js'))
  })
  after(() => {
    dom.window.close()
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  async function mount(t, options = {}) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const reads = [], discoveries = [], saves = []
    const original = options.snapshot ?? snapshot()
    const props = { provider: { provider: options.provider ?? studio, settingsNs: 'dsh-google-native' },
      configured: true, keyConfigured: true, entryKey: 'dsh-google-native', t: key => key,
      useRemoteAccess: method => options.access?.[method] ?? true,
      read: signal => { reads.push(signal); return options.read ? options.read(signal) : Promise.resolve(original) },
      discover: (request, signal) => { discoveries.push({ request, signal }); return options.discover ? options.discover(request, signal) : Promise.resolve({ models: [{ id: 'gemini-new', name: 'New Gemini', contextWindow: 2000000 }] }) },
      save: (request, signal) => {
        saves.push({ request, signal })
        return options.save ? options.save(request, signal) : Promise.resolve({ ...original, revision: original.revision + 1,
          profiles: original.profiles.map(profile => profile.provider === request.provider ? { ...profile, connection: request.connection, models: request.models } : profile) })
      },
    }
    const flush = async action => React.act(async () => { action?.() })
    await flush(() => root.render(React.createElement(ProviderSettings, props)))
    if (!options.collapsed) await flush(() => container.querySelector('button').click())
    t.after(async () => { await flush(() => root.unmount()); container.remove() })
    return { container, props, reads, discoveries, saves, flush,
      async route(provider) { props.provider = { ...props.provider, provider }; await flush(() => root.render(React.createElement(ProviderSettings, props))) },
      field: key => container.querySelector(`[data-google-setting="${key}"]`),
      model: id => [...container.querySelectorAll('[data-google-model]')].find(node => node.dataset.googleModel === id),
      modelExpand: id => [...container.querySelectorAll('[data-google-model-expand]')].find(node => node.dataset.googleModelExpand === id),
      modelPanel: id => [...container.querySelectorAll('[data-google-model-advanced]')].find(node => node.dataset.googleModelAdvanced === id),
      modelField: (id, key) => [...container.querySelectorAll('[data-google-model-advanced]')].find(node => node.dataset.googleModelAdvanced === id)?.querySelector(`[data-google-model-setting="${key}"]`),
      button: key => [...container.querySelectorAll('button')].find(button => button.textContent === key),
      async click(button) { assert.ok(button); await flush(() => button.click()) },
      async change(input, value) {
        assert.ok(input)
        await flush(() => {
          const prototype = input.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
          // Other suites may have loaded ReactDOM before this document existed.
          // Dispatch through React's event system instead of relying on its
          // module-initialization browser feature detection for text inputs.
          Simulate.change(input)
        })
      },
    }
  }

  test('collapsed provider cards never fetch settings, and read permission is enforced before any request', async t => {
    const collapsed = await mount(t, { collapsed: true })
    assert.equal(collapsed.reads.length, 0)
    assert.match(collapsed.container.textContent, /configure/)
    const denied = await mount(t, { access: { 'nativeGoogleSettings/get': false } })
    assert.equal(denied.reads.length, 0)
    assert.equal(denied.field('baseURL') === null, true)
    assert.match(denied.container.textContent, /noRead/)
  })

  test('fetch uses unsaved Base URL and write-only key, and new models require explicit selection before Save', async t => {
    const f = await mount(t)
    assert.equal(f.field('baseURL').value, 'https://saved.example/gemini')
    assert.equal(f.field('apiKey').value, '')
    assert.equal(f.field('apiKey').type, 'password')
    await f.change(f.field('baseURL'), 'https://draft.example/proxy/v1beta')
    await f.change(f.field('apiKey'), 'transient-test-key')
    await f.click(f.button('discover'))
    assert.equal(f.discoveries[0].request.connection.baseURL, 'https://draft.example/proxy/v1beta')
    assert.equal(f.discoveries[0].request.apiKey, 'transient-test-key')
    assert.equal(f.saves.length, 0)
    assert.equal(f.model('gemini-3.8-flash').checked, true)
    assert.equal(f.model('gemini-new').checked, false)
    await f.click(f.model('gemini-3.8-flash'))
    await f.click(f.model('gemini-new'))
    await f.click(f.button('save'))
    assert.equal(f.saves.length, 1)
    assert.equal(f.saves[0].request.expectedRevision, 3)
    assert.deepEqual(f.saves[0].request.models, [{ id: 'gemini-new', name: 'New Gemini', contextWindow: 2000000 }])
    assert.equal(f.saves[0].request.connection.baseURL, 'https://draft.example/proxy/v1beta')
    assert.equal(f.saves[0].request.apiKey, 'transient-test-key')
    assert.equal(f.field('apiKey').value, '', 'accepted keys are removed from the password field')
  })

  test('timeout seconds preserve millisecond precision, apply only after Save, and reload independently for each provider', async t => {
    let state = snapshot()
    state.profiles[0].connection.requestTimeoutMs = 1500
    state.profiles[1].connection.requestTimeoutMs = 90000
    const options = { read: async () => state, save: async request => {
      state = { ...state, revision: state.revision + 1,
        profiles: state.profiles.map(profile => profile.provider === request.provider
          ? { ...profile, connection: request.connection, models: request.models } : profile) }
      return state
    } }
    const first = await mount(t, options)
    assert.equal(first.field('requestTimeoutSeconds').value, '1.5')
    await first.change(first.field('requestTimeoutSeconds'), '1.001')
    await first.click(first.button('discover'))
    assert.equal(first.discoveries[0].request.connection.requestTimeoutMs, 1001)
    assert.equal(state.profiles[0].connection.requestTimeoutMs, 1500, 'editing and discovery do not change saved settings')
    await first.click(first.button('save'))
    assert.equal(first.saves[0].request.connection.requestTimeoutMs, 1001)
    assert.equal(first.field('requestTimeoutSeconds').value, '1.001')
    const reload = await mount(t, options)
    const other = await mount(t, { ...options, provider: vertex })
    assert.equal(reload.field('requestTimeoutSeconds').value, '1.001')
    assert.equal(other.field('requestTimeoutSeconds').value, '90')
    await other.change(other.field('requestTimeoutSeconds'), '0')
    await other.click(other.button('save'))
    assert.equal(other.saves[0].request.connection.requestTimeoutMs, 0)
    assert.equal(state.profiles[0].connection.requestTimeoutMs, 1001)
    assert.equal(state.profiles[1].connection.requestTimeoutMs, 0)
  })

  test('invalid timeout values stop both discovery and Save while the maximum millisecond value remains exact', async t => {
    const f = await mount(t)
    assert.equal(f.field('requestTimeoutSeconds').value, '0', 'an unset legacy timeout has no extra local deadline')
    for (const value of ['', '-1', '0.0001', '2147483.648', '1e9']) {
      await f.change(f.field('requestTimeoutSeconds'), value)
      assert.equal(f.field('requestTimeoutSeconds').getAttribute('aria-invalid'), 'true', value)
      assert.match(f.container.textContent, /requestTimeoutError/)
      assert.equal(f.button('save').disabled, true, value)
      assert.equal(f.button('discover').disabled, true, value)
      await f.click(f.button('save'))
      await f.click(f.button('discover'))
    }
    assert.equal(f.saves.length, 0)
    assert.equal(f.discoveries.length, 0)
    await f.change(f.field('requestTimeoutSeconds'), '2147483.647')
    assert.equal(f.field('requestTimeoutSeconds').getAttribute('aria-invalid'), 'false')
    await f.click(f.button('save'))
    assert.equal(f.saves[0].request.connection.requestTimeoutMs, 2147483647)
  })

  test('timeout edits stay disabled until a pending Save is acknowledged', async t => {
    const pending = deferred()
    const f = await mount(t, { save: () => pending.promise })
    await f.click(f.modelExpand('gemini-3.8-flash'))
    await f.change(f.field('requestTimeoutSeconds'), '600')
    await f.click(f.button('save'))
    assert.equal(f.field('requestTimeoutSeconds').disabled, true)
    assert.equal(f.button('discover').disabled, true)
    assert.equal(f.modelField('gemini-3.8-flash', 'contextWindow').disabled, true)
    assert.equal(f.saves[0].request.connection.requestTimeoutMs, 600000)
    await f.flush(() => pending.resolve(snapshot({ revision: 4, profiles: snapshot().profiles.map(profile => profile.provider === studio
      ? { ...profile, connection: { ...profile.connection, requestTimeoutMs: 600000 } } : profile) })))
    assert.equal(f.field('requestTimeoutSeconds').disabled, false)
    assert.equal(f.field('requestTimeoutSeconds').value, '600')
  })

  test('legacy snapshots show file defaults without becoming dirty and expose only the active backend limit', async t => {
    const first = await mount(t)
    assert.equal(first.field('inlineThresholdBytesMiB').value, '8')
    assert.equal(first.field('maxFileBytesMiB').value, '300')
    assert.equal(first.field('inlineMaxBytesMiB'), null)
    assert.equal(first.button('save').disabled, true)
    const other = await mount(t, { provider: vertex })
    assert.equal(other.field('inlineMaxBytesMiB').value, '16')
    assert.equal(other.field('maxFileBytesMiB').value, '300')
    assert.equal(other.field('inlineThresholdBytesMiB'), null)
    assert.equal(other.button('save').disabled, true)
  })

  test('file limits use MiB in the form, save exact bytes, reload and remain independent for each provider', async t => {
    let state = snapshot()
    const options = { read: async () => state, save: async request => {
      state = { ...state, revision: state.revision + 1,
        profiles: state.profiles.map(profile => profile.provider === request.provider
          ? { ...profile, connection: request.connection, models: request.models } : profile) }
      return state
    } }
    const first = await mount(t, options)
    await first.change(first.field('inlineThresholdBytesMiB'), '64')
    assert.equal(first.button('save').disabled, false)
    await first.click(first.button('discover'))
    assert.deepEqual(first.discoveries[0].request.connection.files, { inlineThresholdBytes: 67108864 })
    assert.equal(state.profiles[0].connection.files, undefined, 'editing and discovery do not persist a new limit')
    await first.click(first.button('save'))
    assert.equal(first.saves[0].request.connection.files.inlineThresholdBytes, 67108864)
    assert.equal(first.field('inlineThresholdBytesMiB').value, '64')
    assert.equal(first.button('save').disabled, true)
    const reload = await mount(t, options)
    assert.equal(reload.field('inlineThresholdBytesMiB').value, '64')
    const other = await mount(t, { ...options, provider: vertex })
    assert.equal(other.field('inlineMaxBytesMiB').value, '16')
    await other.change(other.field('inlineMaxBytesMiB'), '32')
    await other.change(other.field('maxFileBytesMiB'), '512')
    await other.click(other.button('save'))
    assert.deepEqual(state.profiles[1].connection.files, { inlineMaxBytes: 33554432, maxFileBytes: 536870912 })
    assert.deepEqual(state.profiles[0].connection.files, { inlineThresholdBytes: 67108864 })
    const vertexReload = await mount(t, { ...options, provider: vertex })
    assert.equal(vertexReload.field('inlineMaxBytesMiB').value, '32')
    assert.equal(vertexReload.field('maxFileBytesMiB').value, '512')
  })

  test('invalid file sizes prevent discovery and Save, including fractions of a byte and unsafe byte counts', async t => {
    const f = await mount(t)
    for (const key of ['inlineThresholdBytesMiB', 'maxFileBytesMiB']) {
      for (const value of ['', '0', '-1', '0.0000001', '8589934592', '1e50']) {
        await f.change(f.field(key), value)
        assert.equal(f.field(key).getAttribute('aria-invalid'), 'true', `${key}=${value}`)
        assert.match(f.container.textContent, /fileSizeError/)
        assert.equal(f.button('save').disabled, true, `${key}=${value}`)
        assert.equal(f.button('discover').disabled, true, `${key}=${value}`)
        await f.click(f.button('save'))
        await f.click(f.button('discover'))
      }
      await f.change(f.field(key), key === 'maxFileBytesMiB' ? '300' : '8')
    }
    assert.equal(f.saves.length, 0)
    assert.equal(f.discoveries.length, 0)
    assert.equal(f.button('save').disabled, true, 'returning both limits to their defaults clears the draft change')
    await f.change(f.field('inlineThresholdBytesMiB'), '1.5')
    assert.equal(f.field('inlineThresholdBytesMiB').getAttribute('aria-invalid'), 'false')
    await f.click(f.button('save'))
    assert.equal(f.saves[0].request.connection.files.inlineThresholdBytes, 1572864)
  })

  test('existing non-MiB byte limits remain exact during unrelated edits and can represent a single byte', async t => {
    const state = snapshot()
    state.profiles[0].connection.files = { inlineThresholdBytes: 8388609, inlineMaxBytes: 1, maxFileBytes: Number.MAX_SAFE_INTEGER }
    const f = await mount(t, { snapshot: state })
    assert.equal(f.field('inlineThresholdBytesMiB').value, '8.00000095367431640625')
    assert.equal(f.field('maxFileBytesMiB').value, '8589934591.99999904632568359375')
    assert.equal(f.field('maxFileBytesMiB').getAttribute('aria-invalid'), 'false')
    assert.equal(f.button('save').disabled, true)
    await f.change(f.field('baseURL'), 'https://other.example')
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.connection.files, state.profiles[0].connection.files)
    await f.change(f.field('inlineThresholdBytesMiB'), '0.00000095367431640625')
    await f.click(f.button('save'))
    assert.equal(f.saves[1].request.connection.files.inlineThresholdBytes, 1)
    assert.equal(f.saves[1].request.connection.files.maxFileBytes, Number.MAX_SAFE_INTEGER)
  })

  test('file limit edits remain disabled while Save is pending and read-only access cannot edit them', async t => {
    const pending = deferred()
    const f = await mount(t, { save: () => pending.promise })
    await f.change(f.field('inlineThresholdBytesMiB'), '64')
    await f.click(f.button('save'))
    assert.equal(f.field('inlineThresholdBytesMiB').disabled, true)
    assert.equal(f.field('maxFileBytesMiB').disabled, true)
    assert.equal(f.button('discover').disabled, true)
    await f.flush(() => pending.resolve(snapshot({ revision: 4, profiles: snapshot().profiles.map(profile => profile.provider === studio
      ? { ...profile, connection: { ...profile.connection, files: { inlineThresholdBytes: 67108864 } } } : profile) })))
    assert.equal(f.field('inlineThresholdBytesMiB').disabled, false)
    assert.equal(f.field('inlineThresholdBytesMiB').value, '64')
    const readonly = await mount(t, { access: { 'nativeGoogleSettings/save': false } })
    assert.equal(readonly.field('inlineThresholdBytesMiB').disabled, true)
    assert.equal(readonly.field('maxFileBytesMiB').disabled, true)
  })

  test('models omitted by upstream remain selected, and selecting filtered results keeps other selections', async t => {
    const f = await mount(t)
    await f.click(f.button('discover'))
    assert.equal(f.model('gemini-3.8-flash').checked, true)
    await f.change(f.container.querySelector('input[type=search]'), 'new')
    assert.equal(f.model('gemini-3.8-flash') === undefined, true)
    await f.click(f.button('selectAll'))
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.models.map(model => model.id), ['gemini-3.8-flash', 'gemini-new'])
  })

  test('existing model advanced edits alone enable Save and survive discovery without rewriting unedited native settings', async t => {
    const state = snapshot()
    const id = 'gemini-3.8-flash'
    state.profiles[0].models[0].advanced = { contextWindow: 1000000, maxTokens: 32768,
      inputTypes: ['text', 'image', 'pdf'], responseModalities: ['TEXT'], requestTimeoutMs: 90000,
      reasoning: [{ id: 'lite', name: 'Light', thinkingLevel: 'MINIMAL' }, { id: 'max', name: 'Maximum', thinkingLevel: 'FUTURE_LEVEL' }],
      defaultReasoning: 'lite', thinkingConfig: { includeThoughts: false, thinkingBudget: 512 } }
    const f = await mount(t, { snapshot: state, discover: async () => ({ models: [{ id, name: 'Upstream renamed', contextWindow: 12345 }] }) })
    await f.click(f.modelExpand(id))
    assert.equal(f.model(id).checked, true, 'the advanced button does not toggle model selection')
    assert.equal(f.modelField(id, 'maxTokens').value, '32768')
    assert.equal(f.modelField(id, 'thinkingFormat').value, 'level')
    assert.equal(f.modelPanel(id).querySelectorAll('[data-google-effort-field=value]')[1].value, 'FUTURE_LEVEL')
    assert.equal(f.button('save').disabled, true, 'opening a model does not create an edit')
    await f.change(f.modelField(id, 'contextWindow'), '2000000')
    assert.equal(f.button('save').disabled, false)
    await f.click(f.button('discover'))
    assert.equal(f.modelField(id, 'contextWindow').value, '2000000')
    await f.change(f.modelField(id, 'maxTokens'), '65536')
    await f.change(f.modelField(id, 'timeoutSeconds'), '17.125')
    await f.click(f.modelPanel(id).querySelector('[data-google-model-input=image]'))
    await f.click(f.modelPanel(id).querySelector('[data-google-model-input=pdf]'))
    await f.click(f.modelPanel(id).querySelector('[data-google-model-input=video]'))
    await f.click(f.modelPanel(id).querySelector('[data-google-model-output=AUDIO]'))
    await f.change(f.modelPanel(id).querySelector('[data-google-effort-field=value]'), 'LOW')
    await f.change(f.modelField(id, 'includeThoughts'), 'on')
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.models[0].advanced, { contextWindow: 2000000, maxTokens: 65536,
      inputTypes: ['text', 'video'], responseModalities: ['TEXT', 'AUDIO'], requestTimeoutMs: 17125,
      reasoning: [{ id: 'lite', name: 'Light', thinkingLevel: 'LOW' }, { id: 'max', name: 'Maximum', thinkingLevel: 'FUTURE_LEVEL' }],
      thinkingConfig: { includeThoughts: true } })
    assert.equal(f.saves[0].request.models[0].name, 'Saved Flash', 'discovery metadata does not overwrite configured metadata')
  })

  test('a newly discovered known model sends only its edited capacity and preserves Host presets', async t => {
    const id = 'gemini-2.5-flash'
    const f = await mount(t, { discover: async () => ({ models: [{ id, name: 'New Flash', contextWindow: 1048576, maxTokens: 65536 }] }) })
    await f.click(f.button('discover'))
    await f.click(f.model(id))
    await f.click(f.modelExpand(id))
    await f.change(f.modelField(id, 'contextWindow'), '2000000')
    await f.click(f.button('save'))
    const edited = f.saves[0].request.models.find(model => model.id === id)
    assert.deepEqual(edited.advanced, { contextWindow: 2000000 }, 'no null thinking fields erase the known-model preset')
    assert.equal('advanced' in f.saves[0].request.models.find(model => model.id === 'gemini-3.8-flash'), false)
  })

  test('upstream limits and supported types autofill a new model and persist without requesting every output modality', async t => {
    const id = 'proxy/catalog-model'
    const f = await mount(t, { discover: async () => ({ models: [{ id, name: 'Catalog Model', contextWindow: 262144, maxTokens: 16384,
      inputTypes: ['text', 'image', 'pdf'], outputTypes: ['text', 'image'] }] }) })
    await f.click(f.button('discover'))
    await f.click(f.modelExpand(id))
    assert.equal(f.modelField(id, 'contextWindow').value, '262144')
    assert.equal(f.modelField(id, 'maxTokens').value, '16384')
    assert.equal(f.modelField(id, 'inputMode').value, 'custom')
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-input=image]').checked, true)
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-input=audio]').checked, false)
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-input=pdf]').checked, true)
    assert.equal(f.modelField(id, 'supportedOutputMode').value, 'custom')
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-supported-output=image]').checked, true)
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-supported-output=audio]').checked, false)
    assert.equal(f.modelField(id, 'outputMode').value, 'inherit', 'supported types do not become requested response modalities')
    await f.click(f.model(id))
    await f.click(f.button('save'))
    const selected = f.saves[0].request.models.find(model => model.id === id)
    assert.equal(selected.contextWindow, 262144)
    assert.equal(selected.maxTokens, 16384)
    assert.deepEqual(selected.inputTypes, ['text', 'image', 'pdf'])
    assert.deepEqual(selected.outputTypes, ['text', 'image'])
    assert.deepEqual(selected.advanced, { inputTypes: ['text', 'image', 'pdf'], outputTypes: ['text', 'image'] })
    assert.equal('responseModalities' in selected.advanced, false)
  })

  test('missing upstream metadata remains editable and manually declared support is saved independently of output requests', async t => {
    const id = 'proxy/no-metadata'
    const f = await mount(t, { discover: async () => ({ models: [{ id }] }) })
    await f.click(f.button('discover'))
    await f.click(f.modelExpand(id))
    assert.equal(f.modelField(id, 'contextWindow').value, '')
    assert.equal(f.modelField(id, 'maxTokens').value, '')
    assert.equal(f.modelField(id, 'inputMode').value, 'inherit')
    assert.equal(f.modelField(id, 'supportedOutputMode').value, 'inherit')
    assert.equal(f.modelField(id, 'contextWindow').disabled, false)
    await f.change(f.modelField(id, 'contextWindow'), '32768')
    await f.change(f.modelField(id, 'maxTokens'), '4096')
    await f.change(f.modelField(id, 'inputMode'), 'custom')
    for (const type of ['audio', 'video', 'pdf']) await f.click(f.modelPanel(id).querySelector(`[data-google-model-input=${type}]`))
    await f.change(f.modelField(id, 'supportedOutputMode'), 'custom')
    await f.click(f.modelPanel(id).querySelector('[data-google-model-supported-output=audio]'))
    await f.click(f.model(id))
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.models.find(model => model.id === id).advanced, {
      contextWindow: 32768, maxTokens: 4096, inputTypes: ['text', 'image'], outputTypes: ['text', 'audio'],
    })
  })

  test('repeated discovery fills untouched missing fields while preserving manual edits and explicit inherit choices', async t => {
    const id = 'gemini-3.8-flash'
    let attempt = 0
    const f = await mount(t, { discover: async () => ({ models: [{ id, name: 'Upstream Flash', contextWindow: 2000000,
      maxTokens: ++attempt === 1 ? 32768 : 65536, inputTypes: attempt === 1 ? ['text', 'image'] : ['text', 'video'],
      outputTypes: attempt === 1 ? ['text', 'image'] : ['text', 'audio'] }] }) })
    await f.click(f.modelExpand(id))
    await f.change(f.modelField(id, 'name'), 'Manual Name')
    await f.click(f.button('discover'))
    assert.equal(f.modelField(id, 'name').value, 'Manual Name')
    assert.equal(f.modelField(id, 'contextWindow').value, '1000000', 'saved limits take priority over upstream metadata')
    assert.equal(f.modelField(id, 'maxTokens').value, '32768', 'an unrelated edit does not prevent missing-field autofill')
    assert.equal(f.modelField(id, 'inputMode').value, 'custom')
    assert.equal(f.modelField(id, 'supportedOutputMode').value, 'custom')
    await f.change(f.modelField(id, 'maxTokens'), '7000')
    await f.click(f.modelPanel(id).querySelector('[data-google-model-input=audio]'))
    await f.change(f.modelField(id, 'supportedOutputMode'), 'inherit')
    await f.click(f.button('discover'))
    assert.equal(f.modelField(id, 'maxTokens').value, '7000')
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-input=image]').checked, true)
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-input=audio]').checked, true)
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-input=video]').checked, false)
    assert.equal(f.modelField(id, 'supportedOutputMode').value, 'inherit')
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.models[0].advanced, { name: 'Manual Name', maxTokens: 7000,
      inputTypes: ['text', 'image', 'audio'], outputTypes: null })
  })

  test('saved support declarations and output requests survive rediscovery and need no redundant Save', async t => {
    const state = snapshot(), id = 'gemini-3.8-flash'
    state.profiles[0].models[0].advanced = { contextWindow: 1000000, maxTokens: 8192,
      inputTypes: ['text', 'pdf'], outputTypes: ['audio'], responseModalities: ['AUDIO'] }
    const f = await mount(t, { snapshot: state, discover: async () => ({ models: [{ id, contextWindow: 2000000,
      maxTokens: 65536, inputTypes: ['text', 'image'], outputTypes: ['text', 'image'] }] }) })
    await f.click(f.modelExpand(id))
    await f.click(f.button('discover'))
    assert.equal(f.modelField(id, 'contextWindow').value, '1000000')
    assert.equal(f.modelField(id, 'maxTokens').value, '8192')
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-input=pdf]').checked, true)
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-input=image]').checked, false)
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-supported-output=audio]').checked, true)
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-supported-output=text]').checked, false)
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-output=AUDIO]').checked, true)
    assert.equal(f.button('save').disabled, true, 'discovery did not change any saved setting')
  })

  test('unsaved models refresh untouched metadata and keep edits even when unselected and later omitted upstream', async t => {
    const id = 'proxy/refresh-metadata'
    let attempt = 0
    const f = await mount(t, { discover: async () => {
      attempt++
      return { models: attempt === 3 ? [] : [{ id, contextWindow: attempt === 1 ? 100000 : 200000,
        maxTokens: attempt === 1 ? 16384 : 32768, inputTypes: attempt === 1 ? ['text', 'image'] : ['text', 'pdf'],
        outputTypes: attempt === 1 ? ['text', 'image'] : ['text', 'audio'] }] }
    } })
    await f.click(f.button('discover'))
    await f.click(f.model(id))
    await f.click(f.modelExpand(id))
    await f.change(f.modelField(id, 'contextWindow'), '300000')
    await f.click(f.model(id))
    await f.click(f.button('discover'))
    assert.equal(f.modelField(id, 'contextWindow').value, '300000')
    assert.equal(f.modelField(id, 'maxTokens').value, '32768', 'untouched autofill values follow the latest returned metadata')
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-input=pdf]').checked, true)
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-supported-output=audio]').checked, true)
    await f.click(f.button('discover'))
    assert.ok(f.model(id), 'an unselected model with unsaved edits remains available when omitted upstream')
    assert.equal(f.modelField(id, 'contextWindow').value, '300000')
    await f.click(f.model(id))
    await f.click(f.button('save'))
    const selected = f.saves[0].request.models.find(model => model.id === id)
    assert.equal(selected.maxTokens, 32768)
    assert.deepEqual(selected.advanced, { contextWindow: 300000, inputTypes: ['text', 'pdf'], outputTypes: ['text', 'audio'] })
  })

  test('autofilling an existing selected model enables Save without any manual edit', async t => {
    const id = 'gemini-3.8-flash'
    const f = await mount(t, { discover: async () => ({ models: [{ id, maxTokens: 16384,
      inputTypes: ['text', 'pdf'], outputTypes: ['text'] }] }) })
    await f.click(f.button('discover'))
    assert.equal(f.button('save').disabled, false)
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.models[0].advanced, { maxTokens: 16384, inputTypes: ['text', 'pdf'], outputTypes: ['text'] })
  })

  test('saved native max-token fallbacks and unknown-value sentinels survive discovery until explicitly edited', async t => {
    const id = 'gemini-3.8-flash'
    for (const savedMaximum of [8192, null]) {
      const state = snapshot()
      state.profiles[0].models[0].advanced = { maxTokens: savedMaximum }
      const f = await mount(t, { snapshot: state, discover: async () => ({ models: [{ id, maxTokens: 65536 }] }) })
      await f.click(f.button('discover'))
      await f.click(f.modelExpand(id))
      assert.equal(f.modelField(id, 'maxTokens').value, savedMaximum === null ? '' : '8192')
      if (savedMaximum === null) assert.match(f.modelPanel(id).textContent, /nativeMaxTokensHint/)
      assert.equal(f.button('save').disabled, true, 'catalog max tokens cannot replace a saved native override')
      await f.change(f.modelField(id, 'name'), 'Manual Name')
      await f.click(f.button('save'))
      assert.deepEqual(f.saves[0].request.models[0].advanced, { name: 'Manual Name' }, 'unrelated edits preserve native max-token values')
    }
    const state = snapshot()
    state.profiles[0].models[0].advanced = { maxTokens: null }
    const override = await mount(t, { snapshot: state, discover: async () => ({ models: [{ id, maxTokens: 65536 }] }) })
    await override.click(override.modelExpand(id))
    await override.change(override.modelField(id, 'maxTokens'), '4096')
    await override.click(override.button('discover'))
    assert.equal(override.modelField(id, 'maxTokens').value, '4096')
    await override.click(override.button('save'))
    assert.deepEqual(override.saves[0].request.models[0].advanced, { maxTokens: 4096 }, 'an explicit edit can replace an unrepresentable native override')
    const clear = await mount(t, { snapshot: state })
    await clear.click(clear.modelExpand(id))
    await clear.change(clear.modelField(id, 'maxTokens'), '4096')
    await clear.change(clear.modelField(id, 'maxTokens'), '')
    await clear.click(clear.button('save'))
    assert.deepEqual(clear.saves[0].request.models[0].advanced, { maxTokens: null }, 'an explicit edit followed by clearing removes the native override even without discovered metadata')
  })

  test('discovery matches stored native model prefixes without duplicating rows or losing selected IDs and edits', async t => {
    for (const prefix of ['models/', 'publishers/google/models/']) {
      const canonical = 'proxy-flash', id = `${prefix}${canonical}`, state = snapshot()
      state.profiles[0].models = [{ id, name: 'Stored Alias' }]
      const f = await mount(t, { snapshot: state, discover: async () => ({ models: [
        { id: canonical, contextWindow: 262144, maxTokens: 16384, inputTypes: ['text', 'pdf'], outputTypes: ['text'] },
        { id: `models/${canonical}`, contextWindow: 262144, maxTokens: 16384, inputTypes: ['text', 'pdf'], outputTypes: ['text'] },
      ] }) })
      await f.click(f.modelExpand(id))
      await f.change(f.modelField(id, 'maxTokens'), '8192')
      await f.click(f.button('discover'))
      assert.equal(f.container.querySelectorAll('[data-google-model]').length, 1, prefix)
      assert.equal(f.model(id).checked, true)
      assert.equal(f.model(canonical), undefined)
      assert.equal(f.modelField(id, 'contextWindow').value, '262144')
      assert.equal(f.modelField(id, 'maxTokens').value, '8192', 'the original stored ID still owns its draft')
      assert.equal(f.modelPanel(id).querySelector('[data-google-model-input=pdf]').checked, true)
      await f.change(f.container.querySelector('input[aria-label=manual]'), canonical)
      await f.click(f.button('add'))
      assert.equal(f.container.querySelectorAll('[data-google-model]').length, 1, 'manual aliases also reuse the existing row')
      await f.click(f.button('save'))
      assert.deepEqual(f.saves[0].request.models.map(model => model.id), [id])
      assert.deepEqual(f.saves[0].request.models[0].advanced, {
        contextWindow: 262144, maxTokens: 8192, inputTypes: ['text', 'pdf'], outputTypes: ['text'],
      })
    }
  })

  test('every selected model is validated even when collapsed or filtered out, while unselected drafts do not block Save', async t => {
    const f = await mount(t)
    const id = 'gemini-3.8-flash'
    await f.click(f.modelExpand(id))
    for (const [key, value] of [['contextWindow', '0'], ['contextWindow', '1.5'], ['contextWindow', '9007199254740992'],
      ['maxTokens', '1000000'], ['maxTokens', '2000000'], ['timeoutSeconds', '-1'], ['timeoutSeconds', '1.0001'], ['timeoutSeconds', '2147483.648']]) {
      await f.change(f.modelField(id, key), value)
      assert.equal(f.button('save').disabled, true, `${key}=${value}`)
      assert.match(f.container.textContent, /selectedModelsError/)
      await f.change(f.modelField(id, key), key === 'contextWindow' ? '1000000' : '')
    }
    await f.change(f.modelField(id, 'maxTokens'), '2000000')
    await f.click(f.modelExpand(id))
    await f.click(f.button('discover'))
    await f.change(f.container.querySelector('input[type=search]'), 'new')
    await f.click(f.model('gemini-new'))
    assert.equal(f.button('save').disabled, true, 'invalid selected model remains invalid offscreen')
    assert.match(f.container.textContent, /selectedModelsError.*Saved Flash/)
    await f.change(f.container.querySelector('input[type=search]'), '')
    await f.click(f.model(id))
    assert.equal(f.button('save').disabled, false, 'an invalid unselected model is not persisted')
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.models.map(model => model.id), ['gemini-new'])
  })

  test('thinking presets require unique IDs and valid values, and clearing presets removes only visible overrides', async t => {
    const state = snapshot(), id = 'gemini-3.8-flash'
    state.profiles[0].models[0].advanced = { reasoning: [{ id: 'low', name: 'Low', thinkingBudget: 1024 }, { id: 'high', name: 'High', thinkingBudget: 8192 }],
      defaultReasoning: 'low', thinkingConfig: { includeThoughts: false, thinkingLevel: 'HIGH' } }
    const f = await mount(t, { snapshot: state })
    await f.click(f.modelExpand(id))
    let rows = f.modelPanel(id).querySelectorAll('[data-google-model-effort]')
    await f.change(rows[1].querySelector('[data-google-effort-field=id]'), 'low')
    assert.equal(f.button('save').disabled, true)
    await f.change(rows[1].querySelector('[data-google-effort-field=id]'), 'high')
    await f.change(rows[0].querySelector('[data-google-effort-field=value]'), '-2')
    assert.equal(f.button('save').disabled, true)
    await f.change(rows[0].querySelector('[data-google-effort-field=value]'), '0')
    assert.equal(f.button('save').disabled, false)
    await f.change(f.modelField(id, 'thinkingFormat'), 'inherit')
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.models[0].advanced, {
      reasoning: null, defaultReasoning: null, thinkingConfig: { thinkingLevel: null },
    })
  })

  test('invalid discovered limits block Save immediately after selection, before the advanced editor is opened', async t => {
    const id = 'gateway/invalid-capacity'
    const f = await mount(t, { discover: async () => ({ models: [{ id, contextWindow: 8192, maxTokens: 8192 }] }) })
    await f.click(f.button('discover'))
    await f.click(f.model(id))
    assert.equal(f.button('save').disabled, true)
    assert.match(f.container.textContent, /selectedModelsError.*gateway\/invalid-capacity/)
    await f.click(f.modelExpand(id))
    await f.change(f.modelField(id, 'maxTokens'), '4096')
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.models.find(model => model.id === id).advanced, { maxTokens: 4096 }, 'fixing invalid upstream metadata still sends only the edited field')
  })

  test('clearing model limits and timeout emits explicit removals and type declarations remain valid', async t => {
    const state = snapshot(), id = 'gemini-3.8-flash'
    state.profiles[0].models[0].advanced = { contextWindow: 1000000, maxTokens: 8192, requestTimeoutMs: 60000,
      inputTypes: ['text', 'image'], responseModalities: ['TEXT'] }
    const f = await mount(t, { snapshot: state })
    await f.click(f.modelExpand(id))
    assert.equal(f.modelPanel(id).querySelector('[data-google-model-input=text]').disabled, true)
    await f.click(f.modelPanel(id).querySelector('[data-google-model-output=TEXT]'))
    assert.equal(f.button('save').disabled, true, 'custom output types require at least one modality')
    await f.change(f.modelField(id, 'outputMode'), 'inherit')
    await f.change(f.modelField(id, 'inputMode'), 'inherit')
    await f.change(f.modelField(id, 'contextWindow'), '')
    await f.change(f.modelField(id, 'maxTokens'), '')
    await f.change(f.modelField(id, 'timeoutSeconds'), '')
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.models[0].advanced, {
      contextWindow: null, maxTokens: null, requestTimeoutMs: null, inputTypes: null, responseModalities: null,
    })
  })

  test('per-preset thinking-summary overrides remain visible and can inherit the model summary switch', async t => {
    const state = snapshot(), id = 'gemini-3.8-flash'
    state.profiles[0].models[0].advanced = { reasoning: [{ id: 'low', name: 'Low', thinkingLevel: 'LOW', includeThoughts: false }],
      thinkingConfig: { includeThoughts: true } }
    const f = await mount(t, { snapshot: state })
    await f.click(f.modelExpand(id))
    const override = f.modelPanel(id).querySelector('[data-google-effort-field=includeThoughts]')
    assert.equal(f.modelField(id, 'includeThoughts').value, 'on')
    assert.equal(override.value, 'off', 'the preset override is not hidden behind the model summary control')
    await f.change(override, 'inherit')
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.models[0].advanced, { reasoning: [{ id: 'low', name: 'Low', thinkingLevel: 'LOW' }] })
  })

  test('failed discovery retains existing models and supports manual model IDs without exposing upstream errors', async t => {
    const f = await mount(t, { discover: async () => { throw new Error('secret-key-in-upstream-error') } })
    await f.click(f.button('discover'))
    assert.match(f.container.textContent, /discoverError/)
    assert.equal(f.container.textContent.includes('secret-key-in-upstream-error'), false)
    assert.equal(f.model('gemini-3.8-flash').checked, true)
    const manual = f.container.querySelector('input[aria-label=manual]')
    await f.change(manual, 'gateway/custom-model')
    await f.click(f.button('add'))
    await f.click(f.button('save'))
    assert.deepEqual(f.saves[0].request.models.map(model => model.id), ['gemini-3.8-flash', 'gateway/custom-model'])
    assert.equal('apiKey' in f.saves[0].request, false, 'blank key keeps the existing credential')
  })

  test('changing a card route aborts discovery and late results cannot replace the new provider', async t => {
    const pending = deferred()
    const f = await mount(t, { discover: () => pending.promise })
    await f.click(f.modelExpand('gemini-3.8-flash'))
    await f.change(f.field('baseURL'), 'https://unsaved-studio.example')
    await f.click(f.button('discover'))
    assert.equal(f.field('baseURL').disabled, true)
    assert.equal(f.field('requestTimeoutSeconds').disabled, true)
    assert.equal(f.modelField('gemini-3.8-flash', 'contextWindow').disabled, true)
    await f.route(vertex)
    assert.equal(f.discoveries[0].signal.aborted, true)
    assert.equal(f.field('project').value, 'cloud-project')
    await f.flush(() => pending.resolve({ models: [{ id: 'late-model' }] }))
    assert.equal(f.model('late-model') === undefined, true)
    assert.ok(f.model('gemini-4-argon'))
  })

  test('Vertex auth mode switches ADC fields and API key fields without mutating the other profile', async t => {
    const f = await mount(t, { provider: vertex })
    assert.equal(f.field('project').value, 'cloud-project')
    assert.equal(f.field('apiKey') === null, true)
    await f.change(f.field('vertexAuth'), 'api-key')
    assert.equal(f.field('project') === null, true)
    assert.ok(f.field('apiKey'))
    await f.change(f.field('baseURL'), 'https://vertex-gateway.example')
    await f.click(f.button('save'))
    assert.equal(f.saves[0].request.provider, vertex)
    assert.equal(f.saves[0].request.connection.vertexAuth, 'api-key')
    const other = await mount(t)
    assert.equal(other.field('baseURL').value, 'https://saved.example/gemini')
  })

  test('separate Models-page provider cards retain drafts when collapsed and never show cross-provider tabs', async t => {
    const first = await mount(t)
    const second = await mount(t, { provider: vertex })
    await first.change(first.field('baseURL'), 'https://studio-draft.example')
    await second.change(second.field('project'), 'vertex-draft-project')
    await first.click(first.modelExpand('gemini-3.8-flash'))
    await first.change(first.modelField('gemini-3.8-flash', 'maxTokens'), '8192')
    await second.click(second.modelExpand('gemini-4-argon'))
    await second.change(second.modelField('gemini-4-argon', 'contextWindow'), '2000000')
    await first.click(first.button('closeConfiguration'))
    await first.click(first.button('configure'))
    assert.equal(first.field('baseURL').value, 'https://studio-draft.example')
    assert.equal(first.modelField('gemini-3.8-flash', 'maxTokens').value, '8192')
    assert.equal(second.field('project').value, 'vertex-draft-project')
    assert.equal(first.container.querySelector('[role=tablist]'), null)
    assert.equal(second.container.querySelector('[role=tablist]'), null)
    assert.equal(first.reads.length, 1)
    await second.click(second.button('save'))
    assert.equal(second.saves[0].request.provider, vertex)
    assert.deepEqual(second.saves[0].request.models[0].advanced, { contextWindow: 2000000 })
    assert.equal(first.saves.length, 0)
  })

  test('read-only settings expose values and upstream discovery but prohibit all writes', async t => {
    const f = await mount(t, { snapshot: snapshot({ writable: false }) })
    assert.equal(f.field('baseURL').disabled, true)
    assert.equal(f.field('requestTimeoutSeconds').disabled, true)
    assert.equal(f.field('apiKey').disabled, true)
    assert.equal(f.model('gemini-3.8-flash').disabled, true)
    assert.equal(f.button('save').disabled, true)
    assert.equal(f.button('discover').disabled, false)
    await f.click(f.modelExpand('gemini-3.8-flash'))
    assert.ok(f.modelField('gemini-3.8-flash', 'contextWindow'), 'read-only users can inspect advanced settings')
    assert.equal(f.modelField('gemini-3.8-flash', 'contextWindow').disabled, true)
    assert.equal(f.modelField('gemini-3.8-flash', 'thinkingFormat').disabled, true)
    await f.click(f.button('save'))
    assert.equal(f.saves.length, 0)
  })

  test('failed saves keep drafts and allow explicit reload instead of silently overwriting concurrent changes', async t => {
    const f = await mount(t, { save: async () => { throw new Error('conflict') } })
    await f.change(f.field('baseURL'), 'https://new.example')
    await f.click(f.button('save'))
    assert.match(f.container.textContent, /saveError/)
    assert.equal(f.field('baseURL').value, 'https://new.example')
    await f.click(f.button('retry'))
    assert.equal(f.reads.length, 2)
    assert.equal(f.field('baseURL').value, 'https://saved.example/gemini')
  })

  test('a partial credential failure keeps the entered key and refreshes revision before an explicit retry', async t => {
    let state = snapshot()
    let attempts = 0
    const f = await mount(t, { read: async () => state, save: async request => {
      attempts++
      state = { ...state, revision: state.revision + 1, profiles: state.profiles.map(profile => profile.provider === request.provider ? { ...profile, connection: request.connection, models: request.models } : profile) }
      if (attempts === 1) throw Object.assign(new Error('not-displayed'), { code: 'native-google/credential-save-failed', revision: state.revision })
      return state
    } })
    await f.change(f.field('baseURL'), 'https://saved-despite-key-failure.example')
    await f.change(f.field('apiKey'), 'retry-only-test-key')
    await f.click(f.button('save'))
    assert.match(f.container.textContent, /credentialError/)
    assert.equal(f.container.textContent.includes('not-displayed'), false)
    assert.equal(f.field('apiKey').value, 'retry-only-test-key')
    assert.equal(f.reads.length, 2)
    await f.click(f.button('save'))
    assert.equal(f.saves[1].request.expectedRevision, 4)
    assert.equal(f.saves[1].request.apiKey, 'retry-only-test-key')
    assert.equal(f.field('apiKey').value, '')
  })

  test('actual rc.5 ModelsSection and SlotRegistry mount each Google provider form and save through the real host profile', async t => {
    const modelId = 'gemini-3.8-flash'
    const host = await realSettingsProfile(t, { config: { aiStudio: { models: [{ id: modelId, name: 'Fixture Flash',
      contextWindow: 1048576, maxTokens: 8192, inputTypes: ['text', 'image', 'pdf'],
      reasoning: [{ id: 'balanced', name: 'Balanced', thinkingLevel: 'MEDIUM' }], defaultReasoning: 'balanced',
      generationConfig: { temperature: 0.4, responseModalities: ['UNEXPOSED_FUTURE_MODALITY'],
        thinkingConfig: { includeThoughts: false, thinkingLevel: 'HIGH' },
        httpOptions: { timeout: 1234, headers: { 'X-Private': 'private-test-value' } } },
    }] } } })
    // A route without the Google card marker must retain the host editor,
    // even when it shares the adapter's settings namespace.
    host.ctx.llm.registerConfigurableProviders([{ provider: 'control-provider', displayName: 'Control provider',
      settingsNs: 'dsh-google-native', settingsPath: ['aiStudio'] }])
    new TypertGatewayService(host.ctx, {})
    new HostConnectionService(host.ctx, [], {})
    const peer = host.ctx.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' })
    const client = new Context()
    // Disposing the rendered client first releases all React subscriptions.
    let unmount
    const container = document.createElement('div')
    document.body.appendChild(container)
    t.after(async () => { await React.act(async () => unmount?.()); await client.fiber.dispose(); container.remove() })
    const jsxRuntime = await import('react/jsx-runtime')
    const ReactDOM = await import('react-dom')
    const ReactDOMClient = await import('react-dom/client')
    const { z } = await import('zod')
    const seeded = { react: React, 'react/jsx-runtime': jsxRuntime, 'react-dom': ReactDOM, 'react-dom/client': ReactDOMClient,
      '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-ui-slots': slotCore,
      '@deepseek-ai/dsh-client-store': clientStore, zod: { z },
      // Cosmetic primitives are outside this test; ModelsSection, SlotCore,
      // the renderer, compiled plugin, browser helpers and Host are real.
      '@deepseek-ai/dsh-client-ui-primitives': new Proxy({}, { get: (_target, key) =>
        ({ children, onClick, disabled, type, open }) => key === 'Modal' && !open ? null
          : React.createElement(key === 'Button' ? 'button' : 'span', key === 'Button' ? { onClick, disabled, type } : {}, children) }),
    }
    async function browserModule(path) {
      let record
      const previous = window.__ModuleLoader__
      window.__ModuleLoader__ = { load: value => { record = value } }
      try { runInThisContext(await readFile(path, 'utf8')) }
      finally { window.__ModuleLoader__ = previous }
      assert.ok(record)
      return record.factory(specifier => {
        assert.ok(Object.hasOwn(seeded, specifier), `unseeded browser dependency ${specifier}`)
        return seeded[specifier]
      })
    }
    const root = new URL('../node_modules/@deepseek-ai/', import.meta.url)
    const renderer = await browserModule(new URL('dsh-client-ui-renderer/lib/client.js', root))
    renderer.apply(client)
    const dictionaries = new Map()
    const revision = { revision: 0 }
    const locale = {
      register(ns, language, dictionary) {
        if (typeof language !== 'string' || language === 'en') dictionaries.set(ns, typeof language === 'string' ? dictionary : language.en)
        return () => {}
      },
      bind: ns => key => dictionaries.get(ns)?.[key] ?? key,
      getSnapshot: () => revision, subscribe: () => () => {},
    }
    client.provide('locale', locale)
    client.slots.installLocale(locale)
    const allowed = clientStore.createSnapshotStore(true)
    client.slots.provideRoot({ keyedHooks: { remoteAccess: () => allowed } })
    const absentSession = clientStore.createSnapshotStore({ key: undefined, hooks: {}, keyedHooks: {}, props: {} })
    client.slots.installScope('session', { current: absentSession, bindingSource: () => absentSession, renderArea: () => null })
    client.slots.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
    } }, ({ renderSlot }) => renderSlot('settings.section', {}, { only: 'models' }))
    const mirror = { ensure: async () => {}, getSnapshot: () => ({ view: {
      writable: host.ctx.settings.writable, namespaces: host.ctx.settings.describe({ redactSecrets: true }),
    }, error: null }) }
    client.provide('configForms', { describe: () => mirror, get: () => ({}) })
    const getPath = (value, path) => path.reduce((current, key) => current?.[key], value)
    client.provide('settingsSchema', { getPath, hasPath: (value, path) => getPath(value, path) !== undefined,
      rehydrate: value => value, nodeAtPath: () => ({}) })
    const calls = []
    const saveFinished = Promise.withResolvers()
    const handler = host.ctx.connection.createSharedFetchHandler('/api')
    installConnection(client, { interactions: 'none', transport: {
      async fetch(url, init) {
        const request = new Request(new URL(url, 'https://dsh.test/'), init)
        const body = await request.clone().json()
        calls.push({ method: new URL(request.url).pathname.split('/').at(-1), request: body.payload.args.request })
        const response = await handler.fetch(request, peer)
        if (new URL(request.url).pathname.endsWith('/save')) saveFinished.resolve()
        return response
      },
      openStream() { throw new Error('provider settings must use unary calls') },
    } })
    new TypertRegistry(client)
    installRemote(client)
    const pageRemote = {
      $on: () => () => {},
      llm: { listProviders: async () => ({ ok: true, value: host.ctx.llm.listProviders() }),
        listConfigurableProviders: async () => ({ ok: true, value: host.ctx.llm.listConfigurableProviders() }) },
      credentials: { describe: async refs => ({ ok: true, value: Object.fromEntries(await Promise.all(refs.map(async ref => [ref, await host.ctx.credentials.describe(ref)]))) }) },
    }
    for (const name of ['conversation', 'modelDirectories', 'sessions']) client.provide(name, {})
    const models = await browserModule(new URL('dsh-client-ui-settings-models/lib/client.js', root))
    models.apply({ remote: pageRemote, slots: client.slots, locale,
      configForms: client.configForms, settingsSchema: client.settingsSchema,
      effect: client.effect.bind(client), on: client.on.bind(client), get: client.get.bind(client) })
    const plugin = await browserModule(new URL('../lib/client.js', import.meta.url))
    const pluginFiber = await client.plugin(plugin)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(client.slots.entries('settings.models.provider-card').length, 1)
    assert.equal(client.slots.entries('settings.models.provider-card')[0].options.key, 'dsh-google-native')
    assert.equal(client.slots.entries('plugins.bundle.config').length, 0)
    await React.act(async () => { unmount = client.uiRenderer.mount(container) })
    const cards = [...container.querySelectorAll('[data-google-provider-card]')]
    assert.deepEqual(cards.map(card => card.dataset.googleProviderCard).sort(), [studio, vertex].sort())
    assert.equal(calls.length, 0, 'unopened provider rows do not read private settings')
    const studioCard = cards.find(card => card.dataset.googleProviderCard === studio)
    const vertexCard = cards.find(card => card.dataset.googleProviderCard === vertex)
    const googleRows = cards.map(card => card.closest('li'))
    const hostEdit = row => row.querySelector('.zGbnIq_rowHead > .zGbnIq_rowActions > button:first-child')
    for (const card of cards) {
      const row = card.closest('li')
      const edit = hostEdit(row)
      assert.ok(edit, 'the real rc.5 provider row owns an Edit button')
      assert.equal(dom.window.getComputedStyle(edit).display, 'none', 'Google cards hide the unsupported host Edit action')
      // Programmatic clicks can still open an action hidden by CSS, as can a
      // draft that was already open when the plugin style was loaded.
      await React.act(async () => edit.click())
      const fallback = row.querySelector(':scope > .zGbnIq_editor')
      assert.ok(fallback, 'the actual host editor was opened')
      assert.equal(dom.window.getComputedStyle(fallback).display, 'none', 'the empty YAML fallback also stays hidden')
      assert.notEqual(dom.window.getComputedStyle(card.querySelector('button')).display, 'none', 'Configure remains available')
    }
    await React.act(async () => vertexCard.querySelector('button').click())
    assert.ok(vertexCard.querySelector('[data-google-setting=project]'), 'Vertex Configure opens its actual form')
    await React.act(async () => vertexCard.querySelector('button').click())
    const controlEdit = container.querySelector('button[aria-label="Edit Control provider (control-provider)"]')
    assert.ok(controlEdit)
    assert.notEqual(dom.window.getComputedStyle(controlEdit).display, 'none', 'other providers retain their Edit action')
    await React.act(async () => controlEdit.click())
    const controlEditor = controlEdit.closest('li').querySelector(':scope > .zGbnIq_editor')
    assert.ok(controlEditor, 'another provider can still open its host editor')
    assert.notEqual(dom.window.getComputedStyle(controlEditor).display, 'none', 'another provider editor remains visible')
    await React.act(async () => studioCard.querySelector('button').click())
    const endpoint = studioCard.querySelector('[data-google-setting=baseURL]')
    const timeout = studioCard.querySelector('[data-google-setting=requestTimeoutSeconds]')
    assert.ok(endpoint, 'clicking Configure inside the real provider row opens its actual form')
    assert.ok(timeout, 'timeout configuration is part of the actual Models-page provider form')
    assert.equal(timeout.value, '0')
    assert.equal(vertexCard.querySelector('.dsh-google-provider-card-panel').hidden, true)
    assert.equal(studioCard.querySelector('[role=tablist]'), null)
    await React.act(async () => studioCard.querySelector('[data-google-model-expand]').click())
    const modelPanel = studioCard.querySelector('[data-google-model-advanced]')
    const modelField = key => modelPanel.querySelector(`[data-google-model-setting="${key}"]`)
    assert.equal(modelField('contextWindow').value, '1048576')
    assert.equal(modelField('timeoutSeconds').value, '1.234')
    assert.equal(modelField('outputMode').value, 'inherit', 'unknown native output values are not exposed or rewritten')
    assert.equal(studioCard.textContent.includes('private-test-value'), false)
    const changeField = async (field, value) => React.act(async () => {
      const prototype = field.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value)
      Simulate.change(field)
    })
    await changeField(modelField('contextWindow'), '2000000')
    await changeField(modelField('maxTokens'), '16384')
    await changeField(modelField('timeoutSeconds'), '120.125')
    await changeField(modelField('thinkingFormat'), 'budget')
    await changeField(modelPanel.querySelector('[data-google-effort-field=value]'), '2048')
    await changeField(modelField('includeThoughts'), 'on')
    await React.act(async () => modelPanel.querySelector('[data-google-model-input=video]').click())
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(endpoint, 'https://models-page.example/google/v1beta')
      Simulate.change(endpoint)
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(timeout, '600.001')
      Simulate.change(timeout)
    })
    const save = [...studioCard.querySelectorAll('button')].find(button => button.textContent === 'Save provider settings')
    assert.ok(save)
    await React.act(async () => { save.click(); await saveFinished.promise })
    assert.equal(calls.at(-1).method, 'save')
    assert.equal(calls.at(-1).request.provider, studio)
    assert.equal(calls.at(-1).request.connection.requestTimeoutMs, 600001)
    assert.deepEqual(calls.at(-1).request.models[0].advanced, { contextWindow: 2000000, maxTokens: 16384,
      inputTypes: ['text', 'image', 'video', 'pdf'], requestTimeoutMs: 120125,
      reasoning: [{ id: 'balanced', name: 'Balanced', thinkingBudget: 2048 }],
      thinkingConfig: { includeThoughts: true, thinkingBudget: -1, thinkingLevel: null } })
    const saved = await host.ctx.nativeGoogleSettings.get({}, new AbortController().signal)
    assert.equal(saved.profiles.find(profile => profile.provider === studio).connection.baseURL, endpoint.value)
    assert.equal(saved.profiles.find(profile => profile.provider === studio).connection.requestTimeoutMs, 600001)
    const entry = host.ctx.configEditor.entries().find(item => item.options.id === 'dsh-google-native')
    assert.equal(entry.fiber.config.aiStudio.get().generationConfig.httpOptions.timeout, 600001)
    const modelConfig = entry.fiber.config.aiStudio.get().models.find(model => model.id === modelId)
    assert.equal(modelConfig.contextWindow, 2000000)
    assert.equal(modelConfig.maxTokens, 16384)
    assert.deepEqual(modelConfig.inputTypes, ['text', 'image', 'video', 'pdf'])
    assert.equal(modelConfig.defaultReasoning, 'balanced')
    assert.deepEqual(modelConfig.reasoning, [{ id: 'balanced', name: 'Balanced', thinkingBudget: 2048 }])
    assert.equal(modelConfig.generationConfig.httpOptions.timeout, 120125)
    assert.deepEqual(modelConfig.generationConfig.httpOptions.headers, { 'X-Private': 'private-test-value' })
    assert.equal(modelConfig.generationConfig.temperature, 0.4)
    assert.deepEqual(modelConfig.generationConfig.responseModalities, ['UNEXPOSED_FUTURE_MODALITY'])
    assert.deepEqual(modelConfig.generationConfig.thinkingConfig, { includeThoughts: true, thinkingBudget: -1 })
    const persisted = await readFile(new URL(`file://${host.dir}/cordis.patch.yml`), 'utf8')
    assert.match(persisted, /contextWindow: 2000000/)
    assert.match(persisted, /thinkingBudget: 2048/)
    assert.equal(modelField('contextWindow').value, '2000000', 'the form reloads accepted safe model values after Save')
    assert.equal(modelField('timeoutSeconds').value, '120.125')
    assert.equal(saved.profiles.find(profile => profile.provider === vertex).connection.baseURL, undefined)
    assert.equal(saved.profiles.find(profile => profile.provider === vertex).connection.requestTimeoutMs, undefined)
    assert.ok(document.querySelector('style[data-plugin="dsh-google-native"]'))
    await React.act(async () => { await pluginFiber.dispose() })
    assert.equal(document.querySelector('style[data-plugin="dsh-google-native"]'), null, 'plugin disposal removes its scoped compatibility styles')
    for (const row of googleRows) {
      const edit = hostEdit(row)
      assert.notEqual(dom.window.getComputedStyle(edit).display, 'none', 'disposing the plugin restores the host action')
    }
  })
})
