import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'
import type { GoogleGenAI, Model } from '@google/genai'
import { googleError } from './errors.js'
import type { GoogleInputType, GoogleOutputType } from './config.js'
import { googleFetch } from './transport.js'

export interface DiscoveredGoogleModel {
  id: string
  name: string
  description?: string
  contextWindow?: number
  maxTokens?: number
  /** Supported types reported by the catalog, not requested response formats. */
  inputTypes?: GoogleInputType[]
  outputTypes?: GoogleOutputType[]
  /** Absence means that the catalog did not disclose an action list. */
  supportsGenerateContent?: boolean
}

const PAGE_SIZE = 100
const MAX_PAGES = 100
const MAX_ITEMS = 10_000
const MAX_MODELS = 1_000
const TIMEOUT_MS = 30_000

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const INPUT_TYPES: GoogleInputType[] = ['text', 'image', 'audio', 'video', 'pdf']
const OUTPUT_TYPES: GoogleOutputType[] = ['text', 'image', 'audio']

function reportedTypes<T extends string>(sources: Record<string, unknown>[], keys: string[], allowed: readonly T[]): T[] | undefined {
  for (const source of sources) for (const key of keys) {
    const value = source[key]
    if (!Array.isArray(value) || value.length === 0 || value.length > 32) continue
    const types: T[] = []
    let valid = true
    for (const item of value) {
      const type = typeof item === 'string' ? item.trim().toLowerCase() : undefined
      if (type === undefined || !allowed.includes(type as T)) { valid = false; break }
      if (!types.includes(type as T)) types.push(type as T)
    }
    // A partly understood list would incorrectly disable undisclosed inputs.
    if (valid) return types
  }
  return undefined
}

function reportedLimit(sources: Record<string, unknown>[], keys: string[]): number | undefined {
  for (const source of sources) for (const key of keys) if (positiveInteger(source[key])) return source[key]
  return undefined
}

function reportedMetadata(model: Model, raw: Record<string, unknown> | undefined): Pick<DiscoveredGoogleModel, 'contextWindow' | 'maxTokens' | 'inputTypes' | 'outputTypes'> {
  const sources: Record<string, unknown>[] = raw === undefined ? [model as Record<string, unknown>] : [raw]
  if (raw !== undefined) for (const key of ['capabilities', 'architecture', 'limits']) if (isRecord(raw[key])) sources.push(raw[key])
  const contextWindow = positiveInteger(model.inputTokenLimit) ? model.inputTokenLimit
    : reportedLimit(sources, ['inputTokenLimit', 'input_token_limit', 'contextWindow', 'context_window', 'contextLength', 'context_length'])
  const maxTokens = positiveInteger(model.outputTokenLimit) ? model.outputTokenLimit
    : reportedLimit(sources, ['outputTokenLimit', 'output_token_limit', 'maxOutputTokens', 'max_output_tokens'])
  const inputTypes = reportedTypes(sources,
    ['supportedInputModalities', 'supported_input_modalities', 'inputModalities', 'input_modalities', 'inputTypes', 'input_types'], INPUT_TYPES)
  const outputTypes = reportedTypes(sources,
    ['supportedOutputModalities', 'supported_output_modalities', 'outputModalities', 'output_modalities', 'outputTypes', 'output_types'], OUTPUT_TYPES)
  return {
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    // Chat input declarations require text. Never invent it for audio-only APIs.
    ...(inputTypes?.includes('text') ? { inputTypes } : {}),
    ...(outputTypes === undefined ? {} : { outputTypes }),
  }
}

/** Model resource names stay data; reject path traversal and absolute URLs. */
function modelId(name: unknown): string | undefined {
  if (typeof name !== 'string' || !name.trim() || name.length > 512
    || /[\s\\?#\u0000-\u001f\u007f]/.test(name) || /^https?:\/\//i.test(name)
    || name.split('/').some(segment => segment === '.' || segment === '..')) return undefined
  const id = name.replace(/^(?:models|publishers\/google\/models)\/([^/]+)$/, '$1')
  return id.length > 0 ? id : undefined
}

function dedicatedNonChatModel(id: string): boolean {
  const leaf = id.toLowerCase().split('/').at(-1) ?? ''
  // These APIs have different request/response contracts. Explicit upstream
  // generateContent metadata takes priority over a potentially custom name.
  return /(^|[-_])(embedding|embed|live)([-_]|$)/.test(leaf)
    || /native[-_]audio/.test(leaf)
    || /^(imagen|veo|lyria|deep-research|antigravity)([-_]|$)/.test(leaf)
}

function candidate(model: Model, raw?: Record<string, unknown>): DiscoveredGoogleModel | undefined {
  const id = modelId(model.name)
  if (!id) return undefined
  const actions = [model.supportedActions, raw?.supportedGenerationMethods, raw?.supported_generation_methods,
    raw?.supportedActions, raw?.supported_actions].find(Array.isArray)
  const declared = actions?.some(action => action === 'generateContent' || action === 'streamGenerateContent')
  if (declared === false || (declared === undefined && dedicatedNonChatModel(id))) return undefined
  const name = typeof model.displayName === 'string' && model.displayName.trim()
    ? model.displayName.slice(0, 256) : id
  return {
    id, name,
    ...(typeof model.description === 'string' && model.description.length > 0 ? { description: model.description.slice(0, 4_000) } : {}),
    ...reportedMetadata(model, raw),
    ...(declared === undefined ? {} : { supportsGenerateContent: declared }),
  }
}

/**
 * Discover metadata only, through the configured native SDK endpoint and auth.
 * The pinned SDK drops catalog modality metadata and Vertex token limits.
 * Capture the same list responses locally, retaining SDK auth and pagination.
 * Official catalogs may omit these fields; absence remains manual/unknown.
 */
export async function discoverGoogleModels(
  client: GoogleGenAI,
  backend: 'ai-studio' | 'vertex',
  signal?: AbortSignal,
): Promise<DiscoveredGoogleModel[]> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  try {
    requestSignal.throwIfAborted()
    if (client.vertexai !== (backend === 'vertex')) throw new LlmError('模型发现客户端与所选 Google 后端不匹配。', 'INVALID_CONFIG')
    let rawPage = new Map<string, Record<string, unknown>>()
    const captureCatalog: typeof globalThis.fetch = async (input, init) => {
      const response = await googleFetch(input, init)
      rawPage = new Map()
      if (response.ok) {
        const body: unknown = await response.clone().json()
        if (isRecord(body)) {
          const rows = [body.models, body.tunedModels, body.publisherModels].find(Array.isArray)
          for (const row of rows?.slice(0, MAX_ITEMS + 1) ?? []) {
            if (!isRecord(row)) continue
            const id = modelId(row.name)
            if (id !== undefined && !rawPage.has(id)) rawPage.set(id, row)
          }
        }
      }
      return response
    }
    const pager = await client.models.list({ config: {
      queryBase: true, pageSize: PAGE_SIZE, abortSignal: requestSignal,
      httpOptions: { headers: attributionHeaders(), timeout: TIMEOUT_MS, retryOptions: { attempts: 1 }, fetch: captureCatalog },
    } })
    const result = new Map<string, DiscoveredGoogleModel>()
    const pageTokens = new Set<string>()
    let items = 0
    let pages = 0
    while (true) {
      requestSignal.throwIfAborted()
      if (++pages > MAX_PAGES || !Array.isArray(pager.page)) throw LlmError.fromFailure({ message: '上游模型列表分页无效或超过读取上限，请缩小列表或手动添加模型 ID。', code: 'MODEL_DISCOVERY_LIMIT' })
      for (const model of pager.page) {
        requestSignal.throwIfAborted()
        if (++items > MAX_ITEMS) throw LlmError.fromFailure({ message: '上游模型数量超过读取上限，请缩小列表或手动添加模型 ID。', code: 'MODEL_DISCOVERY_LIMIT' })
        if (typeof model !== 'object' || model === null) continue
        const id = modelId(model.name)
        const entry = candidate(model, id === undefined ? undefined : rawPage.get(id))
        if (entry && !result.has(entry.id)) result.set(entry.id, entry)
        if (result.size > MAX_MODELS) throw LlmError.fromFailure({ message: `可添加的上游模型超过 ${MAX_MODELS} 个，请缩小列表或手动添加模型 ID。`, code: 'MODEL_DISCOVERY_LIMIT' })
      }
      if (!pager.hasNextPage()) break
      const token = pager.params?.config?.pageToken
      // Empty terminal tokens occur in compatible proxies; do not let the SDK
      // turn them into an unbounded sequence of duplicate page requests.
      if (token === '' || token === null) break
      if (typeof token !== 'string' || pageTokens.has(token)) throw LlmError.fromFailure({ message: '上游模型列表返回了重复或无效的分页标记，请手动添加模型 ID。', code: 'MODEL_DISCOVERY_PAGINATION' })
      pageTokens.add(token)
      if (pages >= MAX_PAGES) throw LlmError.fromFailure({ message: '上游模型列表页数超过读取上限，请缩小列表或手动添加模型 ID。', code: 'MODEL_DISCOVERY_LIMIT' })
      await pager.nextPage()
    }
    requestSignal.throwIfAborted()
    return [...result.values()]
  } catch (error) {
    if (!signal?.aborted && timeout.aborted) throw LlmError.fromFailure({ message: '获取上游模型列表超时，请检查连接或手动添加模型 ID。', code: 'MODEL_DISCOVERY_TIMEOUT' })
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
    if (status === 404 || status === 405 || status === 501) throw LlmError.fromFailure({ message: '此上游未提供可用的 Google 原生模型列表，请检查 Base URL 或手动添加模型 ID。', code: 'MODEL_DISCOVERY_UNAVAILABLE', ...({ status }) })
    throw googleError(error, signal)
  }
}
