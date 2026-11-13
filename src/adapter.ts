import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter, LlmError, assertUsableApiKey, attributionHeaders, ReasoningEffortId, resolveRetryPolicy,
  type GenerateOptions, type LlmModelInfo, type LlmResolvedModelInfo,
  type PreparedAdapterCall, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { GoogleGenAI, FunctionCallingConfigMode, type GenerateContentConfig, type GoogleGenAIOptions, type ThinkingLevel, type Tool } from '@google/genai'
import { type GoogleProfile, type GoogleModelConfig, type Profiles } from './config.js'
import { NativeFileStore } from './files.js'
import { translateMessages } from './messages.js'
import { restoreNativeFiles } from './file-scope.js'
import { googleError } from './errors.js'
import { translateStream } from './stream.js'
import { createNativeGoogleClient } from './client-factory.js'
import { activeNativeToolChoices, applyNativeToolChoices, resolveCapabilities, unsupportedChoices } from './capabilities.js'
import { latestChatChoices } from './request-controls.js'
import { withoutRawModelOverrides } from './native-overrides.js'

export interface GoogleAdapterOptions {
  profiles: () => Profiles
  resolveApiKey: (profile: GoogleProfile) => Promise<string | undefined>
  /** Dependency injection for offline protocol tests. */
  createClient?: (options: GoogleGenAIOptions) => GoogleGenAI
}

interface Connection { client: GoogleGenAI; files: NativeFileStore }

export class GoogleNativeAdapter extends LlmAdapter {
  private readonly connections = new Map<string, Connection>()
  constructor(private readonly ctx: Context, private readonly options: GoogleAdapterOptions) { super() }

  providerInfo(provider: string) {
    return { id: provider, name: provider === 'google-ai-studio' ? 'Google AI Studio (Native)' : 'Google Vertex AI (Native)' }
  }

  providerRetryPolicy(provider: string) {
    const profile = this.options.profiles()[provider as keyof Profiles]
    return resolveRetryPolicy(profile?.retryPolicy, `google-native: ${provider} retryPolicy`)
  }

  private profile(provider: string): GoogleProfile {
    const profiles = this.options.profiles()
    if (!(provider in profiles)) throw new LlmError('未知的 Google 供应商路由。', 'NO_ADAPTER')
    const profile = structuredClone(profiles[provider as keyof Profiles])
    if (!profile.enabled) throw new LlmError('Google 供应商已停用。', 'NO_ADAPTER')
    return profile
  }

  async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const profiles = this.options.profiles()
    const profile = profiles[provider as keyof Profiles]
    if (!profile?.enabled) return []
    return profile.models.map(model => this.modelInfo(profile, model.id))
  }

  private modelInfo(profile: GoogleProfile, id: string): LlmResolvedModelInfo {
    const model = profile.models.find(item => item.id === id)
    return {
      provider: profile.provider, id, name: model?.name ?? id,
      inputModalities: model?.inputTypes?.filter((type): type is 'text' | 'image' => type === 'text' || type === 'image') ?? ['text', 'image'],
      ...(model?.contextWindow ? { context: { contextWindow: model.contextWindow } } : {}),
      ...(model?.maxTokens ? { defaultMaxTokens: model.maxTokens } : {}),
      ...(model?.reasoning?.length ? { reasoning: {
        efforts: model.reasoning.map(effort => ({ id: ReasoningEffortId(effort.id), name: effort.name })),
        ...(model.defaultReasoning ? { defaultEffort: ReasoningEffortId(model.defaultReasoning) } : {}),
      } } : {}),
    }
  }

  async resolveModel(provider: string, model: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    return this.modelInfo(this.profile(provider), model)
  }

  async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    signal?.throwIfAborted()
    const profile = this.profile(provider)
    // Capture endpoint and authentication together before returning a prepared
    // generation; a later UI key update must not reach its previous endpoint.
    const connection = await this.connection(profile)
    signal?.throwIfAborted()
    return { model: this.modelInfo(profile, model), stream: options => this.streamProfile(profile, options, connection) }
  }

  /** All public methods of the pinned official SDK remain available to trusted host plugins. */
  async client(provider: string): Promise<GoogleGenAI> { return (await this.connection(this.profile(provider))).client }

  private async connection(profile: GoogleProfile): Promise<Connection> {
    const vertex = profile.provider === 'google-vertex-native'
    const needsKey = !vertex || profile.vertexAuth === 'api-key'
    const raw = needsKey ? await this.options.resolveApiKey(profile) : undefined
    if (needsKey && !raw) throw new LlmError(`请配置 ${profile.apiKeyEnv} 对应的 Google API Key。`, 'MISSING_CREDENTIAL')
    const apiKey = raw ? assertUsableApiKey(raw, 'dsh-google-native', profile.apiKeyEnv) : undefined
    const identity = createHash('sha256').update(JSON.stringify([profile, apiKey])).digest('hex')
    const existing = this.connections.get(identity)
    if (existing) return existing
    const client = createNativeGoogleClient(profile, apiKey, this.options.createClient)
    const connection = { client, files: new NativeFileStore(client, vertex ? 'vertex' : 'ai-studio', this.ctx.attachments, profile.files) }
    // Bound stale generations without invalidating any in-flight connection.
    if (this.connections.size >= 16) this.connections.delete(this.connections.keys().next().value!)
    this.connections.set(identity, connection)
    return connection
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamProfile(this.profile(options.provider), options)
  }

  private async *streamProfile(profile: GoogleProfile, projected: GenerateOptions, boundConnection?: Connection): AsyncGenerator<StreamChunk> {
    const options = restoreNativeFiles(projected)
    try {
      options.signal?.throwIfAborted()
      const model = profile.models.find(item => item.id === options.model)
      const config = buildGenerationConfig(profile, model, options)
      const { client, files } = boundConnection ?? await this.connection(profile)
      const messages = await translateMessages(options, files, model?.inputTypes)
      if (messages.systemInstruction) config.systemInstruction = messages.systemInstruction
      const stream = await client.models.generateContentStream({ model: options.model, contents: messages.contents, config })
      yield* translateStream(stream, options, this.ctx.attachments)
    } catch (error) { throw googleError(error, options.signal) }
  }
}

/** Per-call DSH controls take priority over model settings, then profile settings. */
export function buildGenerationConfig(profile: GoogleProfile, model: GoogleModelConfig | undefined, options: GenerateOptions): GenerateContentConfig {
  const base = structuredClone(profile.generationConfig)
  const override = structuredClone(model?.generationConfig ?? {})
  let config: GenerateContentConfig = {
    automaticContinuation: false, ...base, ...override,
    httpOptions: { ...base.httpOptions, ...override.httpOptions,
      headers: { ...base.httpOptions?.headers, ...override.httpOptions?.headers, ...attributionHeaders() },
      retryOptions: { attempts: 1 },
    },
    abortSignal: options.signal,
  }
  if (config.candidateCount !== undefined && config.candidateCount !== 1) {
    throw LlmError.fromFailure({ message: 'dsh 单条回复要求 candidateCount=1；多候选请使用 nativeGoogle SDK 服务。', code: 'UNSUPPORTED_PARAMETER' })
  }
  if (config.toolConfig?.functionCallingConfig?.streamFunctionCallArguments) {
    throw LlmError.fromFailure({ message: '增量函数参数请通过 nativeGoogle SDK 服务读取；dsh 工具执行要求完整 JSON 参数。', code: 'UNSUPPORTED_PARAMETER' })
  }
  if (options.temperature !== undefined) config.temperature = options.temperature
  const maxTokens = options.maxTokens ?? model?.maxTokens
  if (maxTokens !== undefined) config.maxOutputTokens = maxTokens
  if (options.stop !== undefined) config.stopSequences = [...options.stop]
  const effortId = options.reasoningEffort ?? model?.defaultReasoning
  const effort = model?.reasoning?.find(item => item.id === effortId)
  if (effortId && !effort) throw new LlmError('该模型未声明所选思考强度。', 'UNSUPPORTED_REASONING_EFFORT')
  const thinkingConfig = { ...base.thinkingConfig, ...override.thinkingConfig }
  // A model can switch the provider's thinking dialect. Retain unrelated
  // settings such as includeThoughts while removing the other dialect.
  if (override.thinkingConfig?.thinkingBudget !== undefined) delete thinkingConfig.thinkingLevel
  if (override.thinkingConfig?.thinkingLevel !== undefined) delete thinkingConfig.thinkingBudget
  if (effort) {
    config.thinkingConfig = thinkingConfig
    if (effort.thinkingBudget !== undefined) {
      delete config.thinkingConfig.thinkingLevel
      config.thinkingConfig.thinkingBudget = effort.thinkingBudget
    }
    if (effort.thinkingLevel !== undefined) {
      delete config.thinkingConfig.thinkingBudget
      config.thinkingConfig.thinkingLevel = effort.thinkingLevel as ThinkingLevel
    }
    if (effort.includeThoughts !== undefined) config.thinkingConfig.includeThoughts = effort.includeThoughts
  } else if (base.thinkingConfig || override.thinkingConfig) {
    config.thinkingConfig = thinkingConfig
  }
  config = withoutRawModelOverrides(config, {
    output: override.responseModalities !== undefined,
    maxTokens: maxTokens !== undefined,
    thinkingMode: override.thinkingConfig?.thinkingBudget !== undefined || override.thinkingConfig?.thinkingLevel !== undefined
      || effort?.thinkingBudget !== undefined || effort?.thinkingLevel !== undefined,
    includeThoughts: override.thinkingConfig?.includeThoughts !== undefined || effort?.includeThoughts !== undefined,
  })
  const tools: Tool[] = [...(config.tools as Tool[] ?? [])]
  const native = profile.nativeTools
  for (const [enabled, name] of [[native.search, 'googleSearch'], [native.urlContext, 'urlContext'],
    [native.codeExecution, 'codeExecution'], [native.maps, 'googleMaps']] as const) {
    if (enabled && !tools.some(tool => name in tool)) tools.push({ [name]: {} })
  }
  if (tools.length) config.tools = tools
  const choices = latestChatChoices(options)
  const capabilities = resolveCapabilities(profile.provider, model)
  if (choices) {
    if (unsupportedChoices(capabilities, choices).length) throw LlmError.fromFailure({ message: '该请求选择了当前模型不支持的原生能力。', code: 'UNSUPPORTED_NATIVE_CAPABILITY' })
    config = applyNativeToolChoices(config, choices)
  }
  const nativeEnabled = Object.values(activeNativeToolChoices(config)).some(Boolean)
  // Older models and conservative connections use built-in tools independently.
  // The composer explains this mode before the user enables a native tool.
  if (options.tools?.length && (!nativeEnabled || capabilities.functionCallingWithNativeTools)) {
    const functions = { functionDeclarations: options.tools.map(tool => ({
      name: tool.name, description: tool.description, parametersJsonSchema: structuredClone(tool.parameters),
    })) }
    config.tools = [...config.tools ?? [], functions]
    const extra = config.httpOptions?.extraBody
    if (Array.isArray(extra?.tools)) config.httpOptions = { ...config.httpOptions, extraBody: { ...extra, tools: [...extra.tools, functions] } }
    if (nativeEnabled && profile.provider === 'google-ai-studio') {
      const mode = config.toolConfig?.functionCallingConfig?.mode
      if (mode === FunctionCallingConfigMode.AUTO) throw LlmError.fromFailure({ message: 'Google 原生工具与本地工具混用需要 VALIDATED 函数模式。', code: 'UNSUPPORTED_PARAMETER' })
      config.toolConfig = { ...config.toolConfig, includeServerSideToolInvocations: true,
        functionCallingConfig: { ...config.toolConfig?.functionCallingConfig, mode: mode ?? FunctionCallingConfigMode.VALIDATED } }
    }
  }
  return config
}
