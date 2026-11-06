import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
export const chatChoicesSchema = z.object({
    nativeFiles: z.boolean(), search: z.boolean(), urlContext: z.boolean(), codeExecution: z.boolean(), maps: z.boolean(),
}).strict();
export const chatRouteSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict();
export const chatRequestSchema = chatRouteSchema.extend({ sessionId: z.string().min(1) }).strict();
export const chatSetRequestSchema = chatRequestSchema.extend({
    choices: chatChoicesSchema, expectedRevision: z.number().int().nonnegative(),
}).strict();
export const chatSelectionSchema = chatRouteSchema.extend({ choices: chatChoicesSchema }).strict();
export const chatSourceSchema = z.object({ version: z.literal(1), selections: z.array(chatSelectionSchema) }).strict();
export const chatCapabilitiesSchema = chatChoicesSchema.extend({ functionCallingWithNativeTools: z.boolean() }).strict();
export const chatSnapshotSchema = chatRouteSchema.extend({
    capabilities: chatCapabilitiesSchema, choices: chatChoicesSchema, revision: z.number().int().nonnegative(),
}).strict();
const codec = (schema, typeSymbol) => ({ mode: 'strict', typeSymbol, create: () => schema });
const parameter = (schema, symbol) => ({
    name: 'request', source: 'json', codec: codec(schema, symbol), strictCodec: codec(schema, symbol),
});
/** Shared strict descriptors; the browser imports no Host implementation or credentials. */
export const chatRemoteInfo = createTypertRemoteInfo({
    package: '@forever-lwy/dsh-google-native',
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
}, z);
export async function getChatOptions(remote, request, signal) {
    const result = await chatRemoteInfo.methods['nativeGoogleChat/get'].invoke(remote, { request }, signal);
    if (!result.ok)
        throw new Error(result.error.message);
    return result.value;
}
export async function setChatOptions(remote, request, signal) {
    const result = await chatRemoteInfo.methods['nativeGoogleChat/set'].invoke(remote, { request }, signal);
    if (!result.ok)
        throw new Error(result.error.message);
    return result.value;
}
/** Invalid, legacy, or route-mismatched metadata never grants native capabilities. */
export function readChatChoices(source, provider, model) {
    if (typeof source !== 'object' || source === null || !('googleNative' in source))
        return undefined;
    const parsed = chatSourceSchema.safeParse(source.googleNative);
    if (!parsed.success)
        return undefined;
    return parsed.data.selections.find(selection => selection.provider === provider && selection.model === model)?.choices;
}
