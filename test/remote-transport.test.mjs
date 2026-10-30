import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { apply as installRemote } from '@deepseek-ai/dsh-api-gateway/client'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { z } from 'zod'
import { defaultProfile } from '../lib/config.js'
import { registerGoogleProviderSettings } from '../lib/provider-settings.js'
import { registerGoogleChatControls } from '../lib/chat-controls.js'

test('minified browser settings use actual rc.5 Remote namespaces and HTTP request/response envelopes', async t => {
  const host = new Context()
  const client = new Context()
  t.after(async () => { await client.fiber.dispose(); await host.fiber.dispose() })
  new TypertRegistry(host)
  new TypertRegistry(client)
  // This test owns its in-process Peer. Authentication has already admitted it,
  // as it does before the shared HTTP Fetch handler in the running web app.
  new HostConnectionService(host, [], {})
  const peer = host.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' })
  host.provide('remoteAccess', { decide: () => { throw new Error('owner must bypass policy') } })
  new TypertGatewayService(host, {})
  const profiles = Object.fromEntries(['google-ai-studio', 'google-vertex-native'].map(id => [id, defaultProfile(id)]))
  let revision = 4
  const writes = []
  host.provide('settings', {
    writable: true,
    describe: () => [{ ns: 'dsh-google-native', revision }],
    async mutate(ns, operations, expectedRevision) {
      assert.equal(ns, 'dsh-google-native')
      assert.equal(expectedRevision, revision)
      for (const op of operations) {
        const target = profiles[op.path[0] === 'aiStudio' ? 'google-ai-studio' : 'google-vertex-native']
        target[op.path[1]] = structuredClone(op.value)
      }
      revision++
    },
  })
  host.provide('credentials', {
    describe: async () => ({ configured: false, writable: true }),
    resolve: async () => { throw new Error('transient key must avoid reading the credential') },
    set: async (ref, value) => { writes.push({ ref, value }) },
  })
  const discoveries = []
  registerGoogleProviderSettings(host, {
    settingsNs: 'dsh-google-native', profiles: () => profiles,
    async discover(profile, key) {
      discoveries.push({ profile, key })
      return [{ id: 'gemini-wire-model', name: 'Wire model' }]
    },
  })
  new SessionStore(host)
  new SessionProjectionRegistry(host)
  const session = host.sessions.create(SessionId('google-browser-transport'))
  const agent = { id: session.id, session, status: 'idle', inbox: { replace() { return false } } }
  host.provide('sessionController', {
    async resolveAgent(id) { assert.equal(id, session.id); return { agent } },
    async inspect() { throw new Error('this session is already live') },
  })
  registerGoogleChatControls(host, () => profiles)
  const requests = []
  const handler = host.connection.createSharedFetchHandler('/api')
  installConnection(client, { interactions: 'none', transport: {
    async fetch(url, init) {
      const request = new Request(new URL(url, 'http://localhost/'), init)
      requests.push({ pathname: new URL(request.url).pathname, body: await request.clone().json() })
      return handler.fetch(request, peer)
    },
    // Unary calls exercise actual JSON framing; no stream/socket is needed.
    openStream() { throw new Error('settings must not open a stream') },
  } })
  installRemote(client)
  const records = []
  const styles = []
  runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: value => records.push(value) } },
    document: {
      createElement() { return { dataset: {}, remove() {} } },
      head: { appendChild: value => styles.push(value) },
    },
  })
  const seeded = { react: React, 'react/jsx-runtime': jsxRuntime, 'react-dom': ReactDOM, zod: { z } }
  const plugin = records[0].factory(specifier => {
    assert.ok(Object.hasOwn(seeded, specifier), `unexpected browser runtime dependency ${specifier}`)
    return seeded[specifier]
  })
  const registrations = []
  client.provide('slots', { inject: (_name, factory) => factory(), register: (options, component) => {
    registrations.push({ options, component }); return () => {}
  } })
  client.provide('locale', { register: () => () => {} })
  client.provide('conversation', {})
  client.provide('modelDirectories', { directoryFor: () => ({ store: {}, load: async () => {} }) })
  client.provide('sessions', { subagentAddress: () => undefined })
  await client.plugin(plugin)
  const registration = registrations.find(({ options }) => options.name === 'settings.models.provider-card')
  assert.ok(registration, 'compiled client registers its settings entry')
  const face = registration.options.inject()
  const signal = new AbortController().signal
  const initial = await face.read(signal)
  assert.equal(initial.settingsNs, 'dsh-google-native')
  assert.equal(initial.revision, 4)
  assert.equal(initial.profiles.length, 2)
  assert.equal(writes.length, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body.payload)), { args: { request: {} } })
  assert.equal(requests[0].pathname, '/api/nativeGoogleSettings/get')
  assert.equal(requests[0].body.type, 'client-request')
  // Both namespaces are independent Cordis services. Declaring only `remote`
  // lets apply() succeed while reads from a real plugin fiber throw at runtime.
  const chatRegistration = registrations.find(({ options }) => options.name === 'conversation.input.left')
  const chat = chatRegistration.options.inject(session.id)
  const route = { provider: 'google-ai-studio', model: 'gemini-3.8-flash' }
  const chatInitial = await chat.read(route, signal)
  assert.equal(chatInitial.revision, 0)
  assert.equal(chatInitial.choices.nativeFiles, true)
  const chatSaved = await chat.save(route, { ...chatInitial.choices, search: true }, 0, signal)
  assert.equal(chatSaved.revision, 1)
  assert.equal(chatSaved.choices.search, true)
  const connection = { ...initial.profiles[0].connection, baseURL: 'https://draft.example/native/v1beta' }
  const found = await face.discover({ provider: 'google-ai-studio', connection, apiKey: 'transient-test-key' }, signal)
  assert.deepEqual(found.models.map(model => model.id), ['gemini-wire-model'])
  assert.equal(discoveries[0].profile.baseURL, connection.baseURL)
  assert.equal(discoveries[0].key, 'transient-test-key')
  assert.equal(writes.length, 0)
  const saved = await face.save({ provider: 'google-ai-studio', connection, models: found.models,
    apiKey: 'transient-test-key', expectedRevision: initial.revision }, signal)
  assert.equal(saved.revision, 5)
  assert.deepEqual(saved.profiles[0].models.map(model => model.id), ['gemini-wire-model'])
  assert.equal(writes.length, 1)
  assert.equal(requests.at(-1).pathname, '/api/nativeGoogleSettings/save')
  assert.equal(styles.length, 1)
})
