import type { GenerateContentConfig } from '@google/genai';
/** Explicit model controls own their REST aliases; keep unrelated native fields. */
export declare function withoutRawModelOverrides(config: GenerateContentConfig, owned: {
    output: boolean;
    maxTokens: boolean;
    thinkingMode: boolean;
    includeThoughts: boolean;
}): GenerateContentConfig;
