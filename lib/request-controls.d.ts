import { type GenerateOptions, type RequestMessage } from '@deepseek-ai/dsh-llm';
import { type GoogleChatChoices } from './chat-remote.js';
/** The newest human prompt owns this turn; never carry an older prompt's switches forward. */
export declare function latestChatChoices(options: GenerateOptions): GoogleChatChoices | undefined;
/** Upload mode belongs to the originating message, including after resume or a later toggle. */
export declare function usesNativeFiles(message: RequestMessage, options: GenerateOptions): boolean;
