import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { RemoteResult, TypertClientRemote, TypertRemoteInfo, TypertRemoteMethod } from '@deepseek-ai/dsh-typert-protocol'

export const chatChoicesSchema = z.object({
  nativeFiles: z.boolean(), search: z.boolean(), urlContext: z.boolean(), codeExecution: z.boolean(), maps: z.boolean(),
}).strict()
export type GoogleChatChoices = z.infer<typeof chatChoicesSchema>

export const chatRouteSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict()
export const chatRequestSchema = chatRouteSchema.extend({ sessionId: z.string().min(1) }).strict()
export type GoogleChatRequest = z.infer<typeof chatRequestSchema>
export const chatSetRequestSchema = chatRequestSchema.extend({
  choices: chatChoicesSchema, expectedRevision: z.number().int().nonnegative(),
}).strict()
export type GoogleChatSetRequest = z.infer<typeof chatSetRequestSchema>

export const chatSelectionSchema = chatRouteSchema.extend({ choices: chatChoicesSchema }).strict()
export type GoogleChatSelectionSnapshot = z.infer<typeof chatSelectionSchema>
export const chatSourceSchema = z.object({ version: z.literal(1), selections: z.array(chatSelectionSchema) }).strict()
export type GoogleChatSourceSnapshot = z.infer<typeof chatSourceSchema>

export const chatCapabilitiesSchema = chatChoicesSchema.extend({ functionCallingWithNativeTools: z.boolean() }).strict()
export const chatSnapshotSchema = chatRouteSchema.extend({
  capabilities: chatCapabilitiesSchema, choices: chatChoicesSchema, revision: z.number().int().nonnegative(),
}).strict()
export type GoogleChatSnapshot = z.infer<typeof chatSnapshotSchema>

type GetMethod = TypertRemoteMethod<{ request: GoogleChatRequest }, GoogleChatSnapshot>
type SetMethod = TypertRemoteMethod<{ request: GoogleChatSetRequest }, GoogleChatSnapshot>
const codec = <Schema extends z.ZodType>(schema: Schema, typeSymbol: string) => ({ mode: 'strict' as const, typeSymbol, create: () => schema })
const parameter = (schema: z.ZodType, symbol: string) => ({
  name: 'request', source: 'json' as const, codec: codec(schema, symbol), strictCodec: codec(schema, symbol),
})

/** Shared strict descriptors; the browser imports no Host implementation or credentials. */
export const chatRemoteInfo = createTypertRemoteInfo({
  package: 'dsh-google-native',
  methods: {
    'nativeGoogleChat/get': {
      service: 'nativeGoogleChat', invocation: { kind: 'direct' },
      parameters: [parameter(chatRequestSchema, 'GoogleChatRequest')], result: codec(chatSnapshotSchema, 'GoogleChatSnapshot'),
      cancellation: { parameter: 'signal' },
    },
    'nativeGoogleChat/set': {
      service: 'nativeGoogleChat', invocation: { kind: 'direct' },
      parameters: [parameter(chatSetRequestSchema, 'GoogleChatSetRequest')], result: codec(chatSnapshotSchema, 'GoogleChatSnapshot'),
      cancellation: { parameter: 'signal' },
    },
  },
}, z) as TypertRemoteInfo<{ 'nativeGoogleChat/get': GetMethod; 'nativeGoogleChat/set': SetMethod }>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'nativeGoogleChat/get': (request: GoogleChatRequest, signal?: AbortSignal) => Promise<RemoteResult<GoogleChatSnapshot>>
    'nativeGoogleChat/set': (request: GoogleChatSetRequest, signal?: AbortSignal) => Promise<RemoteResult<GoogleChatSnapshot>>
  }
  interface TypertRemoteNamespaceMap {
    nativeGoogleChat: {
      get(request: GoogleChatRequest, signal?: AbortSignal): Promise<RemoteResult<GoogleChatSnapshot>>
      set(request: GoogleChatSetRequest, signal?: AbortSignal): Promise<RemoteResult<GoogleChatSnapshot>>
    }
  }
  interface RemoteErrorDetailsMap {
    'native-google/conflict': { revision: number }
  }
}

export async function getChatOptions(remote: TypertClientRemote, request: GoogleChatRequest, signal?: AbortSignal): Promise<GoogleChatSnapshot> {
  const result = await chatRemoteInfo.methods['nativeGoogleChat/get'].invoke(remote, { request }, signal)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

export async function setChatOptions(remote: TypertClientRemote, request: GoogleChatSetRequest, signal?: AbortSignal): Promise<GoogleChatSnapshot> {
  const result = await chatRemoteInfo.methods['nativeGoogleChat/set'].invoke(remote, { request }, signal)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Invalid, legacy, or route-mismatched metadata never grants native capabilities. */
export function readChatChoices(source: unknown, provider: string, model: string): GoogleChatChoices | undefined {
  if (typeof source !== 'object' || source === null || !('googleNative' in source)) return undefined
  const parsed = chatSourceSchema.safeParse(source.googleNative)
  if (!parsed.success) return undefined
  return parsed.data.selections.find(selection => selection.provider === provider && selection.model === model)?.choices
}
