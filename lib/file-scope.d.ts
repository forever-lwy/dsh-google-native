import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm';
/**
 * rc.5 projects FileBlocks to text inside its adapter boundary. Retain only
 * their immutable references for the native Google serializer; still dispatch
 * through next() so core validation, replay isolation and failures apply.
 */
export declare function registerNativeFileBridge(ctx: Context): void;
export declare function withNativeFileContext(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>, authorized?: Set<string>): AsyncIterable<StreamChunk>;
/** Keep core's local read-only handles alongside native input bytes. Assistant
 * media retains its original block shape for exact provider replay. */
export declare function restoreNativeFiles(options: GenerateOptions): GenerateOptions;
/** Used only while serializing the same verified request in its async scope. */
export declare function isVerifiedNativeFileResult(message: RequestMessage, options: GenerateOptions): boolean;
