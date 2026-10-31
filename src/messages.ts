import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'
import type { Content, Part, FunctionResponsePart } from '@google/genai'
import { assertNativeInputType, type NativeFileStore } from './files.js'
import type { GoogleInputType } from './config.js'

interface ReplayBlock { parts: Part[]; block?: ContentBlock }
interface NativeReplay {
  response: { format: 'google-native-v1'; provider?: string; model?: string }
  blocks?: ReplayBlock[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, i) => jsonEqual(value, right[i]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]))
}

/** Reject stale signatures after an edit rather than replaying hidden, outdated content. */
function matchingReplayParts(block: ContentBlock, entry: unknown): Part[] | undefined {
  if (!isRecord(entry) || !Array.isArray(entry.parts) || !entry.parts.every(isRecord)) return undefined
  const parts = entry.parts as Part[]
  if (entry.block !== undefined) return jsonEqual(entry.block, block) ? structuredClone(parts) : undefined
  if (block.type === 'text' || block.type === 'reasoning') {
    if (parts.some(part => Object.keys(part).some(key => !['text', 'thought', 'thoughtSignature', 'partMetadata'].includes(key)))) return undefined
    const thought = block.type === 'reasoning'
    if (parts.some(part => part.text !== undefined && Boolean(part.thought) !== thought)) return undefined
    return parts.map(part => part.text ?? '').join('') === block.text ? structuredClone(parts) : undefined
  }
  if (block.type === 'tool-call' && parts.length === 1 && parts[0].functionCall) {
    const call = parts[0].functionCall
    try {
      if (call.name === block.name && (call.id === undefined || call.id === block.id) && jsonEqual(call.args ?? {}, JSON.parse(block.arguments))) return structuredClone(parts)
    } catch { return undefined }
  }
  return undefined
}

function replayEntries(message: RequestMessage, options: GenerateOptions): readonly ReplayBlock[] | undefined {
  if (message.role !== 'assistant' || message.source.provider !== options.provider || message.source.model !== options.model) return undefined
  const replay = message.source.replayState
  if (!isRecord(replay) || !isRecord(replay.response) || replay.response.format !== 'google-native-v1') return undefined
  if (!Array.isArray(replay.blocks) || replay.blocks.length !== message.content.length) return undefined
  return (replay as unknown as NativeReplay).blocks
}

function parseArguments(value: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new LlmError('Tool call contains invalid JSON arguments.', 'INVALID_TOOL_CALL') }
  if (!isRecord(parsed)) throw new LlmError('Google function call arguments must be a JSON object.', 'INVALID_TOOL_CALL')
  return parsed
}

interface CallIdentity { name: string; nativeId?: string }

export async function translateMessages(options: GenerateOptions, files: NativeFileStore, inputTypes?: readonly GoogleInputType[]): Promise<{ contents: Content[]; systemInstruction?: Content }> {
  if (inputTypes !== undefined) {
    // Check the entire request before a preceding, allowed file starts an
    // upload. Assistant replay stays exact: its signatures and generated media
    // belong to the previous response, not a newly submitted input file.
    for (const message of options.messages) {
      if (message.role === 'system' || message.role === 'developer') continue
      const replay = replayEntries(message, options)
      for (let index = 0; index < message.content.length; index++) {
        const block = message.content[index]
        if (replay !== undefined && matchingReplayParts(block, replay[index]) !== undefined) continue
        if (block.type === 'image' && !block.offloaded) assertNativeInputType('image', inputTypes)
        else if (block.type === 'file') await files.validateInputType(block.attachment, inputTypes, options.signal)
        else if (block.type === 'text' || block.type === 'reasoning') assertNativeInputType('text', inputTypes)
      }
    }
  }
  const contents: Content[] = []
  const system: Part[] = options.system === undefined ? [] : [{ text: options.system }]
  const calls = new Map<string, CallIdentity>()
  for (const message of options.messages) {
    options.signal?.throwIfAborted()
    if (message.role === 'system') {
      if (contents.length > 0) throw new LlmError('Google only accepts a leading system instruction.', 'UNSUPPORTED_SYSTEM_UPDATE')
      for (const block of message.content) {
        if (block.type !== 'text') throw new LlmError('Google system instructions support text content only.', 'UNSUPPORTED_CONTENT')
        system.push({ text: block.text })
      }
      continue
    }
    if (message.role === 'developer') {
      // Core consumes tool-addition/removal messages for providers using complete tool declarations.
      if (message.content.some(block => block.type !== 'tool-addition' && block.type !== 'tool-removal')) {
        throw new LlmError('Google does not support developer-role messages.', 'UNSUPPORTED_CONTENT')
      }
      continue
    }
    const replay = replayEntries(message, options)
    if (message.role === 'tool') {
      const identity = calls.get(message.toolCallId)
      if (!identity) throw new LlmError('Tool result has no matching function call in Google conversation history.', 'INVALID_TOOL_RESULT')
      const text: string[] = []
      const media: FunctionResponsePart[] = []
      for (const block of message.content) {
        if (block.type === 'text' || block.type === 'reasoning') text.push(block.text)
        else if (block.type === 'image') {
          const part = block.offloaded ? undefined : await files.imagePart(block.attachment, options.signal, inputTypes)
          if (part?.inlineData) media.push({ inlineData: part.inlineData })
          else text.push(`[Image ${block.attachment.name ?? block.attachment.attachmentId} was offloaded.]`)
        } else if (block.type === 'file') {
          const part = await files.filePart(block.attachment, options.signal, inputTypes)
          if (part.inlineData) media.push({ inlineData: part.inlineData })
          if (part.fileData) media.push({ fileData: part.fileData })
        } else throw new LlmError(`Unsupported tool result content type: ${block.type}.`, 'UNSUPPORTED_CONTENT')
      }
      const functionResponse = {
        name: identity.name,
        ...(identity.nativeId === undefined ? {} : { id: identity.nativeId }),
        response: { [message.isError ? 'error' : 'output']: text.join('\n') },
        ...(media.length === 0 ? {} : { parts: media }),
      }
      appendContent(contents, 'user', [{ functionResponse }])
      continue
    }
    const parts: Part[] = []
    for (let i = 0; i < message.content.length; i++) {
      const block = message.content[i]
      const restored = replay === undefined ? undefined : matchingReplayParts(block, replay[i])
      if (restored) {
        parts.push(...restored)
        if (block.type === 'tool-call') {
          const native = restored.find(part => part.functionCall)?.functionCall
          calls.set(block.id, { name: block.name, nativeId: native?.id })
        }
        continue
      }
      if (block.type === 'text') parts.push({ text: block.text })
      else if (block.type === 'reasoning') {
        // Foreign-provider reasoning is plain context; never forge Gemini's thought signatures.
        parts.push({ text: block.text })
      } else if (block.type === 'image') {
        if (block.offloaded) parts.push({ text: `[Image ${block.attachment.name ?? block.attachment.attachmentId} was offloaded.]` })
        else parts.push(await files.imagePart(block.attachment, options.signal, inputTypes))
      } else if (block.type === 'file') parts.push(await files.filePart(block.attachment, options.signal, inputTypes))
      else if (block.type === 'tool-call') {
        if (message.role !== 'assistant') throw new LlmError('Function calls must appear in assistant messages.', 'INVALID_TOOL_CALL')
        parts.push({ functionCall: { id: block.id, name: block.name, args: parseArguments(block.arguments) } })
        calls.set(block.id, { name: block.name, nativeId: block.id })
      } else throw new LlmError(`Unsupported message content type: ${block.type}.`, 'UNSUPPORTED_CONTENT')
    }
    if (parts.length > 0) appendContent(contents, message.role === 'assistant' ? 'model' : 'user', parts)
  }
  return { contents, ...(system.length > 0 ? { systemInstruction: { parts: system } } : {}) }
}

function appendContent(contents: Content[], role: 'user' | 'model', parts: Part[]): void {
  const previous = contents.at(-1)
  if (previous?.role === role) previous.parts!.push(...parts)
  else contents.push({ role, parts })
}
