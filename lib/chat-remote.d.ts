import { z } from 'zod';
import type { RemoteResult, TypertClientRemote, TypertRemoteInfo, TypertRemoteMethod } from '@deepseek-ai/dsh-typert-protocol';
export declare const chatChoicesSchema: z.ZodObject<{
    nativeFiles: z.ZodBoolean;
    search: z.ZodBoolean;
    urlContext: z.ZodBoolean;
    codeExecution: z.ZodBoolean;
    maps: z.ZodBoolean;
}, z.core.$strict>;
export type GoogleChatChoices = z.infer<typeof chatChoicesSchema>;
export declare const chatRouteSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
}, z.core.$strict>;
export declare const chatRequestSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    sessionId: z.ZodString;
}, z.core.$strict>;
export type GoogleChatRequest = z.infer<typeof chatRequestSchema>;
export declare const chatSetRequestSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    sessionId: z.ZodString;
    choices: z.ZodObject<{
        nativeFiles: z.ZodBoolean;
        search: z.ZodBoolean;
        urlContext: z.ZodBoolean;
        codeExecution: z.ZodBoolean;
        maps: z.ZodBoolean;
    }, z.core.$strict>;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>;
export type GoogleChatSetRequest = z.infer<typeof chatSetRequestSchema>;
export declare const chatSelectionSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    choices: z.ZodObject<{
        nativeFiles: z.ZodBoolean;
        search: z.ZodBoolean;
        urlContext: z.ZodBoolean;
        codeExecution: z.ZodBoolean;
        maps: z.ZodBoolean;
    }, z.core.$strict>;
}, z.core.$strict>;
export type GoogleChatSelectionSnapshot = z.infer<typeof chatSelectionSchema>;
export declare const chatSourceSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    selections: z.ZodArray<z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        choices: z.ZodObject<{
            nativeFiles: z.ZodBoolean;
            search: z.ZodBoolean;
            urlContext: z.ZodBoolean;
            codeExecution: z.ZodBoolean;
            maps: z.ZodBoolean;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type GoogleChatSourceSnapshot = z.infer<typeof chatSourceSchema>;
export declare const chatCapabilitiesSchema: z.ZodObject<{
    nativeFiles: z.ZodBoolean;
    search: z.ZodBoolean;
    urlContext: z.ZodBoolean;
    codeExecution: z.ZodBoolean;
    maps: z.ZodBoolean;
    functionCallingWithNativeTools: z.ZodBoolean;
}, z.core.$strict>;
export declare const chatSnapshotSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    capabilities: z.ZodObject<{
        nativeFiles: z.ZodBoolean;
        search: z.ZodBoolean;
        urlContext: z.ZodBoolean;
        codeExecution: z.ZodBoolean;
        maps: z.ZodBoolean;
        functionCallingWithNativeTools: z.ZodBoolean;
    }, z.core.$strict>;
    choices: z.ZodObject<{
        nativeFiles: z.ZodBoolean;
        search: z.ZodBoolean;
        urlContext: z.ZodBoolean;
        codeExecution: z.ZodBoolean;
        maps: z.ZodBoolean;
    }, z.core.$strict>;
    revision: z.ZodNumber;
}, z.core.$strict>;
export type GoogleChatSnapshot = z.infer<typeof chatSnapshotSchema>;
type GetMethod = TypertRemoteMethod<{
    request: GoogleChatRequest;
}, GoogleChatSnapshot>;
type SetMethod = TypertRemoteMethod<{
    request: GoogleChatSetRequest;
}, GoogleChatSnapshot>;
/** Shared strict descriptors; the browser imports no Host implementation or credentials. */
export declare const chatRemoteInfo: TypertRemoteInfo<{
    "nativeGoogleChat/get": GetMethod;
    "nativeGoogleChat/set": SetMethod;
}>;
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertRemoteMap {
        'nativeGoogleChat/get': (request: GoogleChatRequest, signal?: AbortSignal) => Promise<RemoteResult<GoogleChatSnapshot>>;
        'nativeGoogleChat/set': (request: GoogleChatSetRequest, signal?: AbortSignal) => Promise<RemoteResult<GoogleChatSnapshot>>;
    }
    interface TypertRemoteNamespaceMap {
        nativeGoogleChat: {
            get(request: GoogleChatRequest, signal?: AbortSignal): Promise<RemoteResult<GoogleChatSnapshot>>;
            set(request: GoogleChatSetRequest, signal?: AbortSignal): Promise<RemoteResult<GoogleChatSnapshot>>;
        };
    }
    interface RemoteErrorDetailsMap {
        'native-google/conflict': {
            revision: number;
        };
    }
}
export declare function getChatOptions(remote: TypertClientRemote, request: GoogleChatRequest, signal?: AbortSignal): Promise<GoogleChatSnapshot>;
export declare function setChatOptions(remote: TypertClientRemote, request: GoogleChatSetRequest, signal?: AbortSignal): Promise<GoogleChatSnapshot>;
/** Invalid, legacy, or route-mismatched metadata never grants native capabilities. */
export declare function readChatChoices(source: unknown, provider: string, model: string): GoogleChatChoices | undefined;
export {};
