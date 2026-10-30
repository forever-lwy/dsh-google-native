import type { GenerateContentConfig, Tool } from '@google/genai'
import type { GoogleModelConfig, GoogleProfile } from './config.js'

/** Explicit model capabilities used to decide which chat controls may be shown. */
export interface GoogleModelCapabilities {
  nativeFiles?: boolean
  search?: boolean
  urlContext?: boolean
  codeExecution?: boolean
  maps?: boolean
  /** Whether this connection can retain local function tools alongside native tools. */
  functionCallingWithNativeTools?: boolean
}

export const CAPABILITY_KEYS = ['nativeFiles', 'search', 'urlContext', 'codeExecution', 'maps'] as const
export type GoogleCapabilityKey = typeof CAPABILITY_KEYS[number]
export type ResolvedGoogleCapabilities = Required<GoogleModelCapabilities>
export type NativeToolKey = Exclude<GoogleCapabilityKey, 'nativeFiles'>
export type NativeToolChoices = Partial<Record<NativeToolKey, boolean>>

export const NATIVE_TOOL_FIELDS = {
  search: 'googleSearch', urlContext: 'urlContext', codeExecution: 'codeExecution', maps: 'googleMaps',
} as const

const TOOL_ALIASES: Record<NativeToolKey, readonly string[]> = {
  search: ['googleSearch', 'google_search', 'googleSearchRetrieval', 'google_search_retrieval'],
  urlContext: ['urlContext', 'url_context'],
  codeExecution: ['codeExecution', 'code_execution'],
  maps: ['googleMaps', 'google_maps'],
}

const noCapabilities = (): ResolvedGoogleCapabilities => ({
  nativeFiles: false, search: false, urlContext: false, codeExecution: false, maps: false,
  functionCallingWithNativeTools: false,
})

// Checked against official, exact model pages on 2026-10-31 (client timezone).
// https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash
// https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
// https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
// https://ai.google.dev/gemini-api/docs/models/gemini-4-argon
// https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash
// https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-pro
// https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-8-flash
// https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/4-argon
// The Vertex Maps guide additionally lists both 2.5 models explicitly:
// https://docs.cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-maps
const knownModels = new Set(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.8-flash', 'gemini-4-argon'])

/** No family/prefix matching: an unknown ID only exposes explicitly declared capabilities. */
export function resolveCapabilities(
  provider: string,
  model: { id: string; capabilities?: GoogleModelCapabilities } | undefined,
): ResolvedGoogleCapabilities {
  const result = noCapabilities()
  if (!model || !['google-ai-studio', 'google-vertex-native'].includes(provider)) return result
  const known = knownModels.has(model.id)
  for (const key of CAPABILITY_KEYS) result[key] = model.capabilities?.[key] ?? known
  // AI Studio's documented mixed-tool mode requires tool context circulation.
  // The pinned SDK explicitly rejects that mode's flag on Vertex. Keep Vertex
  // mixed-tool dispatch conservative unless this exact connection opts in.
  // https://ai.google.dev/gemini-api/docs/generate-content/tool-combination
  // https://ai.google.dev/gemini-api/docs/generate-content/code-execution
  result.functionCallingWithNativeTools = model.capabilities?.functionCallingWithNativeTools
    ?? (provider === 'google-ai-studio' && ['gemini-3.8-flash', 'gemini-4-argon'].includes(model.id))
  return result
}

/** The host rejects these selections before any upload or model API request. */
export function unsupportedChoices(
  capabilities: ResolvedGoogleCapabilities,
  choices: GoogleModelCapabilities,
): GoogleCapabilityKey[] {
  return CAPABILITY_KEYS.filter(key => choices[key] === true && !capabilities[key])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The final raw REST tools list takes precedence over SDK-shaped tools. */
export function activeNativeToolChoices(config: GenerateContentConfig): Record<NativeToolKey, boolean> {
  const raw = config.httpOptions?.extraBody?.tools
  const tools: readonly unknown[] = Array.isArray(raw) ? raw : config.tools ?? []
  const choices: Record<NativeToolKey, boolean> = { search: false, urlContext: false, codeExecution: false, maps: false }
  for (const key of Object.keys(NATIVE_TOOL_FIELDS) as NativeToolKey[]) {
    choices[key] = tools.some(tool => isRecord(tool) && TOOL_ALIASES[key].some(field => Object.hasOwn(tool, field)))
  }
  return choices
}

/** Actual configured tool defaults, before any explicit per-conversation choices. */
export function configuredToolChoices(profile: GoogleProfile, model: GoogleModelConfig | undefined): Record<NativeToolKey, boolean> {
  const base = profile.generationConfig
  const override = model?.generationConfig ?? {}
  const config: GenerateContentConfig = { ...base, ...override, httpOptions: { ...base.httpOptions, ...override.httpOptions } }
  const tools: Tool[] = [...config.tools as Tool[] ?? []]
  for (const key of Object.keys(NATIVE_TOOL_FIELDS) as NativeToolKey[]) {
    if (profile.nativeTools[key] && !tools.some(tool => Object.hasOwn(tool, NATIVE_TOOL_FIELDS[key]))) {
      tools.push({ [NATIVE_TOOL_FIELDS[key]]: {} })
    }
  }
  config.tools = tools
  return activeNativeToolChoices(config)
}

/** Preserve other declarations even when a Tool contains several native tool keys. */
function changeTools(input: readonly unknown[], choices: NativeToolChoices): Record<string, unknown>[] {
  const output = input.map(value => {
    if (!isRecord(value)) throw new TypeError('Google tools must be JSON objects to apply chat options.')
    return { ...value }
  })
  for (const key of Object.keys(NATIVE_TOOL_FIELDS) as NativeToolKey[]) {
    const choice = choices[key]
    if (choice === undefined) continue
    const aliases = TOOL_ALIASES[key]
    if (choice === false) {
      for (const tool of output) for (const field of aliases) delete tool[field]
    } else if (!output.some(tool => aliases.some(field => Object.hasOwn(tool, field)))) {
      output.push({ [NATIVE_TOOL_FIELDS[key]]: {} })
    }
  }
  return output.filter(tool => Object.keys(tool).length > 0)
}

/**
 * Apply only explicit chat choices. Omission retains configured defaults; false
 * removes the tool even when it came from a model setting or a raw REST body.
 * Other config and Tool keys, including functionDeclarations, remain intact.
 */
export function applyNativeToolChoices(config: GenerateContentConfig, choices: NativeToolChoices): GenerateContentConfig {
  if (!Object.keys(NATIVE_TOOL_FIELDS).some(key => choices[key as NativeToolKey] !== undefined)) return config
  const tools = changeTools(config.tools ?? [], choices)
  const output: GenerateContentConfig = { ...config, tools: tools as Tool[] }
  const extra = config.httpOptions?.extraBody
  if (extra && Object.hasOwn(extra, 'tools')) {
    if (!Array.isArray(extra.tools)) throw new TypeError('Google httpOptions.extraBody.tools must be an array to apply chat options.')
    output.httpOptions = { ...config.httpOptions, extraBody: { ...extra, tools: changeTools(extra.tools, choices) } }
  }
  return output
}
