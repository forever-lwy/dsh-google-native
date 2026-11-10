import { randomUUID } from 'node:crypto';
import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm';
import { nativeMediaFile } from './media.js';
import { googleError } from './errors.js';
const nativeToolLabels = {
    GOOGLE_SEARCH_WEB: 'Google 搜索', GOOGLE_SEARCH_IMAGE: 'Google 图片搜索', URL_CONTEXT: 'URL 上下文',
    GOOGLE_MAPS: 'Google 地图', FILE_SEARCH: '文件搜索', MEDIA_PROCESSING: '媒体处理',
};
/** Stream raw Parts, retaining signatures on their exact native Part for replay. */
export async function* translateStream(stream, options, attachments) {
    let active;
    let index = 0;
    let stop;
    let calls = false;
    let usage;
    let responseId;
    let modelVersion;
    let promptFeedback;
    const metadata = [];
    const candidates = [];
    const pending = [];
    const sources = new Map();
    const nativeIds = new Set();
    async function* close() {
        if (!active)
            return;
        let block;
        if (active.kind === 'media') {
            const data = Buffer.concat(active.data);
            const mime = active.mime;
            if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) {
                const attachment = await attachments.saveImage({ data, mediaType: mime, name: `google-${randomUUID()}.${mime.split('/')[1]}` });
                block = { type: 'image', attachment };
            }
            else {
                const file = nativeMediaFile(data, mime);
                block = { type: 'file', attachment: await attachments.saveFile({ data: file.data, name: `google-${randomUUID()}.${file.extension}` }) };
            }
            yield { type: 'block-start', index: active.index, blockType: block.type };
        }
        else
            block = { type: active.kind, text: active.text };
        yield { type: 'block-end', index: active.index, block };
        metadata.push({ parts: active.parts, block: structuredClone(block) });
        active = undefined;
    }
    /** Finish a cut stream as a truncated reply: DSH keeps max-tokens content but never runs its tool calls. */
    async function* salvage(cut) {
        const text = `\n\n---\n⚠️ 输出未完成：${cut.message.replace(/。$/, '')}。以上是连接断开前已生成的内容；回复“继续”可接着写。`;
        const blockIndex = index++;
        yield { type: 'block-start', index: blockIndex, blockType: 'text' };
        yield { type: 'text-delta', index: blockIndex, text };
        yield { type: 'block-end', index: blockIndex, block: { type: 'text', text } };
        // Replay blocks align with every streamed block; DSH's assembler drops the
        // tool calls from both content and replay together on max-tokens.
        const blocks = [...metadata, { parts: [], block: { type: 'text', text } }];
        yield* usageChunk();
        yield { type: 'finish', reason: { kind: 'max-tokens' }, replayState: {
                response: { format: 'google-native-v1', provider: options.provider, model: options.model, candidates,
                    incomplete: { code: cut.code, message: cut.message },
                    ...(responseId === undefined ? {} : { responseId }),
                    ...(modelVersion === undefined ? {} : { modelVersion }),
                    ...(usage === undefined ? {} : { usageMetadata: usage }),
                },
                blocks,
            } };
    }
    function* usageChunk() {
        if (!usage)
            return;
        const cached = usage.cachedContentTokenCount ?? 0;
        yield { type: 'usage', usage: {
                inputTokens: Math.max(0, (usage.promptTokenCount ?? 0) - cached) + (usage.toolUsePromptTokenCount ?? 0),
                outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
                cacheReadTokens: cached, reasoningTokens: usage.thoughtsTokenCount ?? 0,
                ...(usage.totalTokenCount === undefined ? {} : { totalTokens: usage.totalTokenCount }),
            } };
    }
    let cut;
    try {
        for await (const response of stream) {
            options.signal?.throwIfAborted();
            usage = response.usageMetadata ?? usage;
            responseId = response.responseId ?? responseId;
            modelVersion = response.modelVersion ?? modelVersion;
            promptFeedback = response.promptFeedback ?? promptFeedback;
            if ((response.candidates?.length ?? 0) > 1)
                throw new LlmError('dsh 无法合并多个 Google 候选回复；请使用 nativeGoogle SDK 服务。', 'UNSUPPORTED_RESPONSE');
            const candidate = response.candidates?.[0];
            if (!candidate)
                continue;
            const { content: _content, ...extra } = candidate;
            if (Object.keys(extra).length)
                candidates.push(structuredClone(extra));
            if (candidate.finishReason)
                stop = candidate.finishReason;
            for (const chunk of candidate.groundingMetadata?.groundingChunks ?? []) {
                const web = chunk.web;
                if (web?.uri && /^https?:\/\//i.test(web.uri))
                    sources.set(web.uri, web.title ?? web.uri);
            }
            for (const raw of candidate.content?.parts ?? []) {
                const part = structuredClone(raw);
                if (part.text !== undefined) {
                    const kind = part.thought ? 'reasoning' : 'text';
                    if (active?.kind !== kind) {
                        yield* close();
                        active = { kind, index: index++, text: '', parts: pending.splice(0) };
                        yield { type: 'block-start', index: active.index, blockType: kind };
                    }
                    active.parts.push(part);
                    active.text += part.text;
                    yield { type: kind === 'text' ? 'text-delta' : 'reasoning-delta', index: active.index, text: part.text };
                }
                else if (part.functionCall) {
                    yield* close();
                    const call = part.functionCall;
                    if (!call.name || call.partialArgs || call.willContinue)
                        throw new LlmError('Google 返回了不完整的函数调用。', 'INVALID_TOOL_CALL');
                    if (call.id && nativeIds.has(call.id))
                        throw new LlmError('Google 返回了重复的函数调用 ID。', 'INVALID_TOOL_CALL');
                    if (call.id)
                        nativeIds.add(call.id);
                    const block = { type: 'tool-call', id: ToolCallId(call.id ?? `google-${randomUUID()}`), name: call.name, arguments: JSON.stringify(call.args ?? {}) };
                    const blockIndex = index++;
                    yield { type: 'block-start', index: blockIndex, blockType: 'tool-call' };
                    yield { type: 'tool-call-delta', index: blockIndex, id: block.id, name: block.name, argumentsDelta: block.arguments };
                    yield { type: 'block-end', index: blockIndex, block };
                    metadata.push({ parts: [...pending.splice(0), part], block: structuredClone(block) });
                    calls = true;
                }
                else if (part.inlineData?.data) {
                    const mime = part.inlineData.mimeType ?? 'application/octet-stream';
                    if (active?.kind !== 'media' || active.mime !== mime || mime.startsWith('image/')) {
                        yield* close();
                        active = { kind: 'media', index: index++, text: '', parts: pending.splice(0), mime, data: [] };
                    }
                    active.parts.push(part);
                    active.data.push(Buffer.from(part.inlineData.data, 'base64'));
                }
                else if (Object.keys(part).every(key => ['thoughtSignature', 'thought', 'partMetadata'].includes(key))) {
                    if (active)
                        active.parts.push(part);
                    else if (metadata.length)
                        metadata.at(-1).parts.push(part);
                    else
                        pending.push(part);
                }
                else {
                    yield* close();
                    const text = part.executableCode ? `\n\`\`\`${part.executableCode.language?.toLowerCase() ?? ''}\n${part.executableCode.code ?? ''}\n\`\`\`\n`
                        : part.codeExecutionResult ? `\n\`\`\`text\n${part.codeExecutionResult.output ?? ''}\n\`\`\`\n`
                            : part.toolCall ? `\n正在使用${nativeToolLabels[part.toolCall.toolType ?? ''] ?? '原生工具'}…\n`
                                : part.toolResponse ? `\n${nativeToolLabels[part.toolResponse.toolType ?? ''] ?? '原生工具'}已完成。\n`
                                    : part.fileData?.fileUri ? `[Google 原生媒体：${part.fileData.mimeType ?? 'file'}] ${part.fileData.fileUri}`
                                        : `[Google 原生数据]\n\`\`\`json\n${JSON.stringify(part)}\n\`\`\``;
                    const block = { type: 'text', text };
                    const blockIndex = index++;
                    yield { type: 'block-start', index: blockIndex, blockType: 'text' };
                    yield { type: 'text-delta', index: blockIndex, text };
                    yield { type: 'block-end', index: blockIndex, block };
                    metadata.push({ parts: [...pending.splice(0), part], block });
                }
            }
        }
    }
    catch (error) {
        // Our own protocol checks and user cancellation keep their meaning; only
        // an upstream cut (transport error or SDK error event) can be salvaged.
        if (error instanceof LlmError || options.signal?.aborted)
            throw error;
        cut = googleError(error, options.signal);
    }
    yield* close();
    options.signal?.throwIfAborted();
    if (promptFeedback?.blockReason)
        throw new LlmError(`Google 拦截了提示词（${promptFeedback.blockReason}）。`, 'CONTENT_FILTER');
    // A cut after Google's own finish marker loses nothing; finish normally.
    if (!stop) {
        // DSH discards every block of an errored attempt. Once visible answer text
        // exists, keep it as a truncated reply instead; reasoning-only or empty
        // attempts still fail so the retry policy can resend them.
        const failure = cut ?? new LlmError('Google 流在终止标记之前结束。', 'INCOMPLETE_RESPONSE');
        if (!metadata.some(item => item.block.type === 'text' && item.block.text.trim()))
            throw failure;
        yield* salvage(failure);
        return;
    }
    if (!['STOP', 'MAX_TOKENS'].includes(stop)) {
        const filtered = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(stop);
        throw new LlmError(`Google 生成已终止（${stop}）。`, filtered ? 'CONTENT_FILTER' : 'INVALID_RESPONSE');
    }
    if (!metadata.length)
        throw new LlmError('Google 返回了空回复。', 'EMPTY_RESPONSE');
    if (sources.size) {
        const safeTitle = (title) => title.replace(/[\[\]<>\r\n]/g, ' ');
        const text = '\n\n来源：\n' + [...sources].map(([uri, title]) => `- [${safeTitle(title)}](${uri.replace(/\)/g, '%29')})`).join('\n');
        const block = { type: 'text', text };
        const blockIndex = index++;
        yield { type: 'block-start', index: blockIndex, blockType: 'text' };
        yield { type: 'text-delta', index: blockIndex, text };
        yield { type: 'block-end', index: blockIndex, block };
        metadata.push({ parts: [], block });
    }
    yield* usageChunk();
    yield { type: 'finish', reason: { kind: stop === 'MAX_TOKENS' ? 'max-tokens' : calls ? 'tool-calls' : 'stop' }, replayState: {
            response: { format: 'google-native-v1', provider: options.provider, model: options.model, candidates,
                ...(responseId === undefined ? {} : { responseId }),
                ...(modelVersion === undefined ? {} : { modelVersion }),
                ...(promptFeedback === undefined ? {} : { promptFeedback }),
                ...(usage === undefined ? {} : { usageMetadata: usage }),
            },
            blocks: metadata,
        } };
}
