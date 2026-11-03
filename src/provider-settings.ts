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
import { withoutRawModelOverrides } from './native-overrides.js'
import {
  DEFAULT_PROVIDER_FILE_LIMITS, providerRemoteInfo, providerReadRequestSchema, providerDiscoverRequestSchema, providerSaveRequestSchema, providerDiscoverySchema,
  type GoogleProviderConnection, type GoogleProviderModel, type GoogleProviderSettings, type GoogleModelAdvanced,
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
const fileSizeKeys = ['inlineThresholdBytes', 'inlineMaxBytes', 'maxFileBytes'] as const
const profilePath = (provider: GoogleProfile['provider']) => provider === 'google-ai-studio' ? 'aiStudio' : 'vertex'

function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new RemoteError('gateway/bad-request', 'Google 配置输入无效。', {})
  return parsed.data
}

function viewConnection(profile: GoogleProfile): GoogleProviderConnection {
  const connection: GoogleProviderConnection = { enabled: profile.enabled, apiKeyEnv: profile.apiKeyEnv, vertexAuth: profile.vertexAuth }
  for (const key of optionalConnectionKeys) if (profile[key]) connection[key] = profile[key]
  if (profile.generationConfig.httpOptions?.timeout !== undefined) connection.requestTimeoutMs = profile.generationConfig.httpOptions.timeout
  connection.files = {
    inlineThresholdBytes: profile.files.inlineThresholdBytes ?? DEFAULT_PROVIDER_FILE_LIMITS.inlineThresholdBytes,
    inlineMaxBytes: profile.files.inlineMaxBytes ?? DEFAULT_PROVIDER_FILE_LIMITS.inlineMaxBytes,
    maxFileBytes: profile.files.maxFileBytes ?? DEFAULT_PROVIDER_FILE_LIMITS.maxFileBytes,
  }
  return connection
}

function canonicalModelId(id: string): string { return id.replace(/^(?:models|publishers\/google\/models)\/([^/]+)$/, '$1') }

/** Only UI-owned fields cross the browser boundary; headers and opaque native options stay private. */
function viewAdvanced(model: GoogleModelConfig): GoogleModelAdvanced | undefined {
  const view: GoogleModelAdvanced = {}
  for (const key of ['contextWindow', 'maxTokens', 'inputTypes', 'outputTypes', 'defaultReasoning'] as const) {
    if (model[key] !== undefined) Object.assign(view, { [key]: structuredClone(model[key]) })
  }
  if (model.name?.trim()) view.name = model.name
  if (model.reasoning !== undefined) view.reasoning = model.reasoning.map(effort => ({ id: effort.id, name: effort.name,
    ...(effort.thinkingBudget === undefined ? {} : { thinkingBudget: effort.thinkingBudget }),
    ...(effort.thinkingLevel === undefined ? {} : { thinkingLevel: effort.thinkingLevel }),
    ...(effort.includeThoughts === undefined ? {} : { includeThoughts: effort.includeThoughts }),
  }))
  const config = model.generationConfig
  // Legacy native defaults remain in place until this particular field is
  // edited, but the model editor still needs to show their effective limit.
  const nativeMaxTokens = nativeMaxTokensOverride(model)
  if (view.maxTokens === undefined && nativeMaxTokens !== undefined) view.maxTokens = nativeMaxTokens
  const outputs = config?.responseModalities
  if (Array.isArray(outputs) && outputs.length > 0 && outputs.length <= 3
    && outputs.every(type => ['TEXT', 'IMAGE', 'AUDIO'].includes(type)) && new Set(outputs).size === outputs.length) {
    view.responseModalities = [...outputs] as NonNullable<GoogleModelAdvanced['responseModalities']>
  }
  if (config?.httpOptions?.timeout !== undefined) view.requestTimeoutMs = config.httpOptions.timeout
  const thinking = config?.thinkingConfig
  if (thinking) {
    const fields: NonNullable<GoogleModelAdvanced['thinkingConfig']> = {}
    if (typeof thinking.includeThoughts === 'boolean') fields.includeThoughts = thinking.includeThoughts
    if (Number.isSafeInteger(thinking.thinkingBudget) && thinking.thinkingBudget! >= -1) fields.thinkingBudget = thinking.thinkingBudget
    if (typeof thinking.thinkingLevel === 'string' && thinking.thinkingLevel.trim().length > 0 && thinking.thinkingLevel.length <= 64) fields.thinkingLevel = thinking.thinkingLevel
    if (Object.keys(fields).length) view.thinkingConfig = fields
  }
  return Object.keys(view).length ? view : undefined
}

function applyAdvanced(model: GoogleModelConfig, patch: GoogleModelAdvanced): GoogleModelConfig {
  const result = structuredClone(model)
  for (const key of ['name', 'contextWindow', 'maxTokens', 'inputTypes', 'outputTypes', 'reasoning', 'defaultReasoning'] as const) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === null) delete result[key]
    else Object.assign(result, { [key]: structuredClone(value) })
  }
  let generation = structuredClone(result.generationConfig ?? {})
  // The visible output limit owns the native SDK equivalent as well. Clearing
  // the visible override must not resurrect an older hidden model-only limit.
  if (patch.maxTokens !== undefined) delete generation.maxOutputTokens
  if (patch.responseModalities !== undefined) {
    if (patch.responseModalities === null) delete generation.responseModalities
    else generation.responseModalities = [...patch.responseModalities]
  }
  if (patch.requestTimeoutMs !== undefined) {
    const http = { ...generation.httpOptions }
    if (patch.requestTimeoutMs === null) delete http.timeout
    else http.timeout = patch.requestTimeoutMs
    if (Object.keys(http).length) generation.httpOptions = http
    else delete generation.httpOptions
  }
  if (patch.thinkingConfig !== undefined) {
    const thinking = { ...generation.thinkingConfig }
    for (const key of ['includeThoughts', 'thinkingBudget', 'thinkingLevel'] as const) {
      const value = patch.thinkingConfig === null ? null : patch.thinkingConfig[key]
      if (value === undefined) continue
      if (value === null) delete thinking[key]
      else Object.assign(thinking, { [key]: value })
    }
    // A selected native thinking format replaces only its mutually exclusive peer.
    if (patch.thinkingConfig?.thinkingBudget != null) delete thinking.thinkingLevel
    if (patch.thinkingConfig?.thinkingLevel != null) delete thinking.thinkingBudget
    if (Object.keys(thinking).length) generation.thinkingConfig = thinking
    else delete generation.thinkingConfig
  }
  generation = withoutRawModelOverrides(generation, {
    output: patch.responseModalities !== undefined,
    maxTokens: patch.maxTokens !== undefined,
    thinkingMode: patch.thinkingConfig === null || patch.thinkingConfig?.thinkingBudget !== undefined
      || patch.thinkingConfig?.thinkingLevel !== undefined,
    includeThoughts: patch.thinkingConfig === null || patch.thinkingConfig?.includeThoughts !== undefined,
  })
  if (result.generationConfig !== undefined || Object.keys(generation).length) result.generationConfig = generation
  return result
}

/** Read only this safe native field. Null marks an existing opaque override so
 * discovery cannot mistake it for an absent default and overwrite it. */
function nativeMaxTokensOverride(model: GoogleModelConfig): number | null | undefined {
  const config = model.generationConfig
  let value: unknown = config?.maxOutputTokens
  const extra = config?.httpOptions?.extraBody
  // REST overrides take priority over SDK defaults. Match the camel-case
  // precedence used when explicit controls normalize duplicate REST aliases.
  for (const key of ['generation_config', 'generationConfig']) {
    const raw = extra?.[key]
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    for (const alias of ['max_output_tokens', 'maxOutputTokens']) {
      const candidate = (raw as Record<string, unknown>)[alias]
      if (candidate !== undefined) value = candidate
    }
  }
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/** Retain user-authored advanced model options; newly discovered known IDs inherit their exact preset. */
function selectedModels(profile: GoogleProfile, input: GoogleProviderModel[]): GoogleModelConfig[] {
  const ids = new Set<string>()
  return input.map(item => {
    const canonical = canonicalModelId(item.id)
    if (ids.has(canonical)) throw new RemoteError('gateway/bad-request', '加入的模型 ID 不得重复。', {})
    ids.add(canonical)
    const existing = profile.models.find(model => canonicalModelId(model.id) === canonical)
    const preset = DEFAULT_MODELS.find(model => model.id === canonical)
    const result: GoogleModelConfig = existing ? { ...structuredClone(existing), id: item.id,
      ...(preset && item.id !== canonical && existing.capabilities === undefined ? { capabilities: resolveCapabilities(profile.provider, preset) } : {}) } : {
      ...(preset ? structuredClone(preset) : {}), id: item.id,
      ...(item.name === undefined ? {} : { name: item.name }),
      ...(item.contextWindow === undefined ? {} : { contextWindow: item.contextWindow }),
      ...(item.maxTokens === undefined ? {} : { maxTokens: item.maxTokens }),
      ...(preset && canonical !== item.id ? { capabilities: resolveCapabilities(profile.provider, preset) } : {}),
    }
    // Discovery reports defaults, while advanced is an explicit user patch.
    // Existing values, including private native limits, always take priority.
    for (const key of ['contextWindow', 'maxTokens', 'inputTypes', 'outputTypes'] as const) {
      if (result[key] !== undefined || item[key] === undefined || key === 'maxTokens' && nativeMaxTokensOverride(result) !== undefined) continue
      Object.assign(result, { [key]: structuredClone(item[key]) })
    }
    return item.advanced === undefined ? result : applyAdvanced(result, item.advanced)
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
        models: profile.models.map(model => {
          const advanced = viewAdvanced(model)
          return { id: model.id,
            ...(model.name === undefined ? {} : { name: model.name }),
            ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
            ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
            ...(model.inputTypes === undefined ? {} : { inputTypes: [...model.inputTypes] }),
            ...(model.outputTypes === undefined ? {} : { outputTypes: [...model.outputTypes] }),
            ...(advanced === undefined ? {} : { advanced }),
          }
        }) }
    }))
    signal.throwIfAborted()
    return { settingsNs: this.options.settingsNs, revision: descriptor.revision, writable: this.ctx.settings.writable, profiles: views }
  }

  private draft(provider: GoogleProfile['provider'], connection: GoogleProviderConnection, models?: GoogleProviderModel[]): GoogleProfile {
    try {
      const current = this.options.profiles()[provider]
      const { requestTimeoutMs, files, ...connectionValues } = connection
      const draft = { ...structuredClone(current), ...connectionValues }
      for (const key of fileSizeKeys) {
        if (files?.[key] !== undefined) draft.files[key] = files[key]
      }
      if (requestTimeoutMs !== undefined) draft.generationConfig = { ...draft.generationConfig,
        httpOptions: { ...draft.generationConfig.httpOptions, timeout: requestTimeoutMs },
      }
      for (const key of optionalConnectionKeys) if (!connection[key]) delete draft[key]
      if (models) draft.models = selectedModels(current, models)
      return validateProfile(provider, draft)
    } catch (error) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/bad-request', 'Google 连接或模型参数无效，请检查地址、容量、思考设置与超时。', {})
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
    // Patch only the deadline, preserving private headers and every other
    // advanced option. Older clients omit this field and leave it untouched.
    if (request.connection.requestTimeoutMs !== undefined) ops.push({ op: 'set',
      path: [base, 'generationConfig', 'httpOptions', 'timeout'], value: request.connection.requestTimeoutMs,
    })
    // Only editable limits are patched. Processing options and values omitted
    // by an older or partially editing client retain their current settings.
    for (const key of fileSizeKeys) {
      const value = request.connection.files?.[key]
      if (value !== undefined) ops.push({ op: 'set', path: [base, 'files', key], value })
    }
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
