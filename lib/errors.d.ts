import { LlmError } from '@deepseek-ai/dsh-llm';
/** Keep credentials, request payloads and provider debug bodies out of errors. */
export declare function googleError(error: unknown, signal?: AbortSignal): LlmError;
