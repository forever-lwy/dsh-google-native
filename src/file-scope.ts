import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
import { GOOGLE_PROVIDERS } from './config.js'

const nativeFiles = new AsyncLocalStorage<GenerateOptions>()

/**
 * rc.5 projects FileBlocks to text inside its adapter boundary. Retain only
 * their immutable references for the native Google serializer; still dispatch
 * through next() so core validation, replay isolation and failures apply.
 */
export function registerNativeFileBridge(ctx: Context): void {
  ctx.on('llm/stream', (options, next) => {
    // A nested request without files must still shadow an outer request's
    // scope, including when it uses the same provider/model and message IDs.
    if (!GOOGLE_PROVIDERS.some(provider => provider === options.provider)) return next()
    return withNativeFileContext(options, next)
  })
}

export async function* withNativeFileContext(
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  const iterator = nativeFiles.run(options, () => next()[Symbol.asyncIterator]())
  let done = false
  try {
    while (true) {
      const item = await nativeFiles.run(options, () => iterator.next())
      if (item.done) { done = true; return }
      yield item.value
    }
  } finally {
    if (!done && iterator.return !== undefined) await nativeFiles.run(options, () => iterator.return!())
  }
}

/** Restore files alone; all core-produced message/source changes are retained. */
export function restoreNativeFiles(options: GenerateOptions): GenerateOptions {
  const original = nativeFiles.getStore()
  if (original === undefined || original.provider !== options.provider || original.model !== options.model) return options
  const byId = new Map(original.messages.filter(message => message.id !== undefined).map(message => [message.id, message]))
  const anonymous = original.messages.filter(message => message.id === undefined)
  let anonymousIndex = 0
  let changed = false
  const messages = options.messages.map((projected): RequestMessage => {
    const source = projected.id === undefined ? anonymous[anonymousIndex++] : byId.get(projected.id)
    if (source === undefined || !source.content.some(block => block.type === 'file')) return projected
    if (projected.role !== source.role || projected.content.length !== source.content.length) {
      throw new LlmError('dsh 文件投影与原消息不匹配；无法安全发送 Google 原生附件', 'NATIVE_FILE_BRIDGE_MISMATCH')
    }
    changed = true
    return {
      ...projected,
      content: projected.content.map((block, index) => source.content[index].type === 'file' ? source.content[index] : block),
    } as RequestMessage
  })
  return changed ? { ...options, messages } : options
}
