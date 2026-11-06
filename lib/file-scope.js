import { AsyncLocalStorage } from 'node:async_hooks';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { GOOGLE_PROVIDERS } from './config.js';
import { usesNativeFiles } from './request-controls.js';
import { explicitNativeFileMessages, verifiedNativeFileMessages } from './native-file-provenance.js';
const nativeFiles = new AsyncLocalStorage();
/**
 * rc.5 projects FileBlocks to text inside its adapter boundary. Retain only
 * their immutable references for the native Google serializer; still dispatch
 * through next() so core validation, replay isolation and failures apply.
 */
export function registerNativeFileBridge(ctx) {
    ctx.on('llm/stream', (options, next) => {
        // A nested request without files must still shadow an outer request's
        // scope, including when it uses the same provider/model and message IDs.
        if (!GOOGLE_PROVIDERS.some(provider => provider === options.provider))
            return next();
        return (async function* () {
            const explicit = explicitNativeFileMessages(options);
            let authorized = new Set();
            const query = ctx.get('sessionQuery');
            if (explicit.size && options.sessionId !== undefined && options.purpose === undefined && query !== undefined) {
                const observation = await query.observeSession(options.sessionId, { signal: options.signal, projectionMode: 'none' });
                try {
                    options.signal?.throwIfAborted();
                    if (observation.header.id === options.sessionId)
                        authorized = verifiedNativeFileMessages(options, observation.events);
                }
                finally {
                    observation[Symbol.dispose]();
                }
            }
            yield* withNativeFileContext(options, next, authorized);
        })();
    });
}
export async function* withNativeFileContext(options, next, authorized = new Set()) {
    const context = { options, explicit: explicitNativeFileMessages(options), authorized };
    const iterator = nativeFiles.run(context, () => next()[Symbol.asyncIterator]());
    let done = false;
    try {
        while (true) {
            const item = await nativeFiles.run(context, () => iterator.next());
            if (item.done) {
                done = true;
                return;
            }
            yield item.value;
        }
    }
    finally {
        if (!done && iterator.return !== undefined)
            await nativeFiles.run(context, () => iterator.return());
    }
}
/** Keep core's local read-only handles alongside native input bytes. Assistant
 * media retains its original block shape for exact provider replay. */
export function restoreNativeFiles(options) {
    const context = nativeFiles.getStore();
    const original = context?.options;
    if (original === undefined || original.provider !== options.provider || original.model !== options.model || original.sessionId !== options.sessionId)
        return options;
    const byId = new Map(original.messages.filter(message => message.id !== undefined).map(message => [message.id, message]));
    const anonymous = original.messages.filter(message => message.id === undefined);
    let anonymousIndex = 0;
    let changed = false;
    const messages = options.messages.map((projected) => {
        const source = projected.id === undefined ? anonymous[anonymousIndex++] : byId.get(projected.id);
        if (source === undefined || !source.content.some(block => block.type === 'file'))
            return projected;
        const explicit = source.id !== undefined && context.explicit.has(source.id);
        if (explicit ? !context.authorized.has(source.id) : !usesNativeFiles(source, original))
            return projected;
        const changedCall = explicit && source.role === 'tool' && projected.role === 'tool'
            && (projected.toolCallId !== source.toolCallId || projected.source.callId !== source.source.callId);
        if (projected.role !== source.role || projected.content.length !== source.content.length || changedCall) {
            throw new LlmError('dsh 文件投影与原消息不匹配；无法安全发送 Google 原生附件', 'NATIVE_FILE_BRIDGE_MISMATCH');
        }
        let messageChanged = false;
        const content = projected.content.flatMap((block, index) => {
            const originalBlock = source.content[index];
            if (originalBlock.type !== 'file' || block.type === 'file')
                return [block];
            messageChanged = true;
            if (source.role === 'assistant')
                return [originalBlock];
            const localHint = block.type === 'text' ? {
                ...block,
                text: `${block.text}\nThe original file is also attached natively below. The local-path note above concerns local file tools only.`,
            } : block;
            return [localHint, originalBlock];
        });
        if (!messageChanged)
            return projected;
        changed = true;
        return {
            ...projected,
            content,
        };
    });
    return changed ? { ...options, messages } : options;
}
/** Used only while serializing the same verified request in its async scope. */
export function isVerifiedNativeFileResult(message, options) {
    const context = nativeFiles.getStore();
    return context !== undefined && message.id !== undefined && context.authorized.has(message.id)
        && context.options.provider === options.provider && context.options.model === options.model && context.options.sessionId === options.sessionId;
}
