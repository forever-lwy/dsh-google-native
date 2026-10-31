import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Agent, getGlobalDispatcher } from 'undici'
import { googleFetch, withGoogleAbort } from '../lib/transport.js'
import { googleError } from '../lib/errors.js'
import { GoogleNativeAdapter } from '../lib/adapter.js'
import { defaultProfile } from '../lib/config.js'

const sse = text => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`
async function localServer(t, handler) {
  const timers = new Set()
  const later = (ms, callback) => {
    const timer = setTimeout(() => { timers.delete(timer); callback() }, ms)
    timers.add(timer)
  }
  const server = createServer((request, response) => {
    request.resume()
    handler(request, response, later)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return `http://127.0.0.1:${server.address().port}`
}

function timeoutCause(error) {
  for (let depth = 0; error && depth < 6; depth++, error = error.cause) {
    if (String(error.code ?? '').startsWith('UND_ERR_') && String(error.code).endsWith('_TIMEOUT')) return true
  }
  return false
}

for (const phase of ['headers', 'body']) {
  test(`Google transport preserves a configured dispatcher while removing its implicit ${phase} deadline`, async t => {
    const global = getGlobalDispatcher()
    const dispatcher = new Agent({ headersTimeout: 10, bodyTimeout: 10 })
    t.after(() => dispatcher.destroy())
    const url = await localServer(t, (request, response, later) => {
      if (request.url === '/native') assert.match(request.headers['user-agent'], /deepseek-harness/)
      const finish = () => { if (!response.destroyed) response.end('complete') }
      if (phase === 'body') {
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.flushHeaders()
        response.write('first:')
      }
      // Undici's fast timer has coarse ticks. This scaled down timeout is long
      // enough to really fire, without waiting for the default five minutes.
      later(1600, finish)
    })
    await assert.rejects(async () => {
      const response = await fetch(`${url}/ordinary`, { dispatcher })
      await response.text()
    }, timeoutCause, "ordinary requests retain this dispatcher's deadline")
    const response = await googleFetch(`${url}/native`, { dispatcher })
    assert.equal(await response.text(), phase === 'body' ? 'first:complete' : 'complete')
    assert.equal(getGlobalDispatcher(), global, 'Google must not change the process-wide dispatcher')
    // Delegating preserves the explicit dispatcher's pool. The wrapper never
    // replaces its connectivity/proxy behavior with a newly allocated Agent.
    const again = await fetch(`${url}/ordinary`, { dispatcher }).then(response => response.text()).catch(error => error)
    assert.ok(again instanceof Error && timeoutCause(again), 'the original dispatcher still has its own defaults')
  })
}

for (const provider of ['google-ai-studio', 'google-vertex-native']) {
  for (const phase of ['headers', 'body']) {
    test(`actual SDK ${provider} configured deadline aborts during ${phase} and returns TIMEOUT`, async t => {
      let firstChunk = false
      const url = await localServer(t, (_request, response, later) => {
        if (phase === 'body') {
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          response.flushHeaders()
          response.write(sse('first'))
        }
        later(2000, () => { if (!response.destroyed) response.end(sse('last')) })
      })
      const profiles = Object.fromEntries(['google-ai-studio', 'google-vertex-native'].map(id => [id, defaultProfile(id)]))
      profiles[provider].baseURL = url
      profiles[provider].vertexAuth = 'api-key'
      profiles[provider].generationConfig.httpOptions = { timeout: 200 }
      const adapter = new GoogleNativeAdapter({ attachments: {} }, { profiles: () => profiles, resolveApiKey: async () => 'offline-timeout-test' })
      await assert.rejects(async () => {
        for await (const chunk of adapter.stream({ provider, model: 'gemini-2.5-flash',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] })) {
          if (chunk.type === 'text-delta') firstChunk = true
        }
      }, error => error.code === 'TIMEOUT' && /模型请求超时/.test(error.message))
      if (phase === 'body') assert.equal(firstChunk, true, 'deadline stays active after streaming has begun')
    })
  }
}

test('caller and scoped upload cancellation still abort without a configured request deadline', async t => {
  const controller = new AbortController()
  t.after(() => controller.abort())
  const started = Promise.withResolvers()
  const url = await localServer(t, (_request, _response) => { started.resolve() })
  const scoped = AbortSignal.any([controller.signal, AbortSignal.timeout(2000)])
  const operation = withGoogleAbort(scoped, () => googleFetch(url))
  // A transport failure or a leaked fetch mock must fail promptly instead of
  // hanging forever while waiting for a local request that will never arrive.
  await Promise.race([started.promise, operation.then(async response => {
    await response.body?.cancel()
    throw new Error('The request completed before reaching the local test server')
  })])
  controller.abort()
  await assert.rejects(operation, error => googleError(error, controller.signal).code === 'ABORTED')
})

test('timeout classification is safe, cycle bounded, and cancellation takes precedence', () => {
  for (const error of [
    new DOMException('sensitive upstream text', 'AbortError'),
    new DOMException('sensitive upstream text', 'TimeoutError'),
    Object.assign(new Error('sensitive upstream text'), { status: 408 }),
    Object.assign(new Error('sensitive upstream text'), { status: 504 }),
    new Error('sensitive upstream text', { cause: Object.assign(new Error(), { code: 'UND_ERR_BODY_TIMEOUT' }) }),
  ]) {
    const classified = googleError(error)
    assert.equal(classified.code, 'TIMEOUT')
    assert.equal(classified.message.includes('sensitive upstream text'), false)
    const controller = new AbortController()
    controller.abort()
    assert.equal(googleError(error, controller.signal).code, 'ABORTED')
  }
  const cyclic = new Error('not a timeout')
  cyclic.cause = cyclic
  assert.equal(googleError(cyclic).code, 'NETWORK')
})
