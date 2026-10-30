import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { JSDOM } from 'jsdom'

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
    const props = { view: options.view ?? 'page', entryKey: 'dsh-google-native', t: key => key,
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
    t.after(async () => { await flush(() => root.unmount()); container.remove() })
    return { container, props, reads, discoveries, saves, flush,
      field: key => container.querySelector(`[data-google-setting="${key}"]`),
      model: id => [...container.querySelectorAll('[data-google-model]')].find(node => node.dataset.googleModel === id),
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

  test('summary never fetches settings, and read permission is enforced before any request', async t => {
    const summary = await mount(t, { view: 'summary' })
    assert.equal(summary.reads.length, 0)
    assert.match(summary.container.textContent, /summary/)
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

  test('switching provider aborts discovery and late results cannot replace the other provider draft', async t => {
    const pending = deferred()
    const f = await mount(t, { discover: () => pending.promise })
    await f.change(f.field('baseURL'), 'https://unsaved-studio.example')
    await f.click(f.button('discover'))
    assert.equal(f.field('baseURL').disabled, true)
    await f.click(f.button('vertex'))
    assert.equal(f.discoveries[0].signal.aborted, true)
    assert.equal(f.field('project').value, 'cloud-project')
    await f.flush(() => pending.resolve({ models: [{ id: 'late-model' }] }))
    assert.equal(f.model('late-model') === undefined, true)
    assert.ok(f.model('gemini-4-argon'))
    await f.click(f.button('aiStudio'))
    assert.equal(f.field('baseURL').value, 'https://unsaved-studio.example', 'switching tabs preserves unsaved drafts')
  })

  test('Vertex auth mode switches ADC fields and API key fields without mutating the other profile', async t => {
    const f = await mount(t)
    await f.click(f.button('vertex'))
    assert.equal(f.field('project').value, 'cloud-project')
    assert.equal(f.field('apiKey') === null, true)
    await f.change(f.field('vertexAuth'), 'api-key')
    assert.equal(f.field('project') === null, true)
    assert.ok(f.field('apiKey'))
    await f.change(f.field('baseURL'), 'https://vertex-gateway.example')
    await f.click(f.button('save'))
    assert.equal(f.saves[0].request.provider, vertex)
    assert.equal(f.saves[0].request.connection.vertexAuth, 'api-key')
    await f.click(f.button('aiStudio'))
    assert.equal(f.field('baseURL').value, 'https://saved.example/gemini')
  })

  test('read-only settings expose values and upstream discovery but prohibit all writes', async t => {
    const f = await mount(t, { snapshot: snapshot({ writable: false }) })
    assert.equal(f.field('baseURL').disabled, true)
    assert.equal(f.field('apiKey').disabled, true)
    assert.equal(f.model('gemini-3.8-flash').disabled, true)
    assert.equal(f.button('save').disabled, true)
    assert.equal(f.button('discover').disabled, false)
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
})
