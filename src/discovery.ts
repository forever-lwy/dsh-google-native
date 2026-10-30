import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'
import type { GoogleGenAI, Model } from '@google/genai'
import { googleError } from './errors.js'

export interface DiscoveredGoogleModel {
  id: string
  name: string
  description?: string
  contextWindow?: number
  maxTokens?: number
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

function candidate(model: Model): DiscoveredGoogleModel | undefined {
  const id = modelId(model.name)
  if (!id) return undefined
  const actions = Array.isArray(model.supportedActions) ? model.supportedActions : undefined
  const declared = actions?.some(action => action === 'generateContent' || action === 'streamGenerateContent')
  if (declared === false || (declared === undefined && dedicatedNonChatModel(id))) return undefined
  const name = typeof model.displayName === 'string' && model.displayName.trim()
    ? model.displayName.slice(0, 256) : id
  return {
    id, name,
    ...(typeof model.description === 'string' && model.description.length > 0 ? { description: model.description.slice(0, 4_000) } : {}),
    ...(positiveInteger(model.inputTokenLimit) ? { contextWindow: model.inputTokenLimit } : {}),
    ...(positiveInteger(model.outputTokenLimit) ? { maxTokens: model.outputTokenLimit } : {}),
    ...(declared === undefined ? {} : { supportsGenerateContent: declared }),
  }
}

/**
 * Discover metadata only, through the configured native SDK endpoint and auth.
 * Vertex's pinned SDK converter does not expose action/token metadata for
 * publisher models; those entries deliberately remain capability-unknown.
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
    const pager = await client.models.list({ config: {
      queryBase: true, pageSize: PAGE_SIZE, abortSignal: requestSignal,
      httpOptions: { headers: attributionHeaders(), timeout: TIMEOUT_MS, retryOptions: { attempts: 1 } },
    } })
    const result = new Map<string, DiscoveredGoogleModel>()
    const pageTokens = new Set<string>()
    let items = 0
    let pages = 0
    while (true) {
      requestSignal.throwIfAborted()
      if (++pages > MAX_PAGES || !Array.isArray(pager.page)) throw new LlmError('上游模型列表分页无效或超过读取上限，请缩小列表或手动添加模型 ID。', 'MODEL_DISCOVERY_LIMIT')
      for (const model of pager.page) {
        requestSignal.throwIfAborted()
        if (++items > MAX_ITEMS) throw new LlmError('上游模型数量超过读取上限，请缩小列表或手动添加模型 ID。', 'MODEL_DISCOVERY_LIMIT')
        if (typeof model !== 'object' || model === null) continue
        const entry = candidate(model)
        if (entry && !result.has(entry.id)) result.set(entry.id, entry)
        if (result.size > MAX_MODELS) throw new LlmError(`可添加的上游模型超过 ${MAX_MODELS} 个，请缩小列表或手动添加模型 ID。`, 'MODEL_DISCOVERY_LIMIT')
      }
      if (!pager.hasNextPage()) break
      const token = pager.params?.config?.pageToken
      // Empty terminal tokens occur in compatible proxies; do not let the SDK
      // turn them into an unbounded sequence of duplicate page requests.
      if (token === '' || token === null) break
      if (typeof token !== 'string' || pageTokens.has(token)) throw new LlmError('上游模型列表返回了重复或无效的分页标记，请手动添加模型 ID。', 'MODEL_DISCOVERY_PAGINATION')
      pageTokens.add(token)
      if (pages >= MAX_PAGES) throw new LlmError('上游模型列表页数超过读取上限，请缩小列表或手动添加模型 ID。', 'MODEL_DISCOVERY_LIMIT')
      await pager.nextPage()
    }
    requestSignal.throwIfAborted()
    return [...result.values()]
  } catch (error) {
    if (!signal?.aborted && timeout.aborted) throw new LlmError('获取上游模型列表超时，请检查连接或手动添加模型 ID。', 'MODEL_DISCOVERY_TIMEOUT')
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
    if (status === 404 || status === 405 || status === 501) throw new LlmError('此上游未提供可用的 Google 原生模型列表，请检查 Base URL 或手动添加模型 ID。', 'MODEL_DISCOVERY_UNAVAILABLE', { status })
    throw googleError(error, signal)
  }
}
