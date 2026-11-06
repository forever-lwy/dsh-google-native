export const NATIVE_FILE_TOOL = 'google_native_attach_file';
function object(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fileRef(value) {
    return object(value) && typeof value.attachmentId === 'string' && value.attachmentId.length > 0
        && typeof value.name === 'string' && value.name.length > 0
        && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 0;
}
function receipt(value) {
    if (!object(value) || value.version !== 1 || !['google-ai-studio', 'google-vertex-native'].includes(String(value.provider))
        || !['sessionId', 'model', 'callId', 'rootCallId'].every(key => typeof value[key] === 'string' && value[key].length > 0)
        || !fileRef(value.attachment))
        return undefined;
    return value;
}
function sameRef(left, right) {
    return left.attachmentId === right.attachmentId && left.name === right.name && left.bytes === right.bytes;
}
function sameReceipt(left, right) {
    return left.sessionId === right.sessionId && left.provider === right.provider && left.model === right.model
        && left.callId === right.callId && left.rootCallId === right.rootCallId && sameRef(left.attachment, right.attachment);
}
function ownsFile(content, binding) {
    if (!Array.isArray(content))
        return false;
    const files = content.filter(block => object(block) && block.type === 'file');
    return files.length === 1 && fileRef(files[0].attachment) && sameRef(files[0].attachment, binding.attachment);
}
function inRoute(binding, options) {
    return binding !== undefined && binding.sessionId === options.sessionId
        && binding.provider === options.provider && binding.model === options.model;
}
/** These producers require a verified receipt even when user uploads use native mode. */
export function explicitNativeFileMessages(options) {
    const calls = new Set();
    const ids = new Set();
    for (const message of options.messages) {
        if (message.role === 'assistant')
            for (const block of message.content) {
                if (block.type === 'tool-call' && block.name === NATIVE_FILE_TOOL)
                    calls.add(block.id);
            }
        if (message.id !== undefined && (message.source?.kind === 'google-native-file'
            || message.role === 'tool' && calls.has(message.toolCallId)))
            ids.add(message.id);
    }
    return ids;
}
/** Authorize references from committed outcomes, never from textual handles or tool arguments. */
export function verifiedNativeFileMessages(options, events) {
    const authorized = new Set();
    if (options.sessionId === undefined || options.purpose !== undefined)
        return authorized;
    const origins = new Map();
    const direct = new Map();
    const nested = [];
    const completedRoots = new Set();
    const contexts = new Map();
    for (const event of events) {
        if (event.type === 'assistant/message') {
            const { message, turn, step } = event.data;
            for (const block of message.content)
                if (block.type === 'tool-call')
                    origins.set(block.id, {
                        name: block.name, provider: message.source.provider, model: message.source.model, seq: event.seq, turn, step,
                    });
        }
        else if (event.type === 'tool/result') {
            const { message, meta, turn, step } = event.data;
            if (message.isError || message.source.callId !== message.toolCallId)
                continue;
            const origin = origins.get(message.toolCallId);
            if (!origin || origin.provider !== options.provider || origin.model !== options.model || origin.turn !== turn || origin.step !== step)
                continue;
            completedRoots.add(`${origin.seq}:${message.toolCallId}`);
            const binding = receipt(object(meta) ? meta.googleNativeFile : undefined);
            if (origin.name === NATIVE_FILE_TOOL && inRoute(binding, options) && binding.callId === message.toolCallId
                && binding.rootCallId === binding.callId && ownsFile(message.content, binding))
                direct.set(message.id, binding);
        }
        else if (event.type === 'tool/ptc-dispatch') {
            const data = event.data;
            const binding = receipt(object(data.meta) ? data.meta.googleNativeFile : undefined);
            const origin = origins.get(data.rootCallId);
            if (!data.isError && data.name === NATIVE_FILE_TOOL && inRoute(binding, options)
                && binding.callId === data.subCallId && binding.rootCallId === data.rootCallId && ownsFile(data.content, binding)
                && origin?.name === 'run_code' && origin.provider === options.provider && origin.model === options.model) {
                nested.push({ binding, origin: origin.seq });
            }
        }
        else if (event.type === 'user/message') {
            const message = event.data;
            if (message.source.kind !== 'google-native-file')
                continue;
            const binding = receipt(message.source.googleNativeFile);
            if (inRoute(binding, options) && ownsFile(message.content, binding))
                contexts.set(message.id, binding);
        }
    }
    for (const message of options.messages) {
        if (message.id === undefined)
            continue;
        if (message.role === 'tool') {
            const binding = direct.get(message.id);
            if (binding && message.toolCallId === binding.callId && message.source.callId === binding.callId
                && !message.isError && ownsFile(message.content, binding))
                authorized.add(message.id);
        }
        else if (message.role === 'user' && message.source?.kind === 'google-native-file') {
            const binding = receipt(message.source.googleNativeFile);
            const committed = contexts.get(message.id);
            if (binding && committed && sameReceipt(binding, committed) && ownsFile(message.content, binding)
                && nested.some(item => completedRoots.has(`${item.origin}:${item.binding.rootCallId}`) && sameReceipt(item.binding, binding)))
                authorized.add(message.id);
        }
    }
    return authorized;
}
