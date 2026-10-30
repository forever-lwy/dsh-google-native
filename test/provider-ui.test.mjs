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

  test('changing a card route aborts discovery and late results cannot replace the new provider', async t => {
    const pending = deferred()
    const f = await mount(t, { discover: () => pending.promise })
    await f.change(f.field('baseURL'), 'https://unsaved-studio.example')
    await f.click(f.button('discover'))
    assert.equal(f.field('baseURL').disabled, true)
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
    await first.click(first.button('closeConfiguration'))
    await first.click(first.button('configure'))
    assert.equal(first.field('baseURL').value, 'https://studio-draft.example')
    assert.equal(second.field('project').value, 'vertex-draft-project')
    assert.equal(first.container.querySelector('[role=tablist]'), null)
    assert.equal(second.container.querySelector('[role=tablist]'), null)
    assert.equal(first.reads.length, 1)
    await second.click(second.button('save'))
    assert.equal(second.saves[0].request.provider, vertex)
    assert.equal(first.saves.length, 0)
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

  test('actual rc.5 ModelsSection and SlotRegistry mount each Google provider form and save through the real host profile', async t => {
    const host = await realSettingsProfile(t)
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
    client.provide('settingsSchema', { getPath, hasPath: (value, path) => getPath(value, path) !== undefined })
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
    await client.plugin(plugin)
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
    await React.act(async () => studioCard.querySelector('button').click())
    const endpoint = studioCard.querySelector('[data-google-setting=baseURL]')
    assert.ok(endpoint, 'clicking Configure inside the real provider row opens its actual form')
    assert.equal(vertexCard.querySelector('[data-google-setting=baseURL]'), null)
    assert.equal(studioCard.querySelector('[role=tablist]'), null)
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(endpoint, 'https://models-page.example/google/v1beta')
      Simulate.change(endpoint)
    })
    const save = [...studioCard.querySelectorAll('button')].find(button => button.textContent === 'Save provider settings')
    assert.ok(save)
    await React.act(async () => { save.click(); await saveFinished.promise })
    assert.equal(calls.at(-1).method, 'save')
    assert.equal(calls.at(-1).request.provider, studio)
    const saved = await host.ctx.nativeGoogleSettings.get({}, new AbortController().signal)
    assert.equal(saved.profiles.find(profile => profile.provider === studio).connection.baseURL, endpoint.value)
    assert.equal(saved.profiles.find(profile => profile.provider === vertex).connection.baseURL, undefined)
  })
})
