import { LlmError } from '@deepseek-ai/dsh-llm'

const extensions: Readonly<Record<string, string>> = {
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg',
  'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/aac': 'aac',
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/webm': 'weba',
  'audio/aiff': 'aiff', 'audio/opus': 'opus',
  'video/mp4': 'mp4', 'video/mpeg': 'mpeg', 'video/webm': 'webm',
  'video/quicktime': 'mov', 'video/mov': 'mov',
  'video/avi': 'avi', 'video/x-msvideo': 'avi',
  'video/x-flv': 'flv', 'video/wmv': 'wmv', 'video/x-ms-wmv': 'wmv',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf', 'application/json': 'json',
  'application/xml': 'xml', 'text/xml': 'xml',
  'text/csv': 'csv', 'text/html': 'html', 'text/markdown': 'md',
  'text/javascript': 'js', 'application/javascript': 'js', 'text/css': 'css',
}

function pcmInteger(parameters: Map<string, string>, key: string, fallback: number, max: number): number {
  const raw = parameters.get(key)
  if (raw === undefined) return fallback
  if (!/^\d+$/.test(raw)) throw new LlmError(`Google PCM ${key} is invalid.`, 'INVALID_RESPONSE')
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new LlmError(`Google PCM ${key} is outside the WAV format range.`, 'INVALID_RESPONSE')
  }
  return value
}

/**
 * Save generated media with a usable file type, while callers retain the raw
 * native Part separately for protocol replay. Gemini's audio/L16 streaming
 * payload is signed little-endian PCM (not RFC L16 network byte order):
 * https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
 */
export function nativeMediaFile(data: Buffer, mime: string): { data: Buffer; extension: string } {
  const [type, ...fields] = mime.split(';')
  const base = type.trim().toLowerCase()
  if (base !== 'audio/l16') {
    const extension = extensions[base] ?? (base.endsWith('+json') ? 'json'
      : base.endsWith('+xml') ? 'xml' : base.startsWith('text/') ? 'txt' : 'bin')
    return { data, extension }
  }

  const parameters = new Map<string, string>()
  for (const field of fields) {
    const separator = field.indexOf('=')
    if (separator < 0) continue
    const name = field.slice(0, separator).trim().toLowerCase()
    const value = field.slice(separator + 1).trim().replace(/^"(.*)"$/, '$1').toLowerCase()
    if (parameters.has(name)) throw new LlmError('Google PCM MIME parameters are duplicated.', 'INVALID_RESPONSE')
    parameters.set(name, value)
  }
  const codec = parameters.get('codec')
  if (codec !== undefined && codec !== 'pcm') {
    throw new LlmError('Google audio/L16 contains an unsupported codec.', 'INVALID_RESPONSE')
  }
  const sampleRate = pcmInteger(parameters, 'rate', 24_000, 0xffffffff)
  const channels = pcmInteger(parameters, 'channels', 1, 0x7fff)
  const blockAlign = channels * 2
  const byteRate = sampleRate * blockAlign
  if (byteRate > 0xffffffff || data.length > 0xffffffff - 36 || data.length % blockAlign !== 0) {
    throw new LlmError('Google PCM data cannot be represented as a 16-bit WAV file.', 'INVALID_RESPONSE')
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return { data: Buffer.concat([header, data]), extension: 'wav' }
}
