import type { Context } from '@deepseek-ai/cordis';
import { GoogleGenAI, type GoogleGenAIOptions } from '@google/genai';
import type { GoogleProfile } from './config.js';
export interface NativeEndpoint {
    baseURL?: string;
    apiVersion?: string;
}
/** Accept native API roots or version-suffixed roots without duplicating the API version. */
export declare function normalizeNativeEndpoint(baseURL: string | undefined, apiVersion: string | undefined): NativeEndpoint;
/** Re-resolve stored references on every operation, including unsaved discovery drafts. */
export declare function resolveGoogleApiKey(ctx: Context, profile: GoogleProfile): Promise<string | undefined>;
/** Shared by chat and read-only model discovery; drafts may describe disabled profiles. */
export declare function createNativeGoogleClient(profile: GoogleProfile, rawKey?: string, construct?: (options: GoogleGenAIOptions) => GoogleGenAI): GoogleGenAI;
