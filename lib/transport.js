import { AsyncLocalStorage } from 'node:async_hooks';
import { attributionHeaders } from '@deepseek-ai/dsh-llm';
import { getGlobalDispatcher } from 'undici';
const operationSignal = new AsyncLocalStorage();
/** Retain the caller's connection/proxy pool while letting SDK deadlines own the request. */
function withoutImplicitTimeouts(dispatcher) {
    return {
        dispatch(options, handler) {
            return dispatcher.dispatch({ ...options, headersTimeout: 0, bodyTimeout: 0 }, handler);
        },
    };
}
/** SDK 2.32.0 drops UploadFileConfig.abortSignal; scope it across both HTTP upload stages. */
export function withGoogleAbort(signal, operation) {
    signal?.throwIfAborted();
    return operationSignal.run(signal, operation);
}
export const googleFetch = (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    for (const [name, value] of Object.entries(attributionHeaders()))
        headers.set(name, value);
    const signals = [operationSignal.getStore(), init?.signal, input instanceof Request ? input.signal : undefined]
        .filter((signal) => signal !== undefined && signal !== null);
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    // Google SDK skips its equivalent Node dispatcher when a custom fetch is
    // present. Restore that behavior locally: a long first response or a pause
    // in SSE must not be preempted by Undici's default 300-second timers.
    // Delegate to the existing dispatcher instead of changing the process-wide
    // dispatcher or allocating another pool. An explicit SDK timeout and the
    // caller's cancellation still reach fetch through the combined signal.
    const delegate = init?.dispatcher ?? getGlobalDispatcher();
    const requestInit = { ...init, headers, dispatcher: withoutImplicitTimeouts(delegate), ...(signal ? { signal } : {}) };
    return globalThis.fetch(input, requestInit);
};
