import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveCapabilities } from '../lib/capabilities.js'
import { blockWhileSaving } from '../lib/client/save-block.js'

const google = { provider: 'google-ai-studio', model: 'gemini-3.8-flash' }
const other = { provider: 'deepseek-official', model: 'deepseek-chat' }
const choiceKeys = ['nativeFiles', 'search', 'urlContext', 'codeExecution', 'maps']
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function nativeState(route = google, extra = {}) {
  return { ...route, revision: 7,
    capabilities: resolveCapabilities(route.provider, { id: route.model }),
    choices: { nativeFiles: true, search: false, urlContext: false, codeExecution: false, maps: false }, ...extra }
}

function composerBlocks() {
  const stores = new Map()
  return {
    storeFor(sessionId) {
      if (!stores.has(sessionId)) stores.set(sessionId, createSnapshotStore(undefined))
      return stores.get(sessionId)
    },
    set(sessionId, block) { this.storeFor(sessionId).set(block) },
    forget(sessionId) { stores.delete(sessionId) },
  }
}

describe('Google native composer controls in an actual DOM', () => {
  let dom, React, createRoot, NativeOptions
  const originals = new Map()
  before(async () => {
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://dsh.test/' })
    for (const [key, value] of Object.entries({
      window: dom.window, document: dom.window.document, Node: dom.window.Node,
      HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    React = await import('react')
    ;({ createRoot } = await import('react-dom/client'))
    ;({ NativeOptions } = await import('../lib/client/NativeOptions.js'))
  })
  after(() => {
    dom.window.close()
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })

  async function mount(t, options = {}) {
    const directory = createSnapshotStore({ current: options.route ?? google, pending: null, routable: true,
      groups: [], failures: [], status: 'ready', error: null })
    const session = createSnapshotStore({ running: false, awaitingFirstTurn: false, pendingSubmissions: [] })
    const blocks = composerBlocks()
    const reads = [], saves = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const props = {
      available: options.available ?? true, directory,
      loadDirectory: () => {},
      read: (route, signal) => {
        reads.push({ route, signal })
        return options.read ? options.read(route, signal) : Promise.resolve(nativeState(route, options.state))
      },
      save: (route, choices, expectedRevision, signal) => {
        saves.push({ route, choices, expectedRevision, signal })
        return options.save ? options.save(route, choices, expectedRevision, signal)
          : Promise.resolve(nativeState(route, { choices, revision: expectedRevision + 1 }))
      },
      beginSave: reason => blockWhileSaving(blocks, 'session-a', reason),
      useSession: selector => React.useSyncExternalStore(session.subscribe, () => selector(session.getSnapshot())),
      useAccess: method => options.access?.[method] ?? true,
      t: key => key,
    }
    const render = async () => { await React.act(async () => root.render(React.createElement(NativeOptions, props))) }
    const flush = async fn => { await React.act(async () => { fn?.() }) }
    await render()
    t.after(async () => { await React.act(async () => root.unmount()); container.remove() })
    return { directory, session, blocks, reads, saves, props, render, flush,
      trigger: () => document.querySelector('[data-google-native-control]'),
      panel: () => document.querySelector('[data-google-native-panel]'),
      async open() {
        assert.ok(this.trigger(), 'native options trigger is visible')
        await flush(() => this.trigger().click())
        assert.ok(this.panel(), 'native options popover opened')
      },
      input(key) {
        const label = [...document.querySelectorAll('[data-google-native-panel] label')]
          .find(element => element.querySelector('span')?.firstChild?.textContent === key)
        return label?.querySelector('input')
      },
    }
  }

  test('renders file mode and model-supported tools, restoring host-saved choices', async t => {
    const fixture = await mount(t, { state: { choices: { nativeFiles: false, search: true, urlContext: false, codeExecution: false, maps: true } } })
    assert.equal(fixture.reads.length, 1)
    await fixture.open()
    assert.equal(document.querySelectorAll('[data-google-native-panel] input').length, 5)
    assert.equal(fixture.input('nativeFiles').checked, false)
    assert.equal(fixture.input('search').checked, true)
    assert.equal(fixture.input('maps').checked, true)
    assert.equal(fixture.panel().getAttribute('role'), 'dialog')
  })

  test('foreign providers, unknown unsupported models and unavailable sessions have no controls', async t => {
    const fixture = await mount(t, { route: other })
    assert.equal(fixture.trigger(), null)
    assert.equal(fixture.reads.length, 0, 'foreign providers never call Google controls RPC')
    await fixture.flush(() => fixture.directory.set({ ...fixture.directory.getSnapshot(), current: { ...google, model: 'custom-unknown' } }))
    assert.equal(fixture.trigger(), null)
    assert.equal(fixture.reads.length, 1)
    fixture.props.available = false
    await fixture.render()
    await fixture.flush(() => fixture.directory.set({ ...fixture.directory.getSnapshot(), current: google }))
    assert.equal(fixture.trigger(), null)
    assert.equal(fixture.reads.length, 1)
  })

  test('a model declaring a subset exposes only the corresponding checkbox', async t => {
    const route = { ...google, model: 'pdf-only-custom' }
    const capabilities = resolveCapabilities(route.provider, { id: route.model, capabilities: { nativeFiles: true } })
    const fixture = await mount(t, { route, state: { capabilities } })
    await fixture.open()
    assert.equal(document.querySelectorAll('[data-google-native-panel] input').length, 1)
    assert.ok(fixture.input('nativeFiles'))
    for (const key of choiceKeys.slice(1)) assert.equal(fixture.input(key), undefined)
  })

  test('read access is required before showing controls or invoking host reads', async t => {
    const fixture = await mount(t, { access: { 'nativeGoogleChat/get': false } })
    assert.equal(fixture.trigger(), null)
    assert.equal(fixture.reads.length, 0)
  })

  test('read-only access displays persisted settings but prevents write requests', async t => {
    const fixture = await mount(t, { access: { 'nativeGoogleChat/set': false } })
    await fixture.open()
    assert.equal(fixture.reads.length, 1)
    assert.ok([...document.querySelectorAll('[data-google-native-panel] input')].every(input => input.disabled))
    await fixture.flush(() => fixture.input('search').click())
    assert.equal(fixture.saves.length, 0)
  })

  test('switching models hides an open popover immediately and ignores late read results', async t => {
    const pending = deferred()
    const routeB = { ...google, model: 'gemini-4-argon' }
    const fixture = await mount(t, { read: route => route.model === routeB.model ? pending.promise : Promise.resolve(nativeState(route)) })
    await fixture.open()
    await fixture.flush(() => fixture.directory.set({ ...fixture.directory.getSnapshot(), pending: routeB, status: 'selecting' }))
    assert.equal(fixture.trigger(), null)
    assert.equal(fixture.panel(), null)
    const lastRead = fixture.reads.at(-1)
    await fixture.flush(() => fixture.directory.set({ ...fixture.directory.getSnapshot(), current: other, pending: null, status: 'ready' }))
    assert.equal(lastRead.signal.aborted, true)
    await fixture.flush(() => pending.resolve(nativeState(routeB)))
    assert.equal(fixture.trigger(), null)
    assert.equal(fixture.panel(), null)
  })

  test('checkbox saves exact route, choices and revision; Send stays blocked until host acknowledgement', async t => {
    const acknowledgement = deferred()
    const fixture = await mount(t, { save: () => acknowledgement.promise })
    await fixture.open()
    await fixture.flush(() => fixture.input('search').click())
    assert.equal(fixture.saves.length, 1)
    const saved = fixture.saves[0]
    assert.deepEqual(saved.route, google)
    assert.deepEqual(saved.choices, { nativeFiles: true, search: true, urlContext: false, codeExecution: false, maps: false })
    assert.equal(saved.expectedRevision, 7)
    assert.equal(saved.signal.aborted, false)
    assert.equal(fixture.blocks.storeFor('session-a').getSnapshot().reason, 'saving')
    assert.ok([...document.querySelectorAll('[data-google-native-panel] input')].every(input => input.disabled))
    assert.equal(fixture.input('search').checked, false, 'unacknowledged change is not presented as persisted')
    await fixture.flush(() => acknowledgement.resolve(nativeState(google, { choices: saved.choices, revision: 8 })))
    assert.equal(fixture.blocks.storeFor('session-a').getSnapshot(), undefined)
    assert.equal(fixture.input('search').checked, true)
    assert.equal(fixture.input('nativeFiles').disabled, false)
    await fixture.flush(() => fixture.input('maps').click())
    assert.equal(fixture.saves[1].expectedRevision, 8, 'later saves use acknowledged revision')
  })

  test('in-flight model switches cancel old saves and late responses cannot revive controls', async t => {
    const acknowledgement = deferred()
    const fixture = await mount(t, { save: () => acknowledgement.promise })
    await fixture.open()
    await fixture.flush(() => fixture.input('nativeFiles').click())
    const saved = fixture.saves[0]
    assert.ok(fixture.blocks.storeFor('session-a').getSnapshot())
    await fixture.flush(() => fixture.directory.set({ ...fixture.directory.getSnapshot(), current: other }))
    assert.equal(saved.signal.aborted, true)
    assert.equal(fixture.blocks.storeFor('session-a').getSnapshot(), undefined)
    await fixture.flush(() => acknowledgement.resolve(nativeState(google, { choices: saved.choices, revision: 8 })))
    assert.equal(fixture.trigger(), null)
    assert.equal(fixture.panel(), null)
  })

  test('running, awaiting and queued submissions prevent changes to native settings', async t => {
    const fixture = await mount(t)
    await fixture.open()
    for (const update of [{ running: true }, { awaitingFirstTurn: true }, { pendingSubmissions: [{ id: 'queued' }] }]) {
      await fixture.flush(() => fixture.session.set({ running: false, awaitingFirstTurn: false, pendingSubmissions: [], ...update }))
      assert.ok([...document.querySelectorAll('[data-google-native-panel] input')].every(input => input.disabled))
      await fixture.flush(() => fixture.input('search').click())
      assert.equal(fixture.saves.length, 0)
    }
    await fixture.flush(() => fixture.session.set({ running: false, awaitingFirstTurn: false, pendingSubmissions: [] }))
    assert.equal(fixture.input('search').disabled, false)
  })

  test('read failure offers retry and successful reload restores persisted controls', async t => {
    let attempts = 0
    const fixture = await mount(t, { read: route => ++attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(nativeState(route)) })
    await fixture.open()
    assert.ok(document.querySelector('[role=alert]'))
    const retry = [...fixture.panel().querySelectorAll('button')].find(button => button.textContent === 'retry')
    await fixture.flush(() => retry.click())
    assert.equal(attempts, 2)
    await fixture.open()
    assert.equal(document.querySelector('[role=alert]'), null)
    assert.equal(fixture.input('nativeFiles').checked, true)
  })

  test('save failure releases its block and shows persisted choices with a retry affordance', async t => {
    const response = deferred()
    const fixture = await mount(t, { save: () => response.promise })
    await fixture.open()
    await fixture.flush(() => fixture.input('search').click())
    await fixture.flush(() => response.reject(new Error('revision conflict')))
    assert.equal(fixture.blocks.storeFor('session-a').getSnapshot(), undefined)
    assert.equal(fixture.input('search').checked, false)
    assert.equal(fixture.input('search').disabled, false)
    assert.ok(document.querySelector('[role=alert]'))
    assert.ok([...fixture.panel().querySelectorAll('button')].some(button => button.textContent === 'retry'))
  })

  test('Escape closes the portal and returns keyboard focus to its trigger', async t => {
    const fixture = await mount(t)
    await fixture.open()
    assert.equal(document.activeElement, fixture.input('nativeFiles'))
    await fixture.flush(() => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(fixture.panel(), null)
    assert.equal(document.activeElement, fixture.trigger())
  })
})

test('saving never removes another plugin composer block and resumes ownership when it disappears', () => {
  const blocks = composerBlocks()
  const other = { reason: 'another plugin is selecting a model' }
  blocks.set('session-a', other)
  const release = blockWhileSaving(blocks, 'session-a', 'saving native options')
  const store = blocks.storeFor('session-a')
  assert.equal(store.getSnapshot(), other)
  blocks.set('session-a', undefined)
  assert.equal(store.getSnapshot().reason, 'saving native options')
  blocks.set('session-a', other)
  release()
  assert.equal(store.getSnapshot(), other)
  blocks.set('session-a', undefined)
  assert.equal(store.getSnapshot(), undefined, 'released observer cannot raise another block')
})

test('overlapping save blockers transfer ownership without releasing the other request', () => {
  const blocks = composerBlocks()
  const first = blockWhileSaving(blocks, 'session-a', 'first save')
  const second = blockWhileSaving(blocks, 'session-a', 'second save')
  assert.equal(blocks.storeFor('session-a').getSnapshot().reason, 'first save')
  first()
  assert.equal(blocks.storeFor('session-a').getSnapshot().reason, 'second save')
  first()
  assert.equal(blocks.storeFor('session-a').getSnapshot().reason, 'second save')
  second()
  assert.equal(blocks.storeFor('session-a').getSnapshot(), undefined)
})
