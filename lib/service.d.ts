import { Context, Service } from '@deepseek-ai/cordis';
import type { GenerateContentParameters, GoogleGenAI } from '@google/genai';
import type { GoogleNativeAdapter } from './adapter.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        nativeGoogle: GoogleNativeService;
    }
}
/** Trusted host-plugin API: the full official SDK, including non-chat APIs. */
export declare class GoogleNativeService extends Service {
    private readonly adapter;
    constructor(ctx: Context, adapter: GoogleNativeAdapter);
    client(provider: string): Promise<GoogleGenAI>;
    generate(provider: string, parameters: GenerateContentParameters): Promise<import("@google/genai").GenerateContentResponse>;
    stream(provider: string, parameters: GenerateContentParameters): Promise<AsyncGenerator<import("@google/genai").GenerateContentResponse, any, any>>;
}
