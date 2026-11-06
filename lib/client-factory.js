import { assertUsableApiKey, attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { GoogleGenAI } from '@google/genai';
import { googleFetch } from './transport.js';
/** Accept native API roots or version-suffixed roots without duplicating the API version. */
export function normalizeNativeEndpoint(baseURL, apiVersion) {
    const version = apiVersion?.trim() || undefined;
    if (version !== undefined && !/^[A-Za-z0-9._-]*$/.test(version)) {
        throw new LlmError('API Version 只能填写版本名称，例如 v1beta 或 v1。', 'INVALID_CONFIG');
    }
    if (!baseURL?.trim())
        return version === undefined ? {} : { apiVersion: version };
    let parsed;
    try {
        parsed = new URL(baseURL.trim());
    }
    catch {
        throw new LlmError('Base URL 必须是有效的 HTTP(S) 原生 API 地址。', 'INVALID_CONFIG');
    }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new LlmError('Base URL 必须是无凭据、无查询参数的 HTTP(S) 原生 API 地址。', 'INVALID_CONFIG');
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    const suffix = /\/(v\d+(?:(?:alpha|beta)\d*)?)$/i.exec(parsed.pathname);
    if (suffix)
        parsed.pathname = parsed.pathname.slice(0, -suffix[0].length);
    return { baseURL: parsed.toString().replace(/\/+$/, ''),
        ...((version ?? suffix?.[1]) === undefined ? {} : { apiVersion: version ?? suffix[1] }) };
}
/** Re-resolve stored references on every operation, including unsaved discovery drafts. */
export async function resolveGoogleApiKey(ctx, profile) {
    if (profile.provider === 'google-vertex-native' && profile.vertexAuth === 'adc')
        return undefined;
    const provider = ctx.get('credentials');
    const refs = profile.provider === 'google-ai-studio' && profile.apiKeyEnv === 'GOOGLE_API_KEY'
        ? ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] : [profile.apiKeyEnv];
    for (const reference of refs) {
        const ref = credentialRef(reference);
        const resolved = provider === undefined ? launchEnvironmentOf(ctx).get(ref) : await provider.resolve(ref);
        if (resolved?.value)
            return assertUsableApiKey(resolved.value, 'dsh-google-native', ref);
    }
    return undefined;
}
/** Shared by chat and read-only model discovery; drafts may describe disabled profiles. */
export function createNativeGoogleClient(profile, rawKey, construct = options => new GoogleGenAI(options)) {
    const vertex = profile.provider === 'google-vertex-native';
    const needsKey = !vertex || profile.vertexAuth === 'api-key';
    if (needsKey && !rawKey)
        throw new LlmError(`请配置 ${profile.apiKeyEnv} 对应的 Google API Key。`, 'MISSING_CREDENTIAL');
    const apiKey = needsKey && rawKey ? assertUsableApiKey(rawKey, 'dsh-google-native', profile.apiKeyEnv) : undefined;
    if (vertex && !needsKey && !profile.project?.trim())
        throw new LlmError('Vertex ADC 需要配置 Google Cloud project。', 'INVALID_CONFIG');
    const endpoint = normalizeNativeEndpoint(profile.baseURL, profile.apiVersion);
    return construct({
        vertexai: vertex,
        ...(endpoint.apiVersion === undefined ? {} : { apiVersion: endpoint.apiVersion }),
        ...(needsKey ? { apiKey } : {
            project: profile.project, location: profile.location || 'global',
            ...(profile.keyFile ? { googleAuthOptions: { keyFile: profile.keyFile } } : {}),
        }),
        httpOptions: {
            ...(endpoint.baseURL ? { baseUrl: endpoint.baseURL } : {}),
            headers: attributionHeaders(), retryOptions: { attempts: 1 }, fetch: googleFetch,
        },
    });
}
