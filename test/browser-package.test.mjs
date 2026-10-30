import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { z } from 'zod'

test('actual rc.5 module registry serves the browser artifact and its lazy factory uses platform modules only', async t => {
  const root = new URL('../', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const ctx = new Context()
  ctx.baseUrl = root.href
  ctx.provide('loader', {
    entries: () => [{ options: { name: fileURLToPath(new URL('lib/index.js', root)) }, fiber: {}, disabled: false,
      parent: { tree: { ctx: { baseUrl: root.href } } } }],
  })
  t.after(() => ctx.fiber.dispose())
  const registry = new ClientModuleRegistry(ctx)
  const row = registry.graph().entries.find(entry => entry.id === manifest.name)
  assert.ok(row, 'rc.5 recognizes the dsh.client declaration')
  assert.deepEqual(row.inject, manifest.dsh.client.inject)
  assert.equal(registry.clientPath(manifest.name), fileURLToPath(new URL('lib/client.js', root)))
  const response = await registry.fetchBundle(new Request(new URL(row.url, 'https://dsh.test/')))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /javascript/)
  const records = []
  runInNewContext(await response.text(), { window: { __ModuleLoader__: { load: record => records.push(record) } } })
  assert.equal(records.length, 1)
  assert.equal(records[0].id, manifest.name)
  assert.equal(typeof records[0].factory, 'function')
  const seeded = { react: React, 'react/jsx-runtime': jsxRuntime, 'react-dom': ReactDOM, zod: { z } }
  const requests = []
  const plugin = records[0].factory(specifier => {
    requests.push(specifier)
    assert.ok(Object.hasOwn(seeded, specifier), `browser runtime request ${specifier} must be a host platform module`)
    return seeded[specifier]
  })
  assert.ok(requests.length > 0)
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(typeof plugin.NativeOptions, 'function')
  assert.ok(plugin.inject.includes('conversation'))
  assert.ok(plugin.inject.includes('modelDirectories'))
  assert.equal(plugin.nativeOptionsVisible({ provider: 'other', model: 'gemini-3.8-flash' }, undefined), false)
})
