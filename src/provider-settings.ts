import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { z } from 'zod'
import { DEFAULT_MODELS, GOOGLE_PROVIDERS, validateProfile, type GoogleModelConfig, type GoogleProfile, type Profiles } from './config.js'
import { resolveCapabilities } from './capabilities.js'
import {
  providerRemoteInfo, providerReadRequestSchema, providerDiscoverRequestSchema, providerSaveRequestSchema, providerDiscoverySchema,
  type GoogleProviderConnection, type GoogleProviderModel, type GoogleProviderSettings,
  type GoogleProviderReadRequest, type GoogleProviderDiscoverRequest, type GoogleProviderSaveRequest,
} from './provider-remote.js'

declare module '@deepseek-ai/cordis' { interface Context { nativeGoogleSettings: GoogleProviderSettingsService } }

export interface GoogleProviderSettingsOptions {
  settingsNs: string
  profiles: () => Profiles
  discover: (profile: GoogleProfile, apiKey: string | undefined, signal: AbortSignal) => Promise<GoogleProviderModel[]>
}

const connectionKeys = ['enabled', 'apiKeyEnv', 'vertexAuth', 'project', 'location', 'keyFile', 'baseURL', 'apiVersion'] as const
const optionalConnectionKeys = ['project', 'location', 'keyFile', 'baseURL', 'apiVersion'] as const
const profilePath = (provider: GoogleProfile['provider']) => provider === 'google-ai-studio' ? 'aiStudio' : 'vertex'

function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new RemoteError('gateway/bad-request', 'Google 配置输入无效。', {})
  return parsed.data
}

function viewConnection(profile: GoogleProfile): GoogleProviderConnection {
  const connection: GoogleProviderConnection = { enabled: profile.enabled, apiKeyEnv: profile.apiKeyEnv, vertexAuth: profile.vertexAuth }
  for (const key of optionalConnectionKeys) if (profile[key]) connection[key] = profile[key]
  return connection
}

function canonicalModelId(id: string): string { return id.replace(/^(?:models|publishers\/google\/models)\/([^/]+)$/, '$1') }

/** Retain user-authored advanced model options; newly discovered known IDs inherit their exact preset. */
function selectedModels(profile: GoogleProfile, input: GoogleProviderModel[]): GoogleModelConfig[] {
  const ids = new Set<string>()
  return input.map(item => {
    const canonical = canonicalModelId(item.id)
    if (ids.has(canonical)) throw new RemoteError('gateway/bad-request', '加入的模型 ID 不得重复。', {})
    ids.add(canonical)
    const existing = profile.models.find(model => canonicalModelId(model.id) === canonical)
    const preset = DEFAULT_MODELS.find(model => model.id === canonical)
    if (existing) return { ...structuredClone(existing), id: item.id,
      ...(preset && item.id !== canonical && existing.capabilities === undefined ? { capabilities: resolveCapabilities(profile.provider, preset) } : {}) }
    return {
      ...(preset ? structuredClone(preset) : {}), id: item.id,
      ...(item.name === undefined ? {} : { name: item.name }),
      ...(item.contextWindow === undefined ? {} : { contextWindow: item.contextWindow }),
      ...(item.maxTokens === undefined ? {} : { maxTokens: item.maxTokens }),
      ...(preset && canonical !== item.id ? { capabilities: resolveCapabilities(profile.provider, preset) } : {}),
    }
  })
}

export class GoogleProviderSettingsService extends TypertRemoteService {
  private saves: Promise<void> = Promise.resolve()
  constructor(ctx: Context, private readonly options: GoogleProviderSettingsOptions) { super(ctx, 'nativeGoogleSettings') }

  private descriptor(): SettingsDescriptor {
    try {
      const descriptor = this.ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === this.options.settingsNs)
      if (!descriptor) throw new Error('missing settings entry')
      return descriptor
    } catch { throw new RemoteError('gateway/internal', 'Google 插件配置当前不可用。', {}) }
  }

  private async credentialInfo(profile: GoogleProfile) {
    const provider = this.ctx.get('credentials')
    const references = profile.provider === 'google-ai-studio' && profile.apiKeyEnv === 'GOOGLE_API_KEY'
      ? ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] : [profile.apiKeyEnv]
    if (provider) {
      const primary = await provider.describe(credentialRef(profile.apiKeyEnv))
      for (const reference of references) {
        const info = await provider.describe(credentialRef(reference))
        if (info.configured) return { configured: true, writable: primary.writable, ...(info.source ? { source: info.source } : {}) }
      }
      return { configured: false, writable: primary.writable }
    }
    for (const reference of references) {
      const entry = launchEnvironmentOf(this.ctx).get(reference)
      if (entry?.value) return { configured: true, writable: false, source: entry.source }
    }
    return { configured: false, writable: false }
  }

  @Remote
  async get(request: GoogleProviderReadRequest, signal: AbortSignal): Promise<GoogleProviderSettings> {
    parseRequest(providerReadRequestSchema, request)
    try { return await this.read(signal) }
    catch (error) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'Google 配置读取已取消。', {})
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'Google 插件配置读取失败。', {})
    }
  }

  private async read(signal: AbortSignal): Promise<GoogleProviderSettings> {
    signal.throwIfAborted()
    const descriptor = this.descriptor()
    const profiles = this.options.profiles()
    const views = await Promise.all(GOOGLE_PROVIDERS.map(async provider => {
      const profile = profiles[provider]
      return { provider, connection: viewConnection(profile), credential: await this.credentialInfo(profile),
        models: profile.models.map(model => ({ id: model.id,
          ...(model.name === undefined ? {} : { name: model.name }),
          ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
          ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
        })) }
    }))
    signal.throwIfAborted()
    return { settingsNs: this.options.settingsNs, revision: descriptor.revision, writable: this.ctx.settings.writable, profiles: views }
  }

  private draft(provider: GoogleProfile['provider'], connection: GoogleProviderConnection, models?: GoogleProviderModel[]): GoogleProfile {
    try {
      const current = this.options.profiles()[provider]
      const draft = { ...structuredClone(current), ...connection }
      for (const key of optionalConnectionKeys) if (!connection[key]) delete draft[key]
      if (models) draft.models = selectedModels(current, models)
      return validateProfile(provider, draft)
    } catch (error) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/bad-request', 'Google 连接配置无效，请检查 Base URL、凭据引用与文件路径。', {})
    }
  }

  private async apiKey(profile: GoogleProfile, supplied?: string): Promise<string | undefined> {
    if (profile.provider === 'google-vertex-native' && profile.vertexAuth === 'adc') return undefined
    const references = profile.provider === 'google-ai-studio' && profile.apiKeyEnv === 'GOOGLE_API_KEY'
      ? ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] : [profile.apiKeyEnv]
    if (supplied) return assertUsableApiKey(supplied, 'dsh-google-native', profile.apiKeyEnv)
    for (const reference of references) {
      const key = this.ctx.get('credentials')
      const resolved = key ? await key.resolve(credentialRef(reference)) : launchEnvironmentOf(this.ctx).get(reference)
      if (resolved?.value) return assertUsableApiKey(resolved.value, 'dsh-google-native', reference)
    }
    throw new RemoteError('gateway/bad-request', '请先输入 API Key，或配置对应的凭据引用。', {})
  }

  @Remote
  async discover(request: GoogleProviderDiscoverRequest, signal: AbortSignal): Promise<{ models: GoogleProviderModel[] }> {
    request = parseRequest(providerDiscoverRequestSchema, request)
    signal.throwIfAborted()
    const profile = this.draft(request.provider, request.connection)
    try {
      const apiKey = await this.apiKey(profile, request.apiKey)
      signal.throwIfAborted()
      const models = await this.options.discover(profile, apiKey, signal)
      signal.throwIfAborted()
      return providerDiscoverySchema.parse({ models })
    } catch (error) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', '模型获取已取消。', {})
      if (error instanceof RemoteError) throw error
      if (error instanceof LlmError && ['MODEL_DISCOVERY_LIMIT', 'MODEL_DISCOVERY_PAGINATION', 'MODEL_DISCOVERY_TIMEOUT', 'MODEL_DISCOVERY_UNAVAILABLE'].includes(error.code)) {
        throw new RemoteError('native-google/discovery-failed', error.message, error.failure.status === undefined ? {} : { status: error.failure.status })
      }
      const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined
      throw new RemoteError('native-google/discovery-failed', `无法获取上游模型，请检查 Base URL、认证与 API 版本${status ? `（HTTP ${status}）` : ''}。`,
        status === undefined ? {} : { status })
    }
  }

  @Remote
  async save(request: GoogleProviderSaveRequest, signal: AbortSignal): Promise<GoogleProviderSettings> {
    request = parseRequest(providerSaveRequestSchema, request)
    const operation = this.saves.then(() => this.saveExclusive(request, signal)).catch(error => {
      if (error instanceof RemoteError) throw error
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'Google 配置保存已取消。', {})
      throw new RemoteError('gateway/internal', 'Google 配置保存失败。', {})
    })
    this.saves = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async saveExclusive(request: GoogleProviderSaveRequest, signal: AbortSignal): Promise<GoogleProviderSettings> {
    signal.throwIfAborted()
    const descriptor = this.descriptor()
    if (!this.ctx.settings.writable) throw new RemoteError('gateway/bad-request', '当前配置只读，无法保存 Google 连接。', {})
    if (request.expectedRevision !== descriptor.revision) throw new RemoteError('native-google/settings-conflict', 'Google 配置已在其他窗口变化，请重新加载后保存。', { revision: descriptor.revision })
    const draft = this.draft(request.provider, request.connection, request.models)
    let apiKey: string | undefined
    if (request.apiKey !== undefined) {
      try { apiKey = assertUsableApiKey(request.apiKey, 'dsh-google-native', request.connection.apiKeyEnv) }
      catch { throw new RemoteError('gateway/bad-request', 'API Key 格式无效。', {}) }
      const credentials = this.ctx.get('credentials')
      if (!credentials || !(await credentials.describe(credentialRef(draft.apiKeyEnv))).writable) {
        throw new RemoteError('gateway/bad-request', '当前凭据存储不可写，无法保存 API Key。', {})
      }
    }
    const base = profilePath(request.provider)
    const ops: SettingsPathOp[] = connectionKeys.map(key => ({ op: 'set', path: [base, key],
      // Empty optional strings explicitly override an inherited connection value.
      value: draft[key] ?? '',
    }))
    ops.push({ op: 'set', path: [base, 'models'], value: draft.models })
    signal.throwIfAborted()
    try { await this.ctx.settings.mutate(this.options.settingsNs, ops, request.expectedRevision) }
    catch (error) {
      if (error instanceof SettingsConflictError) throw new RemoteError('native-google/settings-conflict', 'Google 配置已在其他窗口变化，请重新加载后保存。', { revision: error.actual })
      throw new RemoteError('gateway/internal', 'Google 连接配置保存失败。', {})
    }
    if (apiKey !== undefined) {
      try { await this.ctx.credentials.set(credentialRef(draft.apiKeyEnv), apiKey) }
      catch {
        throw new RemoteError('native-google/credential-save-failed', '连接与模型配置已保存，但 API Key 保存失败；请重新加载后输入密钥并保存。', { revision: this.descriptor().revision })
      }
    }
    // Once commit starts, finish its key write even if the view has disappeared.
    return this.get({}, new AbortController().signal)
  }
}

export function registerGoogleProviderSettings(ctx: Context, options: GoogleProviderSettingsOptions): GoogleProviderSettingsService {
  const service = new GoogleProviderSettingsService(ctx, options)
  ctx.typert.remotes.register(providerRemoteInfo)
  return service
}
