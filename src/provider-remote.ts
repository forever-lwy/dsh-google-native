import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { RemoteResult, TypertClientRemote, TypertRemoteInfo, TypertRemoteMethod } from '@deepseek-ai/dsh-typert-protocol'

export const providerIdSchema = z.enum(['google-ai-studio', 'google-vertex-native'])
const optionalText = z.string().trim().max(2048).optional()
/** Largest delay Node's timers can represent without clamping to one millisecond. */
export const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647
export const providerConnectionSchema = z.object({
  enabled: z.boolean(),
  apiKeyEnv: z.string().min(1).max(256).regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  vertexAuth: z.enum(['adc', 'api-key']),
  project: optionalText, location: optionalText, keyFile: optionalText,
  baseURL: optionalText, apiVersion: z.string().trim().max(64).optional(),
  /** Model-generation deadline; omitted by older clients, zero disables it. */
  requestTimeoutMs: z.number().int().nonnegative().max(MAX_REQUEST_TIMEOUT_MS).optional(),
}).strict()
export type GoogleProviderConnection = z.infer<typeof providerConnectionSchema>

const optionalCapacity = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional()
const optionalBudget = z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).nullable().optional()
const optionalLevel = z.string().trim().min(1).max(64).nullable().optional()
export const modelThinkingSchema = z.object({
  includeThoughts: z.boolean().nullable().optional(), thinkingBudget: optionalBudget, thinkingLevel: optionalLevel,
}).strict().refine(value => value.thinkingBudget == null || value.thinkingLevel == null,
  'Thinking budget and level cannot both be set.')
export type GoogleModelThinking = z.infer<typeof modelThinkingSchema>
export const modelReasoningSchema = z.object({
  id: z.string().trim().min(1).max(128), name: z.string().trim().min(1).max(512),
  thinkingBudget: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).optional(),
  thinkingLevel: z.string().trim().min(1).max(64).optional(), includeThoughts: z.boolean().optional(),
}).strict().refine(value => value.thinkingBudget === undefined || value.thinkingLevel === undefined,
  'Thinking budget and level cannot both be set.')
export type GoogleModelReasoning = z.infer<typeof modelReasoningSchema>
const inputTypesSchema = z.array(z.enum(['text', 'image', 'audio', 'video', 'pdf'])).min(1).max(5)
  .refine(values => values.includes('text') && new Set(values).size === values.length,
    'Input types must include text and must not contain duplicates.')
const responseModalitiesSchema = z.array(z.enum(['TEXT', 'IMAGE', 'AUDIO'])).min(1).max(3)
  .refine(values => new Set(values).size === values.length, 'Output types must not contain duplicates.')
const outputTypesSchema = z.array(z.enum(['text', 'image', 'audio'])).min(1).max(3)
  .refine(values => new Set(values).size === values.length, 'Supported output types must not contain duplicates.')
/** Safe editable fields. Capacity relationships are checked after merging a save,
 * so legacy native defaults can remain readable and be corrected in the UI. */
export const modelAdvancedSchema = z.object({
  name: z.string().trim().min(1).max(1024).nullable().optional(),
  contextWindow: optionalCapacity, maxTokens: optionalCapacity,
  inputTypes: inputTypesSchema.nullable().optional(),
  outputTypes: outputTypesSchema.nullable().optional(),
  responseModalities: responseModalitiesSchema.nullable().optional(),
  requestTimeoutMs: z.number().int().nonnegative().max(MAX_REQUEST_TIMEOUT_MS).nullable().optional(),
  reasoning: z.array(modelReasoningSchema).max(64).nullable().optional(),
  defaultReasoning: z.string().trim().min(1).max(128).nullable().optional(),
  thinkingConfig: modelThinkingSchema.nullable().optional(),
}).strict().refine(value => !value.reasoning || new Set(value.reasoning.map(item => item.id)).size === value.reasoning.length,
  'Reasoning effort IDs must be unique.')
export type GoogleModelAdvanced = z.infer<typeof modelAdvancedSchema>

export const providerModelSchema = z.object({
  id: z.string().trim().min(1).max(1024).refine(value => !/[\s\\?#\u0000-\u001f\u007f]/.test(value)
    && !/^https?:\/\//i.test(value) && !value.split('/').some(segment => segment === '.' || segment === '..')),
  name: z.string().max(1024).optional(), description: z.string().max(32_768).optional(),
  contextWindow: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  maxTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  /** Returned support metadata; it does not select request modalities. */
  inputTypes: inputTypesSchema.optional(), outputTypes: outputTypesSchema.optional(),
  supportsGenerateContent: z.boolean().optional(),
  advanced: modelAdvancedSchema.optional(),
}).strict()
export type GoogleProviderModel = z.infer<typeof providerModelSchema>

export const providerProfileViewSchema = z.object({
  provider: providerIdSchema, connection: providerConnectionSchema,
  credential: z.object({ configured: z.boolean(), writable: z.boolean(), source: z.string().optional() }).strict(),
  models: z.array(providerModelSchema).max(1000),
}).strict()
export type GoogleProviderProfileView = z.infer<typeof providerProfileViewSchema>
export const providerSettingsSchema = z.object({
  settingsNs: z.string().min(1), revision: z.number().int().nonnegative(), writable: z.boolean(),
  profiles: z.array(providerProfileViewSchema).max(2),
}).strict()
export type GoogleProviderSettings = z.infer<typeof providerSettingsSchema>

export const providerReadRequestSchema = z.object({}).strict()
export type GoogleProviderReadRequest = z.infer<typeof providerReadRequestSchema>
export const providerDiscoverRequestSchema = z.object({
  provider: providerIdSchema, connection: providerConnectionSchema,
  /** Transient for discovery; save is the only operation which writes this secret. */
  apiKey: z.string().trim().min(1).max(16_384).optional(),
}).strict()
export type GoogleProviderDiscoverRequest = z.infer<typeof providerDiscoverRequestSchema>
export const providerDiscoverySchema = z.object({ models: z.array(providerModelSchema).max(1000) }).strict()
export type GoogleProviderDiscovery = z.infer<typeof providerDiscoverySchema>
export const providerSaveRequestSchema = providerDiscoverRequestSchema.extend({
  models: z.array(providerModelSchema).max(1000), expectedRevision: z.number().int().nonnegative(),
}).strict()
export type GoogleProviderSaveRequest = z.infer<typeof providerSaveRequestSchema>

type GetMethod = TypertRemoteMethod<{ request: GoogleProviderReadRequest }, GoogleProviderSettings>
type DiscoverMethod = TypertRemoteMethod<{ request: GoogleProviderDiscoverRequest }, GoogleProviderDiscovery>
type SaveMethod = TypertRemoteMethod<{ request: GoogleProviderSaveRequest }, GoogleProviderSettings>
const codec = <Schema extends z.ZodType>(schema: Schema, typeSymbol: string) => ({ mode: 'strict' as const, typeSymbol, create: () => schema })
const parameter = (schema: z.ZodType, symbol: string) => ({
  name: 'request', source: 'json' as const, codec: codec(schema, symbol), strictCodec: codec(schema, symbol),
})
/** Settings calls touch the global deployment, never a user-supplied Session resource. */
export const providerRemoteInfo = createTypertRemoteInfo({
  package: 'dsh-google-native-provider-settings',
  methods: {
    'nativeGoogleSettings/get': {
      service: 'nativeGoogleSettings', invocation: { kind: 'direct' },
      parameters: [parameter(providerReadRequestSchema, 'GoogleProviderReadRequest')],
      result: codec(providerSettingsSchema, 'GoogleProviderSettings'), cancellation: { parameter: 'signal' },
    },
    'nativeGoogleSettings/discover': {
      service: 'nativeGoogleSettings', invocation: { kind: 'direct' },
      parameters: [parameter(providerDiscoverRequestSchema, 'GoogleProviderDiscoverRequest')],
      result: codec(providerDiscoverySchema, 'GoogleProviderDiscovery'), cancellation: { parameter: 'signal' },
    },
    'nativeGoogleSettings/save': {
      service: 'nativeGoogleSettings', invocation: { kind: 'direct' },
      parameters: [parameter(providerSaveRequestSchema, 'GoogleProviderSaveRequest')],
      result: codec(providerSettingsSchema, 'GoogleProviderSettings'), cancellation: { parameter: 'signal' },
    },
  },
}, z) as TypertRemoteInfo<{
  'nativeGoogleSettings/get': GetMethod
  'nativeGoogleSettings/discover': DiscoverMethod
  'nativeGoogleSettings/save': SaveMethod
}>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'nativeGoogleSettings/get': (request: GoogleProviderReadRequest, signal?: AbortSignal) => Promise<RemoteResult<GoogleProviderSettings>>
    'nativeGoogleSettings/discover': (request: GoogleProviderDiscoverRequest, signal?: AbortSignal) => Promise<RemoteResult<GoogleProviderDiscovery>>
    'nativeGoogleSettings/save': (request: GoogleProviderSaveRequest, signal?: AbortSignal) => Promise<RemoteResult<GoogleProviderSettings>>
  }
  interface TypertRemoteNamespaceMap {
    nativeGoogleSettings: {
      get(request: GoogleProviderReadRequest, signal?: AbortSignal): Promise<RemoteResult<GoogleProviderSettings>>
      discover(request: GoogleProviderDiscoverRequest, signal?: AbortSignal): Promise<RemoteResult<GoogleProviderDiscovery>>
      save(request: GoogleProviderSaveRequest, signal?: AbortSignal): Promise<RemoteResult<GoogleProviderSettings>>
    }
  }
  interface RemoteErrorDetailsMap {
    'native-google/settings-conflict': { revision: number }
    'native-google/discovery-failed': { status?: number }
    'native-google/credential-save-failed': { revision: number }
  }
}

/** Only safe action metadata crosses into UI recovery logic; credential payloads never do. */
export class ProviderSettingsRemoteError extends Error {
  readonly code: string
  readonly revision?: number
  constructor(error: { code: string; message: string; details?: unknown }) {
    super(error.message)
    this.name = 'ProviderSettingsRemoteError'
    this.code = error.code
    if (typeof error.details === 'object' && error.details !== null && 'revision' in error.details
      && typeof error.details.revision === 'number' && Number.isSafeInteger(error.details.revision) && error.details.revision >= 0) {
      this.revision = error.details.revision
    }
  }
}

export async function getProviderSettings(remote: TypertClientRemote, signal?: AbortSignal): Promise<GoogleProviderSettings> {
  const result = await providerRemoteInfo.methods['nativeGoogleSettings/get'].invoke(remote, { request: {} }, signal)
  if (!result.ok) throw new ProviderSettingsRemoteError(result.error)
  return result.value
}
export async function discoverProviderModels(remote: TypertClientRemote, request: GoogleProviderDiscoverRequest, signal?: AbortSignal): Promise<GoogleProviderDiscovery> {
  const result = await providerRemoteInfo.methods['nativeGoogleSettings/discover'].invoke(remote, { request }, signal)
  if (!result.ok) throw new ProviderSettingsRemoteError(result.error)
  return result.value
}
export async function saveProviderSettings(remote: TypertClientRemote, request: GoogleProviderSaveRequest, signal?: AbortSignal): Promise<GoogleProviderSettings> {
  const result = await providerRemoteInfo.methods['nativeGoogleSettings/save'].invoke(remote, { request }, signal)
  if (!result.ok) throw new ProviderSettingsRemoteError(result.error)
  return result.value
}
