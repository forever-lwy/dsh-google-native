import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { Content } from '@google/genai';
import { type NativeFileStore } from './files.js';
import type { GoogleInputType } from './config.js';
export declare function translateMessages(options: GenerateOptions, files: NativeFileStore, inputTypes?: readonly GoogleInputType[]): Promise<{
    contents: Content[];
    systemInstruction?: Content;
}>;
