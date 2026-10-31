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

export const providerModelSchema = z.object({
  id: z.string().trim().min(1).max(1024).refine(value => !/[\s\\?#\u0000-\u001f\u007f]/.test(value)
    && !/^https?:\/\//i.test(value) && !value.split('/').some(segment => segment === '.' || segment === '..')),
  name: z.string().max(1024).optional(), description: z.string().max(32_768).optional(),
  contextWindow: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  maxTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  supportsGenerateContent: z.boolean().optional(),
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
