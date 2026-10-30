import { AsyncLocalStorage } from 'node:async_hooks'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'

const operationSignal = new AsyncLocalStorage<AbortSignal | undefined>()

/** SDK 2.32.0 drops UploadFileConfig.abortSignal; scope it across both HTTP upload stages. */
export function withGoogleAbort<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted()
  return operationSignal.run(signal, operation)
}

export const googleFetch: typeof globalThis.fetch = (input, init) => {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value))
  for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
  const signals = [operationSignal.getStore(), init?.signal, input instanceof Request ? input.signal : undefined]
    .filter((signal): signal is AbortSignal => signal !== undefined && signal !== null)
  const signal = signals.length ? AbortSignal.any(signals) : undefined
  return globalThis.fetch(input, { ...init, headers, ...(signal ? { signal } : {}) })
}
