import { createUserMessage, LlmError } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { resolveCapabilities } from './capabilities.js';
import { assertNativeInputType, detectMimeType } from './files.js';
import { GOOGLE_PROVIDERS } from './config.js';
export const GOOGLE_NATIVE_FILE_TOOL = 'google_native_attach_file';
const MiB = 1024 * 1024;
const CHUNK_BYTES = MiB;
const fileSchema = { type: 'object', additionalProperties: false, properties: {
        attachmentId: { type: 'string', required: true }, name: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
    } };
const receiptSchema = { type: 'object', additionalProperties: false, properties: {
        version: { type: 'integer', const: 1, required: true }, sessionId: { type: 'string', required: true },
        provider: { type: 'string', required: true }, model: { type: 'string', required: true },
        callId: { type: 'string', required: true }, rootCallId: { type: 'string', required: true },
        attachment: { ...fileSchema, required: true },
    } };
function sameFile(block, receipt) {
    const ref = receipt.attachment;
    return block.type === 'file' && block.attachment.attachmentId === ref.attachmentId
        && block.attachment.bytes === ref.bytes && block.attachment.name === ref.name;
}
function positive(value, fallback) {
    if (value === undefined)
        return fallback;
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new LlmError('Google 文件大小上限必须是正整数。', 'INVALID_CONFIG');
    return value;
}
/** Attach exact workspace bytes to the current conversation. No parser, image
 * normalizer, external model request, or credential resolver participates. */
export function registerNativeFileTool(ctx, profiles, choices) {
    // The tool exists only while the step runs on an enabled Google model. A
    // model with native file input also needs the conversation's native-file
    // switch on; without chat controls there is no switch and the capability
    // decides. A model that only declares image input has no such switch and
    // keeps the tool for images.
    const eligible = (agent, provider, modelId) => {
        if (!agent || !provider || !modelId || !GOOGLE_PROVIDERS.some(value => value === provider))
            return undefined;
        const profile = profiles()[provider];
        const model = profile.enabled ? profile.models.find(model => model.id === modelId) : undefined;
        if (!model)
            return undefined;
        const nativeFiles = resolveCapabilities(provider, model).nativeFiles;
        if (!nativeFiles)
            return model.inputTypes?.includes('image') ? { profile, model, nativeFiles } : undefined;
        const current = choices?.(agent.session, provider, modelId);
        return current === undefined || current.nativeFiles ? { profile, model, nativeFiles } : undefined;
    };
    const routeOf = (agent) => agent.session.requestHeader()?.config ?? agent.options;
    const pending = new Map();
    ctx.effect(() => () => { pending.clear(); });
    const definition = defineTool({
        name: GOOGLE_NATIVE_FILE_TOOL,
        description: 'Attach one existing workspace file to this SAME conversation so the current Google model can inspect its ORIGINAL bytes natively. Supports declared images, audio, video, PDF and text formats. This tool does not parse, summarize, OCR, resize, transcode or call another model. Use a workspace path; after success inspect the attached file in the next model response. Large files obey the configured native upload limits.',
        parameters: { path: { type: 'string', required: true, description: 'Existing file path, absolute or relative to the current working directory, inside the session workspace.' } },
        output: { schema: receiptSchema,
            render: (_args, value) => [{ type: 'file', attachment: value.attachment }],
            presentationMeta: (_args, value) => ({ googleNativeFile: value }), },
        async execute({ path }, exec) {
            const agent = exec.agent;
            if (!agent)
                throw new LlmError('原生文件上传需要当前会话中的模型调用。', 'NATIVE_FILE_AGENT_REQUIRED');
            exec.signal.throwIfAborted();
            const route = routeOf(agent);
            const selected = eligible(agent, route.provider, route.model);
            if (!selected)
                throw new LlmError('当前对话未启用 Google 原生文件输入。', 'UNSUPPORTED_NATIVE_CAPABILITY');
            if (!path.trim() || path.length > 4096 || /[\u0000-\u001f\u007f]/.test(path) || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
                throw new LlmError('请提供工作区内的有效文件路径。', 'INVALID_FILE_PATH');
            }
            const cwd = ctx.workingDirectory.get(agent.session);
            const root = await ctx.fs.resolve(agent.session.header.cwd ?? cwd, { signal: exec.signal });
            const target = await ctx.fs.resolve(path, { cwd, signal: exec.signal });
            if (!ctx.fs.contains(root, target))
                throw new LlmError('只能上传当前会话工作区内的文件。', 'NATIVE_FILE_OUTSIDE_WORKSPACE');
            const before = await ctx.fs.stat(target, exec.signal);
            if (!before || before.type !== 'file')
                throw new LlmError('上传目标必须是现有的普通文件。', 'NATIVE_FILE_NOT_REGULAR');
            const maxFile = positive(selected.profile.files.maxFileBytes, 300 * MiB);
            const maxBytes = selected.profile.provider === 'google-vertex-native'
                ? Math.min(maxFile, positive(selected.profile.files.inlineMaxBytes, 16 * MiB)) : maxFile;
            if (before.size !== undefined && before.size > maxBytes)
                throw new LlmError('文件超过当前 Google 原生上传大小上限。', 'FILE_TOO_LARGE');
            const name = target.displayPath.replaceAll('\\', '/').split('/').at(-1) || 'attachment';
            const prefix = await ctx.fs.readByteRange(target, { offset: 0, length: Math.min(32, maxBytes + 1) }, exec.signal);
            const mime = detectMimeType(name, prefix);
            const inputType = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio'
                : mime.startsWith('video/') ? 'video' : mime === 'application/pdf' ? 'pdf' : 'text';
            if (inputType !== 'image' && !selected.nativeFiles)
                throw new LlmError('当前模型未启用此类原生文件输入。', 'UNSUPPORTED_NATIVE_CAPABILITY');
            assertNativeInputType(inputType, selected.model.inputTypes);
            const data = async function* () {
                let offset = prefix.length;
                if (offset > maxBytes)
                    throw new LlmError('文件超过当前 Google 原生上传大小上限。', 'FILE_TOO_LARGE');
                if (offset)
                    yield prefix;
                while (true) {
                    exec.signal.throwIfAborted();
                    const length = Math.min(CHUNK_BYTES, maxBytes - offset + 1);
                    const bytes = await ctx.fs.readByteRange(target, { offset, length }, exec.signal);
                    if (!bytes.length)
                        break;
                    if (bytes.length > length || offset + bytes.length > maxBytes)
                        throw new LlmError('文件超过当前 Google 原生上传大小上限。', 'FILE_TOO_LARGE');
                    offset += bytes.length;
                    yield bytes;
                }
                const after = await ctx.fs.stat(target, exec.signal);
                if (!after || after.type !== 'file' || after.version !== before.version || after.size !== before.size
                    || after.size !== undefined && after.size !== offset) {
                    throw new LlmError('文件在读取过程中发生变化，请重试。', 'NATIVE_FILE_CHANGED');
                }
                exec.signal.throwIfAborted();
            };
            const attachment = await ctx.attachments.saveFileStream({ data: data(), name, signal: exec.signal });
            exec.signal.throwIfAborted();
            return { version: 1, sessionId: String(agent.session.id), provider: selected.profile.provider,
                model: selected.model.id, callId: String(exec.callId), rootCallId: String(exec.rootCallId), attachment };
        },
    });
    // 0.2.2 step admission: the step's captured model selection and the
    // conversation's switch decide whether the tool participates. False removes
    // it from the declarations, dispatch and the PTC SDK alike, so no prompt
    // post-processing is needed.
    ctx.tools.register(definition, {
        when: ({ agent, modelSelection }) => eligible(agent, modelSelection.provider, modelSelection.model) !== undefined,
    });
    // rc.5 preserves deferContext on late cancellation. Publish PTC files only
    // after BOTH the nested call and its enclosing transport have final success.
    ctx.on('tools/result', (exec, result) => {
        const queued = pending.get(exec.token);
        pending.delete(exec.token);
        if (queued && !result.isError && !exec.signal.aborted && exec.agent === queued.agent) {
            for (const receipt of queued.receipts)
                queued.agent.inject(createUserMessage({
                    source: { kind: 'google-native-file', googleNativeFile: receipt },
                    content: [{ type: 'file', attachment: receipt.attachment }],
                }));
        }
        if (exec.name !== GOOGLE_NATIVE_FILE_TOOL || !exec.parent || !exec.agent || result.isError || exec.signal.aborted)
            return;
        const meta = result.meta;
        const receipt = meta?.googleNativeFile;
        if (!receipt || receipt.version !== 1 || receipt.callId !== exec.callId || receipt.rootCallId !== exec.rootCallId
            || receipt.sessionId !== exec.agent.session.id || !result.content.some(block => sameFile(block, receipt)))
            return;
        const group = pending.get(exec.parent) ?? { agent: exec.agent, receipts: [] };
        if (group.agent !== exec.agent)
            return;
        group.receipts.push(receipt);
        pending.set(exec.parent, group);
    });
    ctx.on('agent/disposed', ({ agent }) => {
        for (const [token, value] of pending)
            if (value.agent === agent)
                pending.delete(token);
    });
}
