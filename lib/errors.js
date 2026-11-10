import { LlmError } from '@deepseek-ai/dsh-llm';
/** Inspect only stable transport markers, never provider bodies or message text. */
function isTimeout(error) {
    const visited = new Set();
    let current = error;
    for (let depth = 0; depth < 6 && typeof current === 'object' && current !== null; depth++) {
        if (visited.has(current))
            break;
        visited.add(current);
        const candidate = current;
        if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError'
            || candidate.code === 'UND_ERR_HEADERS_TIMEOUT' || candidate.code === 'UND_ERR_BODY_TIMEOUT'
            || candidate.code === 'UND_ERR_CONNECT_TIMEOUT')
            return true;
        current = candidate.cause;
    }
    return false;
}
/** Keep credentials, request payloads and provider debug bodies out of errors. */
export function googleError(error, signal) {
    if (signal?.aborted)
        return new LlmError('Google 请求已取消。', 'ABORTED');
    if (error instanceof LlmError)
        return error;
    const status = typeof error === 'object' && error !== null && 'status' in error
        && typeof error.status === 'number' ? error.status : undefined;
    if (status === 524) {
        // Cloudflare's origin timeout: no byte reached the edge for ~100 seconds.
        return new LlmError('Google 模型请求超时（HTTP 524）：上游网关约 100 秒未收到任何数据就断开了连接。很长的工具调用参数（如整份文件写入）生成期间不会有数据传出，容易触发；请让模型分段写入，或让 API 域名绕过 Cloudflare 代理。', 'TIMEOUT', { status });
    }
    if (status === 408 || status === 504 || isTimeout(error)) {
        return new LlmError(`Google 模型请求超时${status ? `（HTTP ${status}）` : ''}，可在模型页调整请求超时，并检查上游服务与网络。`, 'TIMEOUT', status !== undefined && status >= 100 && status <= 599 ? { status } : undefined);
    }
    const code = status === 401 || status === 403 ? 'AUTH'
        : status === 429 ? 'RATE_LIMIT'
            : status === 404 ? 'MODEL_NOT_FOUND'
                : status !== undefined && status >= 500 ? 'SERVER_ERROR'
                    : status === 400 ? 'INVALID_REQUEST' : 'NETWORK';
    return new LlmError(`Google API 请求失败${status ? `（HTTP ${status}）` : ''}，请检查模型、原生参数、网络及凭据配置。`, code, status !== undefined && status >= 100 && status <= 599 ? { status } : undefined);
}
