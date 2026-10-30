import { LlmError } from '@deepseek-ai/dsh-llm'

/** Keep credentials, request payloads and provider debug bodies out of errors. */
export function googleError(error: unknown, signal?: AbortSignal): LlmError {
  if (signal?.aborted) return new LlmError('Google 请求已取消。', 'ABORTED')
  if (error instanceof LlmError) return error
  const status = typeof error === 'object' && error !== null && 'status' in error
    && typeof error.status === 'number' ? error.status : undefined
  const code = status === 401 || status === 403 ? 'AUTH'
    : status === 429 ? 'RATE_LIMIT'
      : status === 404 ? 'MODEL_NOT_FOUND'
        : status !== undefined && status >= 500 ? 'SERVER_ERROR'
          : status === 400 ? 'INVALID_REQUEST' : 'NETWORK'
  return new LlmError(`Google API 请求失败${status ? `（HTTP ${status}）` : ''}，请检查模型、原生参数、网络及凭据配置。`, code,
    status !== undefined && status >= 100 && status <= 599 ? { status } : undefined)
}
