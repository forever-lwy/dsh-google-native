import type { AttachmentStore, FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { GoogleGenAI, Part } from '@google/genai';
import type { GoogleInputType } from './config.js';
export interface NativeFileOptions {
    /** AI Studio uploads files above this size through the Gemini Files API. */
    inlineThresholdBytes?: number;
    /** Vertex rejects larger local files; use a native gs:// fileData part instead. */
    inlineMaxBytes?: number;
    maxFileBytes?: number;
    pollIntervalMs?: number;
    processingTimeoutMs?: number;
}
/** File names are display metadata only. No input is interpreted as a local path. */
export declare function detectMimeType(name: string, prefix: Uint8Array): string;
/** Model declarations constrain native inputs; they do not grant backend support. */
export declare function assertNativeInputType(type: GoogleInputType, allowed: readonly GoogleInputType[] | undefined): void;
/** Reads exclusively through the verified durable attachment store. */
export declare class NativeFileStore {
    private readonly client;
    private readonly backend;
    private readonly attachments;
    private readonly options;
    private readonly uploaded;
    constructor(client: GoogleGenAI, backend: 'ai-studio' | 'vertex', attachments: AttachmentStore, options?: NativeFileOptions);
    imagePart(ref: ImageAttachmentRef, signal?: AbortSignal, allowed?: readonly GoogleInputType[]): Promise<Part>;
    /** Inspect a bounded prefix of every input before any upload for this request starts. */
    validateInputType(ref: FileAttachmentRef, allowed: readonly GoogleInputType[], signal?: AbortSignal): Promise<void>;
    private validateSize;
    filePart(ref: FileAttachmentRef, signal?: AbortSignal, allowed?: readonly GoogleInputType[]): Promise<Part>;
    private upload;
    private waitForActive;
}
