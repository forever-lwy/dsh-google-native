import { type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import type { GenerateContentResponse } from '@google/genai';
/** Stream raw Parts, retaining signatures on their exact native Part for replay. */
export declare function translateStream(stream: AsyncIterable<GenerateContentResponse>, options: GenerateOptions, attachments: AttachmentStore): AsyncGenerator<StreamChunk>;
