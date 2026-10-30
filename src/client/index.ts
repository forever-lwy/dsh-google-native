import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { chatRemoteInfo, getChatOptions, setChatOptions } from '../chat-remote.js'
import { NativeOptions, type NativeOptionsFace } from './NativeOptions.js'
import { en, zh } from './locales.js'
import { nativeStyles } from './styles.js'
import { blockWhileSaving } from './save-block.js'

export const name = 'dsh-google-native-client'
export const inject = ['slots', 'locale', 'conversation', 'modelDirectories', 'remote', 'sessions']

/** Add controls beside file upload, preserving the built-in upload and attachment rail. */
export async function apply(ctx: Context): Promise<void> {
  const unmountRemote = await ctx.remote.$mount(chatRemoteInfo)
  try {
    ctx.effect(() => unmountRemote, 'google-native: remote schema')
    ctx.effect(() => ctx.locale.register('googleNative', 'en', { ...en }), 'google-native: English')
    ctx.effect(() => ctx.locale.register('googleNative', 'zh', zh), 'google-native: Chinese')
    ctx.effect(() => {
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-google-native'
      style.textContent = nativeStyles
      document.head.appendChild(style)
      return () => style.remove()
    }, 'google-native: styles')
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left', id: 'google-native-options', order: 15, locale: 'googleNative',
      inject: (sessionId): NativeOptionsFace => {
        const directory = ctx.modelDirectories.directoryFor(sessionId)
        // Host and browser Context declarations share this package's build;
        // bind the browser service face explicitly at this boundary.
        const sessions = ctx.get('sessions') as unknown as ISessions
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available, directory: directory.store,
          loadDirectory: () => { if (available) void directory.load().catch(() => { /* directory owns errors */ }) },
          read: (route, signal) => getChatOptions(ctx.remote, { sessionId, ...route }, signal),
          save: (route, choices, expectedRevision, signal) => setChatOptions(ctx.remote,
            { sessionId, ...route, choices, expectedRevision }, signal),
          beginSave: reason => blockWhileSaving(ctx.conversation.blocks, sessionId, reason),
        }
      },
    }, NativeOptions))
  } catch (error) {
    await unmountRemote()
    throw error
  }
}

export { NativeOptions, nativeOptionsVisible } from './NativeOptions.js'
export type { NativeOptionsFace, NativeOptionsState } from './NativeOptions.js'
