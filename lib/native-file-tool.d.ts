import type { Context } from '@deepseek-ai/cordis';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { type Profiles } from './config.js';
export declare const GOOGLE_NATIVE_FILE_TOOL = "google_native_attach_file";
export interface NativeFileToolReceipt {
    version: 1;
    sessionId: string;
    provider: string;
    model: string;
    callId: string;
    rootCallId: string;
    attachment: FileAttachmentRef;
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'google-native-file': {
            kind: 'google-native-file';
            googleNativeFile: NativeFileToolReceipt;
        };
    }
}
/** Attach exact workspace bytes to the current conversation. No parser, image
 * normalizer, external model request, or credential resolver participates. */
export declare function registerNativeFileTool(ctx: Context, profiles: () => Profiles): void;
