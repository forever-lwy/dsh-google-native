import type { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, type GenerateOptions, type LlmModelInfo, type LlmResolvedModelInfo, type PreparedAdapterCall, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { GoogleGenAI, type GenerateContentConfig, type GoogleGenAIOptions } from '@google/genai';
import { type GoogleProfile, type GoogleModelConfig, type Profiles } from './config.js';
export interface GoogleAdapterOptions {
    profiles: () => Profiles;
    resolveApiKey: (profile: GoogleProfile) => Promise<string | undefined>;
    /** Dependency injection for offline protocol tests. */
    createClient?: (options: GoogleGenAIOptions) => GoogleGenAI;
}
export declare class GoogleNativeAdapter extends LlmAdapter {
    private readonly ctx;
    private readonly options;
    private readonly connections;
    constructor(ctx: Context, options: GoogleAdapterOptions);
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    providerRetryPolicy(provider: string): import("@deepseek-ai/dsh-llm").ResolvedRetryPolicy;
    private profile;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    private modelInfo;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>;
    /** All public methods of the pinned official SDK remain available to trusted host plugins. */
    client(provider: string): Promise<GoogleGenAI>;
    private connection;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private streamProfile;
}
/** Per-call DSH controls take priority over model settings, then profile settings. */
export declare function buildGenerationConfig(profile: GoogleProfile, model: GoogleModelConfig | undefined, options: GenerateOptions): GenerateContentConfig;
