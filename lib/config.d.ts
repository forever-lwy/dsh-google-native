import type { Volatile, VolatileSnapshot } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type RetryPolicyConfig } from '@deepseek-ai/dsh-llm';
import type { GenerateContentConfig } from '@google/genai';
import type { GoogleModelCapabilities } from './capabilities.js';
export declare const GOOGLE_PROVIDERS: readonly ["google-ai-studio", "google-vertex-native"];
export type GoogleProvider = typeof GOOGLE_PROVIDERS[number];
export type GoogleInputType = 'text' | 'image' | 'audio' | 'video' | 'pdf';
export type GoogleOutputType = 'text' | 'image' | 'audio';
export interface GoogleReasoningConfig {
    id: string;
    name: string;
    thinkingBudget?: number;
    thinkingLevel?: string;
    includeThoughts?: boolean;
}
export interface GoogleModelConfig {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    /** Explicit native input capabilities; omitted preserves legacy adapter behavior. */
    inputTypes?: GoogleInputType[];
    /** Supported native outputs, separate from the requested responseModalities. */
    outputTypes?: GoogleOutputType[];
    /** Explicit selectable settings; no model capabilities are guessed for custom IDs. */
    reasoning?: GoogleReasoningConfig[];
    defaultReasoning?: string;
    generationConfig?: GenerateContentConfig;
    /** Exact support overrides for custom models; unknown IDs expose no chat options by default. */
    capabilities?: GoogleModelCapabilities;
}
export interface GoogleFileOptions {
    inlineThresholdBytes?: number;
    inlineMaxBytes?: number;
    maxFileBytes?: number;
    pollIntervalMs?: number;
    processingTimeoutMs?: number;
}
export interface GoogleNativeTools {
    search?: boolean;
    urlContext?: boolean;
    codeExecution?: boolean;
    maps?: boolean;
}
export interface GoogleProfileOptions {
    enabled: boolean;
    /** Credential reference, never the API key itself. */
    apiKeyEnv: string;
    vertexAuth: 'adc' | 'api-key';
    project?: string;
    location?: string;
    /** Absolute path inside the dsh container; only used by Vertex ADC. */
    keyFile?: string;
    baseURL?: string;
    apiVersion?: string;
    models: GoogleModelConfig[];
    generationConfig: GenerateContentConfig;
    nativeTools: GoogleNativeTools;
    files: GoogleFileOptions;
    /** Executed by DSH's provider-owned retry service. */
    retryPolicy?: RetryPolicyConfig;
}
export interface GoogleProfile extends GoogleProfileOptions {
    provider: GoogleProvider;
}
export type Profiles = Record<GoogleProvider, GoogleProfile>;
export interface Config {
    aiStudio: Volatile<GoogleProfileOptions>;
    vertex: Volatile<GoogleProfileOptions>;
}
export declare const DEFAULT_MODELS: GoogleModelConfig[];
export declare function defaultProfile(provider: GoogleProvider): GoogleProfile;
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    aiStudio: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        apiKeyEnv: z<string, string, "defined">;
        vertexAuth: z<"adc" | "api-key", "adc" | "api-key", "defined">;
        project: z<string, string, "plain">;
        location: z<string, string, "defined">;
        keyFile: z<string, string, "plain">;
        baseURL: z<string, string, "plain">;
        apiVersion: z<string, string, "plain">;
        models: z<({
            id?: string | null | undefined;
            name?: string | null | undefined;
            contextWindow?: number | null | undefined;
            maxTokens?: number | null | undefined;
            inputTypes?: ("text" | "image" | "audio" | "video" | "pdf")[] | null | undefined;
            outputTypes?: ("text" | "image" | "audio")[] | null | undefined;
            reasoning?: ({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[] | null | undefined;
            defaultReasoning?: string | null | undefined;
            generationConfig?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
            capabilities?: ({
                nativeFiles?: boolean | null | undefined;
                search?: boolean | null | undefined;
                urlContext?: boolean | null | undefined;
                codeExecution?: boolean | null | undefined;
                maps?: boolean | null | undefined;
                functionCallingWithNativeTools?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "defined">;
            name: z<string, string, "plain">;
            contextWindow: z<number, number, "plain">;
            maxTokens: z<number, number, "plain">;
            inputTypes: z<("text" | "image" | "audio" | "video" | "pdf")[], ("text" | "image" | "audio" | "video" | "pdf")[], "plain">;
            outputTypes: z<("text" | "image" | "audio")[], ("text" | "image" | "audio")[], "plain">;
            reasoning: z<({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                id: z<string, string, "defined">;
                name: z<string, string, "defined">;
                thinkingBudget: z<number, number, "plain">;
                thinkingLevel: z<string, string, "plain">;
                includeThoughts: z<boolean, boolean, "plain">;
            }>>[], "plain">;
            defaultReasoning: z<string, string, "plain">;
            generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
            capabilities: z<Schemastery.ObjectS<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, Schemastery.ObjectT<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, "plain">;
        }>>[], "defined">;
        generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "defined">;
        nativeTools: z<Schemastery.ObjectS<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, "defined">;
        files: z<Schemastery.ObjectS<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, "defined">;
        retryPolicy: z<RetryPolicyConfig>;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        apiKeyEnv: z<string, string, "defined">;
        vertexAuth: z<"adc" | "api-key", "adc" | "api-key", "defined">;
        project: z<string, string, "plain">;
        location: z<string, string, "defined">;
        keyFile: z<string, string, "plain">;
        baseURL: z<string, string, "plain">;
        apiVersion: z<string, string, "plain">;
        models: z<({
            id?: string | null | undefined;
            name?: string | null | undefined;
            contextWindow?: number | null | undefined;
            maxTokens?: number | null | undefined;
            inputTypes?: ("text" | "image" | "audio" | "video" | "pdf")[] | null | undefined;
            outputTypes?: ("text" | "image" | "audio")[] | null | undefined;
            reasoning?: ({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[] | null | undefined;
            defaultReasoning?: string | null | undefined;
            generationConfig?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
            capabilities?: ({
                nativeFiles?: boolean | null | undefined;
                search?: boolean | null | undefined;
                urlContext?: boolean | null | undefined;
                codeExecution?: boolean | null | undefined;
                maps?: boolean | null | undefined;
                functionCallingWithNativeTools?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "defined">;
            name: z<string, string, "plain">;
            contextWindow: z<number, number, "plain">;
            maxTokens: z<number, number, "plain">;
            inputTypes: z<("text" | "image" | "audio" | "video" | "pdf")[], ("text" | "image" | "audio" | "video" | "pdf")[], "plain">;
            outputTypes: z<("text" | "image" | "audio")[], ("text" | "image" | "audio")[], "plain">;
            reasoning: z<({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                id: z<string, string, "defined">;
                name: z<string, string, "defined">;
                thinkingBudget: z<number, number, "plain">;
                thinkingLevel: z<string, string, "plain">;
                includeThoughts: z<boolean, boolean, "plain">;
            }>>[], "plain">;
            defaultReasoning: z<string, string, "plain">;
            generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
            capabilities: z<Schemastery.ObjectS<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, Schemastery.ObjectT<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, "plain">;
        }>>[], "defined">;
        generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "defined">;
        nativeTools: z<Schemastery.ObjectS<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, "defined">;
        files: z<Schemastery.ObjectS<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, "defined">;
        retryPolicy: z<RetryPolicyConfig>;
    }>>>, "volatile-defined">;
    vertex: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        apiKeyEnv: z<string, string, "defined">;
        vertexAuth: z<"adc" | "api-key", "adc" | "api-key", "defined">;
        project: z<string, string, "plain">;
        location: z<string, string, "defined">;
        keyFile: z<string, string, "plain">;
        baseURL: z<string, string, "plain">;
        apiVersion: z<string, string, "plain">;
        models: z<({
            id?: string | null | undefined;
            name?: string | null | undefined;
            contextWindow?: number | null | undefined;
            maxTokens?: number | null | undefined;
            inputTypes?: ("text" | "image" | "audio" | "video" | "pdf")[] | null | undefined;
            outputTypes?: ("text" | "image" | "audio")[] | null | undefined;
            reasoning?: ({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[] | null | undefined;
            defaultReasoning?: string | null | undefined;
            generationConfig?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
            capabilities?: ({
                nativeFiles?: boolean | null | undefined;
                search?: boolean | null | undefined;
                urlContext?: boolean | null | undefined;
                codeExecution?: boolean | null | undefined;
                maps?: boolean | null | undefined;
                functionCallingWithNativeTools?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "defined">;
            name: z<string, string, "plain">;
            contextWindow: z<number, number, "plain">;
            maxTokens: z<number, number, "plain">;
            inputTypes: z<("text" | "image" | "audio" | "video" | "pdf")[], ("text" | "image" | "audio" | "video" | "pdf")[], "plain">;
            outputTypes: z<("text" | "image" | "audio")[], ("text" | "image" | "audio")[], "plain">;
            reasoning: z<({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                id: z<string, string, "defined">;
                name: z<string, string, "defined">;
                thinkingBudget: z<number, number, "plain">;
                thinkingLevel: z<string, string, "plain">;
                includeThoughts: z<boolean, boolean, "plain">;
            }>>[], "plain">;
            defaultReasoning: z<string, string, "plain">;
            generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
            capabilities: z<Schemastery.ObjectS<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, Schemastery.ObjectT<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, "plain">;
        }>>[], "defined">;
        generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "defined">;
        nativeTools: z<Schemastery.ObjectS<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, "defined">;
        files: z<Schemastery.ObjectS<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, "defined">;
        retryPolicy: z<RetryPolicyConfig>;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        apiKeyEnv: z<string, string, "defined">;
        vertexAuth: z<"adc" | "api-key", "adc" | "api-key", "defined">;
        project: z<string, string, "plain">;
        location: z<string, string, "defined">;
        keyFile: z<string, string, "plain">;
        baseURL: z<string, string, "plain">;
        apiVersion: z<string, string, "plain">;
        models: z<({
            id?: string | null | undefined;
            name?: string | null | undefined;
            contextWindow?: number | null | undefined;
            maxTokens?: number | null | undefined;
            inputTypes?: ("text" | "image" | "audio" | "video" | "pdf")[] | null | undefined;
            outputTypes?: ("text" | "image" | "audio")[] | null | undefined;
            reasoning?: ({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[] | null | undefined;
            defaultReasoning?: string | null | undefined;
            generationConfig?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
            capabilities?: ({
                nativeFiles?: boolean | null | undefined;
                search?: boolean | null | undefined;
                urlContext?: boolean | null | undefined;
                codeExecution?: boolean | null | undefined;
                maps?: boolean | null | undefined;
                functionCallingWithNativeTools?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "defined">;
            name: z<string, string, "plain">;
            contextWindow: z<number, number, "plain">;
            maxTokens: z<number, number, "plain">;
            inputTypes: z<("text" | "image" | "audio" | "video" | "pdf")[], ("text" | "image" | "audio" | "video" | "pdf")[], "plain">;
            outputTypes: z<("text" | "image" | "audio")[], ("text" | "image" | "audio")[], "plain">;
            reasoning: z<({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                id: z<string, string, "defined">;
                name: z<string, string, "defined">;
                thinkingBudget: z<number, number, "plain">;
                thinkingLevel: z<string, string, "plain">;
                includeThoughts: z<boolean, boolean, "plain">;
            }>>[], "plain">;
            defaultReasoning: z<string, string, "plain">;
            generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
            capabilities: z<Schemastery.ObjectS<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, Schemastery.ObjectT<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, "plain">;
        }>>[], "defined">;
        generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "defined">;
        nativeTools: z<Schemastery.ObjectS<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, "defined">;
        files: z<Schemastery.ObjectS<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, "defined">;
        retryPolicy: z<RetryPolicyConfig>;
    }>>>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    aiStudio: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        apiKeyEnv: z<string, string, "defined">;
        vertexAuth: z<"adc" | "api-key", "adc" | "api-key", "defined">;
        project: z<string, string, "plain">;
        location: z<string, string, "defined">;
        keyFile: z<string, string, "plain">;
        baseURL: z<string, string, "plain">;
        apiVersion: z<string, string, "plain">;
        models: z<({
            id?: string | null | undefined;
            name?: string | null | undefined;
            contextWindow?: number | null | undefined;
            maxTokens?: number | null | undefined;
            inputTypes?: ("text" | "image" | "audio" | "video" | "pdf")[] | null | undefined;
            outputTypes?: ("text" | "image" | "audio")[] | null | undefined;
            reasoning?: ({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[] | null | undefined;
            defaultReasoning?: string | null | undefined;
            generationConfig?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
            capabilities?: ({
                nativeFiles?: boolean | null | undefined;
                search?: boolean | null | undefined;
                urlContext?: boolean | null | undefined;
                codeExecution?: boolean | null | undefined;
                maps?: boolean | null | undefined;
                functionCallingWithNativeTools?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "defined">;
            name: z<string, string, "plain">;
            contextWindow: z<number, number, "plain">;
            maxTokens: z<number, number, "plain">;
            inputTypes: z<("text" | "image" | "audio" | "video" | "pdf")[], ("text" | "image" | "audio" | "video" | "pdf")[], "plain">;
            outputTypes: z<("text" | "image" | "audio")[], ("text" | "image" | "audio")[], "plain">;
            reasoning: z<({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                id: z<string, string, "defined">;
                name: z<string, string, "defined">;
                thinkingBudget: z<number, number, "plain">;
                thinkingLevel: z<string, string, "plain">;
                includeThoughts: z<boolean, boolean, "plain">;
            }>>[], "plain">;
            defaultReasoning: z<string, string, "plain">;
            generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
            capabilities: z<Schemastery.ObjectS<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, Schemastery.ObjectT<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, "plain">;
        }>>[], "defined">;
        generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "defined">;
        nativeTools: z<Schemastery.ObjectS<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, "defined">;
        files: z<Schemastery.ObjectS<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, "defined">;
        retryPolicy: z<RetryPolicyConfig>;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        apiKeyEnv: z<string, string, "defined">;
        vertexAuth: z<"adc" | "api-key", "adc" | "api-key", "defined">;
        project: z<string, string, "plain">;
        location: z<string, string, "defined">;
        keyFile: z<string, string, "plain">;
        baseURL: z<string, string, "plain">;
        apiVersion: z<string, string, "plain">;
        models: z<({
            id?: string | null | undefined;
            name?: string | null | undefined;
            contextWindow?: number | null | undefined;
            maxTokens?: number | null | undefined;
            inputTypes?: ("text" | "image" | "audio" | "video" | "pdf")[] | null | undefined;
            outputTypes?: ("text" | "image" | "audio")[] | null | undefined;
            reasoning?: ({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[] | null | undefined;
            defaultReasoning?: string | null | undefined;
            generationConfig?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
            capabilities?: ({
                nativeFiles?: boolean | null | undefined;
                search?: boolean | null | undefined;
                urlContext?: boolean | null | undefined;
                codeExecution?: boolean | null | undefined;
                maps?: boolean | null | undefined;
                functionCallingWithNativeTools?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "defined">;
            name: z<string, string, "plain">;
            contextWindow: z<number, number, "plain">;
            maxTokens: z<number, number, "plain">;
            inputTypes: z<("text" | "image" | "audio" | "video" | "pdf")[], ("text" | "image" | "audio" | "video" | "pdf")[], "plain">;
            outputTypes: z<("text" | "image" | "audio")[], ("text" | "image" | "audio")[], "plain">;
            reasoning: z<({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                id: z<string, string, "defined">;
                name: z<string, string, "defined">;
                thinkingBudget: z<number, number, "plain">;
                thinkingLevel: z<string, string, "plain">;
                includeThoughts: z<boolean, boolean, "plain">;
            }>>[], "plain">;
            defaultReasoning: z<string, string, "plain">;
            generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
            capabilities: z<Schemastery.ObjectS<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, Schemastery.ObjectT<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, "plain">;
        }>>[], "defined">;
        generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "defined">;
        nativeTools: z<Schemastery.ObjectS<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, "defined">;
        files: z<Schemastery.ObjectS<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, "defined">;
        retryPolicy: z<RetryPolicyConfig>;
    }>>>, "volatile-defined">;
    vertex: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        apiKeyEnv: z<string, string, "defined">;
        vertexAuth: z<"adc" | "api-key", "adc" | "api-key", "defined">;
        project: z<string, string, "plain">;
        location: z<string, string, "defined">;
        keyFile: z<string, string, "plain">;
        baseURL: z<string, string, "plain">;
        apiVersion: z<string, string, "plain">;
        models: z<({
            id?: string | null | undefined;
            name?: string | null | undefined;
            contextWindow?: number | null | undefined;
            maxTokens?: number | null | undefined;
            inputTypes?: ("text" | "image" | "audio" | "video" | "pdf")[] | null | undefined;
            outputTypes?: ("text" | "image" | "audio")[] | null | undefined;
            reasoning?: ({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[] | null | undefined;
            defaultReasoning?: string | null | undefined;
            generationConfig?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
            capabilities?: ({
                nativeFiles?: boolean | null | undefined;
                search?: boolean | null | undefined;
                urlContext?: boolean | null | undefined;
                codeExecution?: boolean | null | undefined;
                maps?: boolean | null | undefined;
                functionCallingWithNativeTools?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "defined">;
            name: z<string, string, "plain">;
            contextWindow: z<number, number, "plain">;
            maxTokens: z<number, number, "plain">;
            inputTypes: z<("text" | "image" | "audio" | "video" | "pdf")[], ("text" | "image" | "audio" | "video" | "pdf")[], "plain">;
            outputTypes: z<("text" | "image" | "audio")[], ("text" | "image" | "audio")[], "plain">;
            reasoning: z<({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                id: z<string, string, "defined">;
                name: z<string, string, "defined">;
                thinkingBudget: z<number, number, "plain">;
                thinkingLevel: z<string, string, "plain">;
                includeThoughts: z<boolean, boolean, "plain">;
            }>>[], "plain">;
            defaultReasoning: z<string, string, "plain">;
            generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
            capabilities: z<Schemastery.ObjectS<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, Schemastery.ObjectT<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, "plain">;
        }>>[], "defined">;
        generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "defined">;
        nativeTools: z<Schemastery.ObjectS<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, "defined">;
        files: z<Schemastery.ObjectS<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, "defined">;
        retryPolicy: z<RetryPolicyConfig>;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        enabled: z<boolean, boolean, "defined">;
        apiKeyEnv: z<string, string, "defined">;
        vertexAuth: z<"adc" | "api-key", "adc" | "api-key", "defined">;
        project: z<string, string, "plain">;
        location: z<string, string, "defined">;
        keyFile: z<string, string, "plain">;
        baseURL: z<string, string, "plain">;
        apiVersion: z<string, string, "plain">;
        models: z<({
            id?: string | null | undefined;
            name?: string | null | undefined;
            contextWindow?: number | null | undefined;
            maxTokens?: number | null | undefined;
            inputTypes?: ("text" | "image" | "audio" | "video" | "pdf")[] | null | undefined;
            outputTypes?: ("text" | "image" | "audio")[] | null | undefined;
            reasoning?: ({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[] | null | undefined;
            defaultReasoning?: string | null | undefined;
            generationConfig?: import("@deepseek-ai/cosmokit").Dict<any, string> | null | undefined;
            capabilities?: ({
                nativeFiles?: boolean | null | undefined;
                search?: boolean | null | undefined;
                urlContext?: boolean | null | undefined;
                codeExecution?: boolean | null | undefined;
                maps?: boolean | null | undefined;
                functionCallingWithNativeTools?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict) | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            id: z<string, string, "defined">;
            name: z<string, string, "plain">;
            contextWindow: z<number, number, "plain">;
            maxTokens: z<number, number, "plain">;
            inputTypes: z<("text" | "image" | "audio" | "video" | "pdf")[], ("text" | "image" | "audio" | "video" | "pdf")[], "plain">;
            outputTypes: z<("text" | "image" | "audio")[], ("text" | "image" | "audio")[], "plain">;
            reasoning: z<({
                id?: string | null | undefined;
                name?: string | null | undefined;
                thinkingBudget?: number | null | undefined;
                thinkingLevel?: string | null | undefined;
                includeThoughts?: boolean | null | undefined;
            } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
                id: z<string, string, "defined">;
                name: z<string, string, "defined">;
                thinkingBudget: z<number, number, "plain">;
                thinkingLevel: z<string, string, "plain">;
                includeThoughts: z<boolean, boolean, "plain">;
            }>>[], "plain">;
            defaultReasoning: z<string, string, "plain">;
            generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "plain">;
            capabilities: z<Schemastery.ObjectS<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, Schemastery.ObjectT<NoInfer<{
                nativeFiles: z<boolean, boolean, "plain">;
                search: z<boolean, boolean, "plain">;
                urlContext: z<boolean, boolean, "plain">;
                codeExecution: z<boolean, boolean, "plain">;
                maps: z<boolean, boolean, "plain">;
                functionCallingWithNativeTools: z<boolean, boolean, "plain">;
            }>>, "plain">;
        }>>[], "defined">;
        generationConfig: z<import("@deepseek-ai/cosmokit").Dict<any, string>, import("@deepseek-ai/cosmokit").Dict<any, string>, "defined">;
        nativeTools: z<Schemastery.ObjectS<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            search: z<boolean, boolean, "plain">;
            urlContext: z<boolean, boolean, "plain">;
            codeExecution: z<boolean, boolean, "plain">;
            maps: z<boolean, boolean, "plain">;
        }>>, "defined">;
        files: z<Schemastery.ObjectS<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, Schemastery.ObjectT<NoInfer<{
            inlineThresholdBytes: z<number, number, "plain">;
            inlineMaxBytes: z<number, number, "plain">;
            maxFileBytes: z<number, number, "plain">;
            pollIntervalMs: z<number, number, "plain">;
            processingTimeoutMs: z<number, number, "plain">;
        }>>, "defined">;
        retryPolicy: z<RetryPolicyConfig>;
    }>>>, "volatile-defined">;
}>>, "plain">;
/** Capture an independent, validated generation so edits cannot affect an in-flight request. */
export declare function profilesOf(config: Config): Profiles;
export declare function validateProfile(provider: GoogleProvider, input: VolatileSnapshot<GoogleProfileOptions>): GoogleProfile;
