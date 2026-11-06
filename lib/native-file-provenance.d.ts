import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
export declare const NATIVE_FILE_TOOL = "google_native_attach_file";
/** These producers require a verified receipt even when user uploads use native mode. */
export declare function explicitNativeFileMessages(options: GenerateOptions): Set<string>;
/** Authorize references from committed outcomes, never from textual handles or tool arguments. */
export declare function verifiedNativeFileMessages(options: GenerateOptions, events: readonly SessionEvent[]): Set<string>;
