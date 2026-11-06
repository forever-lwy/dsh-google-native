import type { GoogleGenAI } from '@google/genai';
import type { GoogleInputType, GoogleOutputType } from './config.js';
export interface DiscoveredGoogleModel {
    id: string;
    name: string;
    description?: string;
    contextWindow?: number;
    maxTokens?: number;
    /** Supported types reported by the catalog, not requested response formats. */
    inputTypes?: GoogleInputType[];
    outputTypes?: GoogleOutputType[];
    /** Absence means that the catalog did not disclose an action list. */
    supportsGenerateContent?: boolean;
}
/**
 * Discover metadata only, through the configured native SDK endpoint and auth.
 * The pinned SDK drops catalog modality metadata and Vertex token limits.
 * Capture the same list responses locally, retaining SDK auth and pagination.
 * Official catalogs may omit these fields; absence remains manual/unknown.
 */
export declare function discoverGoogleModels(client: GoogleGenAI, backend: 'ai-studio' | 'vertex', signal?: AbortSignal): Promise<DiscoveredGoogleModel[]>;
