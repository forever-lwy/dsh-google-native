import type { Volatile, VolatileSnapshot } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LlmError, RetryPolicySchema, resolveRetryPolicy, type RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { GenerateContentConfig, ThinkingConfig } from '@google/genai'
import type { GoogleModelCapabilities } from './capabilities.js'
import { normalizeNativeEndpoint } from './client-factory.js'

export const GOOGLE_PROVIDERS = ['google-ai-studio', 'google-vertex-native'] as const
export type GoogleProvider = typeof GOOGLE_PROVIDERS[number]
export type GoogleInputType = 'text' | 'image' | 'audio' | 'video' | 'pdf'
export type GoogleOutputType = 'text' | 'image' | 'audio'

export interface GoogleReasoningConfig {
  id: string
  name: string
  thinkingBudget?: number
  thinkingLevel?: string
  includeThoughts?: boolean
}

export interface GoogleModelConfig {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  /** Explicit native input capabilities; omitted preserves legacy adapter behavior. */
  inputTypes?: GoogleInputType[]
  /** Supported native outputs, separate from the requested responseModalities. */
  outputTypes?: GoogleOutputType[]
  /** Explicit selectable settings; no model capabilities are guessed for custom IDs. */
  reasoning?: GoogleReasoningConfig[]
  defaultReasoning?: string
  generationConfig?: GenerateContentConfig
  /** Exact support overrides for custom models; unknown IDs expose no chat options by default. */
  capabilities?: GoogleModelCapabilities
}

export interface GoogleFileOptions {
  inlineThresholdBytes?: number
  inlineMaxBytes?: number
  maxFileBytes?: number
  pollIntervalMs?: number
  processingTimeoutMs?: number
}

export interface GoogleNativeTools {
  search?: boolean
  urlContext?: boolean
  codeExecution?: boolean
  maps?: boolean
}

export interface GoogleProfileOptions {
  enabled: boolean
  /** Credential reference, never the API key itself. */
  apiKeyEnv: string
  vertexAuth: 'adc' | 'api-key'
  project?: string
  location?: string
  /** Absolute path inside the dsh container; only used by Vertex ADC. */
  keyFile?: string
  baseURL?: string
  apiVersion?: string
  models: GoogleModelConfig[]
  generationConfig: GenerateContentConfig
  nativeTools: GoogleNativeTools
  files: GoogleFileOptions
  /** Executed by DSH's provider-owned retry service. */
  retryPolicy?: RetryPolicyConfig
}

export interface GoogleProfile extends GoogleProfileOptions {
  provider: GoogleProvider
}
export type Profiles = Record<GoogleProvider, GoogleProfile>
export interface Config {
  aiStudio: Volatile<GoogleProfileOptions>
  vertex: Volatile<GoogleProfileOptions>
}

const reasoning = z.object({
  id: z.string().required(), name: z.string().required(),
  thinkingBudget: z.number().min(-1), thinkingLevel: z.string(), includeThoughts: z.boolean(),
})
const model = z.object({
  id: z.string().required(), name: z.string(), contextWindow: z.number().min(1), maxTokens: z.number().min(1),
  // Schemastery arrays otherwise materialize absent fields as [], which would
  // turn legacy models into an explicit invalid empty input declaration.
  inputTypes: z.array(z.union(['text', 'image', 'audio', 'video', 'pdf'])).extra('default', undefined).description('此模型原生接受的输入类型，必须包含 text'),
  outputTypes: z.array(z.union(['text', 'image', 'audio'])).extra('default', undefined).description('此模型支持的原生输出类型，不指定请求输出格式'),
  reasoning: z.array(reasoning), defaultReasoning: z.string(),
  generationConfig: z.dict(z.any()).description('Google GenerateContentConfig 原生 JSON 参数'),
  capabilities: z.object({
    nativeFiles: z.boolean(), search: z.boolean(), urlContext: z.boolean(), codeExecution: z.boolean(), maps: z.boolean(),
    functionCallingWithNativeTools: z.boolean(),
  }).description('此模型支持的原生聊天选项；未知模型须显式声明'),
})

const budgetEfforts: GoogleReasoningConfig[] = [
  { id: 'dynamic', name: '动态思考', thinkingBudget: -1 },
  { id: 'low', name: '低 (1024 tokens)', thinkingBudget: 1024 },
  { id: 'medium', name: '中 (8192 tokens)', thinkingBudget: 8192 },
  { id: 'high', name: '高 (24576 tokens)', thinkingBudget: 24576 },
]
const levelEfforts = (): GoogleReasoningConfig[] => [
  { id: 'low', name: '低', thinkingLevel: 'LOW' },
  { id: 'medium', name: '中', thinkingLevel: 'MEDIUM' },
  { id: 'high', name: '高', thinkingLevel: 'HIGH' },
]
// Catalog entries are candidates, not a guarantee of account/region access.
// Official AI Studio and Vertex model pages document both IDs. Configure their
// supported LOW/MEDIUM/HIGH levels; context/output limits are left to the API.
export const DEFAULT_MODELS: GoogleModelConfig[] = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1048576,
    reasoning: [{ id: 'off', name: '关闭思考', thinkingBudget: 0 }, ...budgetEfforts] },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1048576, reasoning: budgetEfforts },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', reasoning: levelEfforts(), defaultReasoning: 'medium' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', reasoning: levelEfforts(), defaultReasoning: 'medium' },
]

export function defaultProfile(provider: GoogleProvider): GoogleProfile {
  return {
    provider, enabled: true,
    apiKeyEnv: provider === 'google-ai-studio' ? 'GOOGLE_API_KEY' : 'GOOGLE_VERTEX_API_KEY',
    vertexAuth: 'adc', location: 'global',
    models: structuredClone(DEFAULT_MODELS),
    generationConfig: { thinkingConfig: { includeThoughts: true } },
    nativeTools: {}, files: {},
  }
}

function profileSchema(provider: GoogleProvider) {
  const defaults = defaultProfile(provider)
  const { provider: _provider, ...plainDefaults } = defaults
  return z.object({
    enabled: z.boolean().default(true).description('启用供应商'),
    apiKeyEnv: z.string().role('credential-ref').default(defaults.apiKeyEnv).description('API Key 凭据引用'),
    vertexAuth: z.union(['adc', 'api-key']).default('adc').description('Vertex 认证：ADC 或 Express API Key'),
    project: z.string().description('Google Cloud 项目 ID（Vertex ADC）'),
    location: z.string().default('global').description('Vertex 区域'),
    keyFile: z.string().description('服务账号或 ADC JSON 文件的容器内绝对路径'),
    baseURL: z.string().description('可选原生 API 基地址'),
    apiVersion: z.string().description('可选 API 版本；留空使用 SDK 默认值'),
    models: z.array(model).default(structuredClone(DEFAULT_MODELS)).description('模型目录（可添加任意 Google 原生模型 ID）'),
    generationConfig: z.dict(z.any()).default(plainDefaults.generationConfig).description('原生 GenerateContentConfig JSON 参数'),
    nativeTools: z.object({
      search: z.boolean(), urlContext: z.boolean(), codeExecution: z.boolean(), maps: z.boolean(),
    }).default({}).description('原生工具；也可用 generationConfig.tools 配置完整参数'),
    files: z.object({
      inlineThresholdBytes: z.number().min(1), inlineMaxBytes: z.number().min(1), maxFileBytes: z.number().min(1),
      pollIntervalMs: z.number().min(1), processingTimeoutMs: z.number().min(1),
    }).default({}).description('原生文件上传参数'),
    retryPolicy: RetryPolicySchema,
  }).default(plainDefaults).volatile()
}

export const Config = z.object({
  aiStudio: profileSchema('google-ai-studio').description('Google AI Studio / Gemini Developer API'),
  vertex: profileSchema('google-vertex-native').description('Google Vertex AI'),
})

/** Capture an independent, validated generation so edits cannot affect an in-flight request. */
export function profilesOf(config: Config): Profiles {
  return {
    'google-ai-studio': validateProfile('google-ai-studio', config.aiStudio.get()),
    'google-vertex-native': validateProfile('google-vertex-native', config.vertex.get()),
  }
}

export function validateProfile(provider: GoogleProvider, input: VolatileSnapshot<GoogleProfileOptions>): GoogleProfile {
  const profile = structuredClone({ ...input, provider }) as GoogleProfile
  resolveRetryPolicy(profile.retryPolicy, `google-native: ${provider} retryPolicy`)
  credentialRef(profile.apiKeyEnv)
  normalizeNativeEndpoint(profile.baseURL, profile.apiVersion)
  if (profile.keyFile && !profile.keyFile.startsWith('/')) throw new LlmError('Google keyFile 必须是容器内绝对路径', 'INVALID_CONFIG')
  const ids = new Set<string>()
  for (const entry of profile.models) {
    if (!entry.id.trim() || ids.has(entry.id)) throw new LlmError('Google 模型 ID 不得为空或重复', 'INVALID_CONFIG')
    ids.add(entry.id)
    for (const capacity of [entry.contextWindow, entry.maxTokens]) {
      if (capacity !== undefined && (!Number.isSafeInteger(capacity) || capacity <= 0)) {
        throw new LlmError('模型上下文长度与最大生成 tokens 必须是正整数', 'INVALID_CONFIG')
      }
    }
    if (entry.contextWindow !== undefined && entry.maxTokens !== undefined && entry.maxTokens >= entry.contextWindow) {
      throw new LlmError('最大生成 tokens 必须小于模型上下文长度', 'INVALID_CONFIG')
    }
    if (entry.inputTypes !== undefined && (!Array.isArray(entry.inputTypes) || !entry.inputTypes.includes('text')
      || entry.inputTypes.some(type => !['text', 'image', 'audio', 'video', 'pdf'].includes(type))
      || new Set(entry.inputTypes).size !== entry.inputTypes.length)) {
      throw new LlmError('模型输入类型必须包含 text，且仅包含不重复的受支持类型', 'INVALID_CONFIG')
    }
    if (entry.outputTypes !== undefined && (!Array.isArray(entry.outputTypes) || entry.outputTypes.length === 0
      || entry.outputTypes.some(type => !['text', 'image', 'audio'].includes(type))
      || new Set(entry.outputTypes).size !== entry.outputTypes.length)) {
      throw new LlmError('模型输出类型必须包含至少一种不重复的受支持类型', 'INVALID_CONFIG')
    }
    const efforts = new Set<string>()
    for (const effort of entry.reasoning ?? []) {
      if (!effort.id.trim() || !effort.name.trim() || efforts.has(effort.id)) throw new LlmError('Google 思考强度 ID、名称不得为空，ID 不得重复', 'INVALID_CONFIG')
      efforts.add(effort.id)
      if (effort.thinkingBudget !== undefined && (!Number.isSafeInteger(effort.thinkingBudget) || effort.thinkingBudget < -1)) throw new LlmError('thinkingBudget 必须是大于等于 -1 的整数', 'INVALID_CONFIG')
      if (effort.thinkingLevel !== undefined && !effort.thinkingLevel.trim()) throw new LlmError('thinkingLevel 不得为空', 'INVALID_CONFIG')
      if (effort.thinkingBudget !== undefined && effort.thinkingLevel !== undefined) throw new LlmError('同一思考选项不能同时指定 thinkingBudget 与 thinkingLevel', 'INVALID_CONFIG')
    }
    if (entry.defaultReasoning !== undefined && !efforts.has(entry.defaultReasoning)) throw new LlmError('defaultReasoning 必须属于该模型的 reasoning 列表', 'INVALID_CONFIG')
    validateThinking(entry.generationConfig?.thinkingConfig)
    validateHttpTimeout(entry.generationConfig?.httpOptions?.timeout)
  }
  validateThinking(profile.generationConfig.thinkingConfig)
  validateHttpTimeout(profile.generationConfig.httpOptions?.timeout)
  return profile
}

function validateHttpTimeout(timeout: number | undefined): void {
  if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 0 || timeout > 2_147_483_647)) {
    throw new LlmError('Google HTTP timeout 必须是 0 到 2147483647 之间的整数毫秒；0 表示不设置本地请求截止时间', 'INVALID_CONFIG')
  }
}

function validateThinking(thinking: ThinkingConfig | undefined): void {
  if (typeof thinking?.thinkingBudget === 'number' && typeof thinking.thinkingLevel === 'string') throw new LlmError('thinkingConfig 不能同时指定 thinkingBudget 与 thinkingLevel', 'INVALID_CONFIG')
}
