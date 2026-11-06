import { LlmError } from '@deepseek-ai/dsh-llm';
import { assertNativeInputType } from './files.js';
import { isVerifiedNativeFileResult } from './file-scope.js';
import { NATIVE_FILE_TOOL } from './native-file-provenance.js';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function jsonEqual(left, right) {
    if (left === right)
        return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, i) => jsonEqual(value, right[i]));
    }
    if (!isRecord(left) || !isRecord(right))
        return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
}
/** Reject stale signatures after an edit rather than replaying hidden, outdated content. */
function matchingReplayParts(block, entry) {
    if (!isRecord(entry) || !Array.isArray(entry.parts) || !entry.parts.every(isRecord))
        return undefined;
    const parts = entry.parts;
    if (entry.block !== undefined)
        return jsonEqual(entry.block, block) ? structuredClone(parts) : undefined;
    if (block.type === 'text' || block.type === 'reasoning') {
        if (parts.some(part => Object.keys(part).some(key => !['text', 'thought', 'thoughtSignature', 'partMetadata'].includes(key))))
            return undefined;
        const thought = block.type === 'reasoning';
        if (parts.some(part => part.text !== undefined && Boolean(part.thought) !== thought))
            return undefined;
        return parts.map(part => part.text ?? '').join('') === block.text ? structuredClone(parts) : undefined;
    }
    if (block.type === 'tool-call' && parts.length === 1 && parts[0].functionCall) {
        const call = parts[0].functionCall;
        try {
            if (call.name === block.name && (call.id === undefined || call.id === block.id) && jsonEqual(call.args ?? {}, JSON.parse(block.arguments)))
                return structuredClone(parts);
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
function replayEntries(message, options) {
    if (message.role !== 'assistant' || message.source.provider !== options.provider || message.source.model !== options.model)
        return undefined;
    const replay = message.source.replayState;
    if (!isRecord(replay) || !isRecord(replay.response) || replay.response.format !== 'google-native-v1')
        return undefined;
    if (!Array.isArray(replay.blocks) || replay.blocks.length !== message.content.length)
        return undefined;
    return replay.blocks;
}
function parseArguments(value) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        throw new LlmError('Tool call contains invalid JSON arguments.', 'INVALID_TOOL_CALL');
    }
    if (!isRecord(parsed))
        throw new LlmError('Google function call arguments must be a JSON object.', 'INVALID_TOOL_CALL');
    return parsed;
}
export async function translateMessages(options, files, inputTypes) {
    const nativeFileCalls = new Set(options.messages.flatMap(message => message.role === 'assistant'
        ? message.content.flatMap(block => block.type === 'tool-call' && block.name === NATIVE_FILE_TOOL ? [block.id] : [])
        : []));
    const unverifiedNativeFileResult = (message) => message.role === 'tool'
        && nativeFileCalls.has(message.toolCallId) && !isVerifiedNativeFileResult(message, options);
    if (inputTypes !== undefined) {
        // Check the entire request before a preceding, allowed file starts an
        // upload. Assistant replay stays exact: its signatures and generated media
        // belong to the previous response, not a newly submitted input file.
        for (const message of options.messages) {
            if (message.role === 'system' || message.role === 'developer')
                continue;
            const replay = replayEntries(message, options);
            for (let index = 0; index < message.content.length; index++) {
                const block = message.content[index];
                if (replay !== undefined && matchingReplayParts(block, replay[index]) !== undefined)
                    continue;
                if (unverifiedNativeFileResult(message) && (block.type === 'image' || block.type === 'file'))
                    continue;
                if (block.type === 'image' && !block.offloaded)
                    assertNativeInputType('image', inputTypes);
                else if (block.type === 'file')
                    await files.validateInputType(block.attachment, inputTypes, options.signal);
                else if (block.type === 'text' || block.type === 'reasoning')
                    assertNativeInputType('text', inputTypes);
            }
        }
    }
    const contents = [];
    const system = options.system === undefined ? [] : [{ text: options.system }];
    const calls = new Map();
    let toolResponses = [];
    let toolMedia = [];
    const toolMediaIds = new Set();
    const flushToolResponses = () => {
        if (toolResponses.length === 0)
            return;
        // Keep the full parallel response group in its own Content. Some proxies
        // classify any Content containing functionResponse as a tool message and
        // discard its other parts, so media must be a separate ordinary user
        // Content, not just a sibling of functionResponse in the same Content.
        contents.push({ role: 'user', parts: toolResponses });
        if (toolMedia.length > 0)
            contents.push({ role: 'user', parts: toolMedia });
        toolResponses = [];
        toolMedia = [];
        toolMediaIds.clear();
    };
    for (const message of options.messages) {
        options.signal?.throwIfAborted();
        if (message.role === 'system') {
            if (contents.length > 0)
                throw new LlmError('Google only accepts a leading system instruction.', 'UNSUPPORTED_SYSTEM_UPDATE');
            for (const block of message.content) {
                if (block.type !== 'text')
                    throw new LlmError('Google system instructions support text content only.', 'UNSUPPORTED_CONTENT');
                system.push({ text: block.text });
            }
            continue;
        }
        if (message.role === 'developer') {
            // Core consumes tool-addition/removal messages for providers using complete tool declarations.
            if (message.content.some(block => block.type !== 'tool-addition' && block.type !== 'tool-removal')) {
                throw new LlmError('Google does not support developer-role messages.', 'UNSUPPORTED_CONTENT');
            }
            continue;
        }
        const replay = replayEntries(message, options);
        if (message.role === 'tool') {
            const identity = calls.get(message.toolCallId);
            if (!identity)
                throw new LlmError('Tool result has no matching function call in Google conversation history.', 'INVALID_TOOL_RESULT');
            const text = [];
            const unverified = unverifiedNativeFileResult(message);
            let mediaCount = 0;
            for (const block of message.content) {
                if (block.type === 'text' || block.type === 'reasoning')
                    text.push(block.text);
                else if (block.type === 'image' || block.type === 'file') {
                    if (unverified) {
                        text.push('[Native file tool media was omitted because its committed successful result could not be verified.]');
                        continue;
                    }
                    if (block.type === 'image' && block.offloaded) {
                        text.push(`[Image ${block.attachment.name ?? block.attachment.attachmentId} was offloaded.]`);
                        continue;
                    }
                    mediaCount++;
                    const key = `${block.type}:${block.attachment.attachmentId}`;
                    if (toolMediaIds.has(key))
                        continue;
                    const part = block.type === 'image'
                        ? await files.imagePart(block.attachment, options.signal, inputTypes)
                        : await files.filePart(block.attachment, options.signal, inputTypes);
                    toolMedia.push({ text: `Media returned by ${identity.name} (tool call ${JSON.stringify(message.toolCallId)}, attachment ${JSON.stringify(block.attachment.name ?? block.attachment.attachmentId)}). Treat this media as output of that tool call.` }, part);
                    toolMediaIds.add(key);
                }
                else
                    throw new LlmError(`Unsupported tool result content type: ${block.type}.`, 'UNSUPPORTED_CONTENT');
            }
            if (mediaCount > 0)
                text.push(message.isError
                    ? 'Media returned by this failed tool call is attached below as native user input for diagnosis; the call did not succeed.'
                    : 'Media returned by this tool call is attached below as native user input after the tool responses.');
            const functionResponse = {
                name: identity.name,
                ...(identity.nativeId === undefined ? {} : { id: identity.nativeId }),
                response: { [message.isError ? 'error' : 'output']: text.join('\n') },
            };
            toolResponses.push({ functionResponse });
            continue;
        }
        flushToolResponses();
        const parts = [];
        for (let i = 0; i < message.content.length; i++) {
            const block = message.content[i];
            const restored = replay === undefined ? undefined : matchingReplayParts(block, replay[i]);
            if (restored) {
                parts.push(...restored);
                if (block.type === 'tool-call') {
                    const native = restored.find(part => part.functionCall)?.functionCall;
                    calls.set(block.id, { name: block.name, nativeId: native?.id });
                }
                continue;
            }
            if (block.type === 'text')
                parts.push({ text: block.text });
            else if (block.type === 'reasoning') {
                // Foreign-provider reasoning is plain context; never forge Gemini's thought signatures.
                parts.push({ text: block.text });
            }
            else if (block.type === 'image') {
                if (block.offloaded)
                    parts.push({ text: `[Image ${block.attachment.name ?? block.attachment.attachmentId} was offloaded.]` });
                else
                    parts.push(await files.imagePart(block.attachment, options.signal, inputTypes));
            }
            else if (block.type === 'file')
                parts.push(await files.filePart(block.attachment, options.signal, inputTypes));
            else if (block.type === 'tool-call') {
                if (message.role !== 'assistant')
                    throw new LlmError('Function calls must appear in assistant messages.', 'INVALID_TOOL_CALL');
                parts.push({ functionCall: { id: block.id, name: block.name, args: parseArguments(block.arguments) } });
                calls.set(block.id, { name: block.name, nativeId: block.id });
            }
            else
                throw new LlmError(`Unsupported message content type: ${block.type}.`, 'UNSUPPORTED_CONTENT');
        }
        if (parts.length > 0)
            appendContent(contents, message.role === 'assistant' ? 'model' : 'user', parts);
    }
    flushToolResponses();
    return { contents, ...(system.length > 0 ? { systemInstruction: { parts: system } } : {}) };
}
function appendContent(contents, role, parts) {
    const previous = contents.at(-1);
    // In particular, a PTC tool result followed by an injected user image must
    // remain two Content items even though both use the Google 'user' role.
    if (previous?.role === role && (role !== 'user' || !previous.parts?.some(part => part.functionResponse !== undefined)))
        previous.parts.push(...parts);
    else
        contents.push({ role, parts });
}
