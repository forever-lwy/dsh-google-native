import { LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateContentConfig } from '@google/genai'

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LlmError(`原生 REST ${field} 必须是对象，才能应用模型高级设置。`, 'INVALID_CONFIG')
  }
  return value as Record<string, unknown>
}

/** Explicit model controls own their REST aliases; keep unrelated native fields. */
export function withoutRawModelOverrides(config: GenerateContentConfig, owned: {
  output: boolean; maxTokens: boolean; thinkingMode: boolean; includeThoughts: boolean
}): GenerateContentConfig {
  if (!Object.values(owned).some(Boolean) || !config.httpOptions?.extraBody) return config
  const extraBody = { ...config.httpOptions.extraBody }
  const generations = ['generation_config', 'generationConfig']
    .filter(key => extraBody[key] !== undefined).map(key => record(extraBody[key], key))
  if (!generations.length) return config
  // Emitting both wrappers creates duplicate protobuf fields. Camel case wins
  // raw conflicts, and the explicit model fields are applied by the SDK.
  const generation = Object.assign({}, ...generations) as Record<string, unknown>
  if (owned.output) for (const key of ['responseModalities', 'response_modalities']) delete generation[key]
  if (owned.maxTokens) for (const key of ['maxOutputTokens', 'max_output_tokens']) delete generation[key]
  if (owned.thinkingMode || owned.includeThoughts) {
    const thinking: Record<string, unknown> = {}
    for (const raw of generations) for (const key of ['thinking_config', 'thinkingConfig']) {
      if (raw[key] === undefined) continue
      const normalized = { ...record(raw[key], key) }
      // Unowned raw settings retain their override behavior without producing
      // a second spelling of a field already serialized by the SDK.
      for (const [alias, canonical] of [['thinking_budget', 'thinkingBudget'], ['thinking_level', 'thinkingLevel'], ['include_thoughts', 'includeThoughts']]) {
        if (normalized[canonical] === undefined && normalized[alias] !== undefined) normalized[canonical] = normalized[alias]
        delete normalized[alias]
      }
      Object.assign(thinking, normalized)
    }
    if (owned.thinkingMode) for (const key of ['thinkingBudget', 'thinkingLevel']) delete thinking[key]
    if (owned.includeThoughts) delete thinking.includeThoughts
    delete generation.thinking_config
    if (Object.keys(thinking).length) generation.thinkingConfig = thinking
    else delete generation.thinkingConfig
  }
  delete extraBody.generation_config
  if (Object.keys(generation).length) extraBody.generationConfig = generation
  else delete extraBody.generationConfig
  return { ...config, httpOptions: { ...config.httpOptions, extraBody } }
}
