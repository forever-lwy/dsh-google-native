import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { Config, GOOGLE_PROVIDERS, profilesOf } from './config.js'
import { GoogleNativeAdapter } from './adapter.js'
import { GoogleNativeService } from './service.js'
import { registerNativeFileBridge } from './file-scope.js'
import { registerGoogleChatControls } from './chat-controls.js'
import { createNativeGoogleClient, resolveGoogleApiKey } from './client-factory.js'
import { registerGoogleProviderSettings } from './provider-settings.js'
import { discoverGoogleModels } from './discovery.js'

export { Config, DEFAULT_MODELS, defaultProfile, profilesOf, validateProfile } from './config.js'
export type { GoogleFileOptions, GoogleModelConfig, GoogleNativeTools, GoogleProfile, GoogleProfileOptions, GoogleProvider, GoogleReasoningConfig, Profiles } from './config.js'
export { GoogleNativeAdapter } from './adapter.js'
export { GoogleNativeService } from './service.js'
export type { GoogleModelCapabilities } from './capabilities.js'

export const name = 'dsh-google-native'
export const inject = ['llm', 'attachments']

export function apply(ctx: Context, config: Config): void {
  const profiles = () => profilesOf(config)
  profiles()
  const adapter = new GoogleNativeAdapter(ctx, {
    profiles,
    resolveApiKey: profile => resolveGoogleApiKey(ctx, profile),
  })
  // Both routes stay owned by this generation, including while disabled;
  // disabling removes catalog entries and refuses dispatch in the adapter.
  const registration = ctx.llm.registerAdapter([...GOOGLE_PROVIDERS], adapter)
  ctx.llm.registerConfigurableProviders([
    {
      provider: 'google-ai-studio', displayName: 'Google AI Studio（原生）',
      settingsNs: ctx.fiber.entry?.options.id ?? name, settingsPath: ['aiStudio'],
      defaultBaseURL: 'https://generativelanguage.googleapis.com',
      nativeAuth: { env: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'], oauth: false },
    },
    {
      provider: 'google-vertex-native', displayName: 'Google Vertex AI（原生）',
      settingsNs: ctx.fiber.entry?.options.id ?? name, settingsPath: ['vertex'],
      nativeAuth: { env: ['GOOGLE_VERTEX_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS'], oauth: false },
    },
  ])
  registerNativeFileBridge(ctx)
  new GoogleNativeService(ctx, adapter)
  const settingsNs = ctx.fiber.entry?.options.id ?? name
  ctx.inject(['settings', 'typert', 'credentials'], settingsCtx => {
    registerGoogleProviderSettings(settingsCtx, {
      settingsNs, profiles,
      discover: (profile, key, signal) => discoverGoogleModels(createNativeGoogleClient(profile, key),
        profile.provider === 'google-ai-studio' ? 'ai-studio' : 'vertex', signal),
    })
  })
  ctx.inject(['sessionProjections', 'sessionController', 'sessions', 'typert'], chatCtx => {
    registerGoogleChatControls(chatCtx, profiles)
  })
  ctx.on('loader/volatile-update', () => {
    // rc.5 has no llm/models-updated event. Its registry replacement emits the
    // supported adapters-updated notification while preserving this adapter.
    registration.replace([...GOOGLE_PROVIDERS])
  })
}
