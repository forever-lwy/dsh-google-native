import { LlmError, type GenerateOptions, type RequestMessage } from '@deepseek-ai/dsh-llm'
import { chatSourceSchema, type GoogleChatChoices } from './chat-remote.js'

function recordedChoices(source: unknown, provider: string, model: string): GoogleChatChoices | undefined {
  if (typeof source !== 'object' || source === null || !('googleNative' in source)) return undefined
  const parsed = chatSourceSchema.safeParse(source.googleNative)
  if (!parsed.success) throw new LlmError('已记录的 Google 原生选项无效，无法安全构建请求。', 'INVALID_NATIVE_OPTIONS')
  return parsed.data.selections.find(item => item.provider === provider && item.model === model)?.choices
    ?? { nativeFiles: false, search: false, urlContext: false, codeExecution: false, maps: false }
}

/** The newest human prompt owns this turn; never carry an older prompt's switches forward. */
export function latestChatChoices(options: GenerateOptions): GoogleChatChoices | undefined {
  if (options.purpose !== undefined) return undefined
  for (let index = options.messages.length - 1; index >= 0; index--) {
    const message = options.messages[index]
    if (message.role !== 'user') continue
    if (message.source !== undefined && message.source.kind !== 'user') continue
    return recordedChoices(message.source, options.provider, options.model)
  }
  return undefined
}

/** Upload mode belongs to the originating message, including after resume or a later toggle. */
export function usesNativeFiles(message: RequestMessage, options: GenerateOptions): boolean {
  // Generated media must keep its original native replay even if new uploads use local tools.
  if (message.role === 'assistant') return true
  return recordedChoices(message.source, options.provider, options.model)?.nativeFiles
    ?? latestChatChoices(options)?.nativeFiles ?? true
}
