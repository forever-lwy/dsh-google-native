import type { AttachmentStore, FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { File as GoogleFile, GoogleGenAI, Part } from '@google/genai'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { withGoogleAbort } from './transport.js'
import type { GoogleInputType } from './config.js'

export interface NativeFileOptions {
  /** AI Studio uploads files above this size through the Gemini Files API. */
  inlineThresholdBytes?: number
  /** Vertex rejects larger local files; use a native gs:// fileData part instead. */
  inlineMaxBytes?: number
  maxFileBytes?: number
  pollIntervalMs?: number
  processingTimeoutMs?: number
}

const MiB = 1024 * 1024
const officeTypes: Record<string, string> = {
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.odt': 'application/vnd.oasis.opendocument.text', '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
}
const extensionTypes: Record<string, string> = {
  ...officeTypes,
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/opus', '.m4a': 'audio/mp4', '.weba': 'audio/webm', '.alaw': 'audio/alaw', '.mulaw': 'audio/mulaw',
  '.pcm': 'audio/pcm', '.l16': 'audio/L16',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg',
  '.mov': 'video/quicktime', '.avi': 'video/avi', '.flv': 'video/x-flv',
  '.wmv': 'video/wmv', '.webm': 'video/webm', '.3gp': 'video/3gpp', '.3gpp': 'video/3gpp',
  '.txt': 'text/plain', '.md': 'text/plain', '.csv': 'text/plain', '.html': 'text/plain',
  '.htm': 'text/plain', '.xml': 'text/plain', '.json': 'text/plain',
  '.js': 'text/plain', '.ts': 'text/plain', '.py': 'text/plain', '.css': 'text/plain',
  '.yaml': 'text/plain', '.yml': 'text/plain', '.log': 'text/plain',
}

/** File names are display metadata only. No input is interpreted as a local path. */
export function nativeMimeType(name: string, prefix: Uint8Array): string | undefined {
  const head = Buffer.from(prefix)
  const extension = extname(name).toLowerCase()
  const named = extensionTypes[extension]
  const zip = head.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))
  const compound = head.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))
  if (zip || compound || Object.hasOwn(officeTypes, extension)) {
    const legacyOffice = ['.doc', '.ppt', '.xls'].includes(extension)
    return (legacyOffice ? compound : zip) ? officeTypes[extension] : undefined
  }
  if (head.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (/^GIF8[79]a/.test(head.subarray(0, 6).toString('ascii'))) return undefined
  if (head.subarray(0, 4).toString('ascii') === 'RIFF') {
    const kind = head.subarray(8, 12).toString('ascii')
    if (kind === 'WAVE') return 'audio/wav'
    if (kind === 'WEBP') return 'image/webp'
    if (kind === 'AVI ') return 'video/avi'
  }
  if (head.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac'
  if (head.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg'
  if (head.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg'
  if (head.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = head.subarray(8, 12).toString('ascii')
    if (/^M4[AB]/.test(brand)) return 'audio/mp4'
    if (brand === 'qt  ') return 'video/quicktime'
    if (/^(heic|heix|hevc|hevx)$/.test(brand)) return 'image/heic'
    if (/^(mif1|msf1)$/.test(brand)) return 'image/heif'
    if (/^3g[p2]/.test(brand)) return 'video/3gpp'
    if (/^(isom|iso[2-9]|mp4[12]|M4V |avc1|dash)$/.test(brand)) return named === 'audio/mp4' ? named : 'video/mp4'
    return undefined
  }
  if (named === 'application/pdf' || named?.startsWith('image/') || named === 'text/plain' && head.includes(0)) return undefined
  return named
}

export function detectMimeType(name: string, prefix: Uint8Array): string {
  const mime = nativeMimeType(name, prefix)
  if (mime) return mime
  throw LlmError.fromFailure({ message: `Cannot determine a supported native MIME type for attachment ${JSON.stringify(name)}. Use a supported media/PDF/text filename or explicit native fileData with mimeType.`, code: 'UNSUPPORTED_FILE_TYPE' })
}

function positiveOption(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) throw new LlmError(`${name} must be a positive integer.`, 'INVALID_CONFIG')
  return value
}

/** Model declarations constrain native inputs; they do not grant backend support. */
export function assertNativeInputType(type: GoogleInputType, allowed: readonly GoogleInputType[] | undefined): void {
  if (allowed !== undefined && !allowed.includes(type)) {
    throw LlmError.fromFailure({ message: `此模型未声明 ${type} 输入能力，请在模型高级设置中核对支持的输入类型。`, code: 'UNSUPPORTED_INPUT_TYPE' })
  }
}

const nativeMimes = new Set([...Object.values(extensionTypes).map(mime => mime.toLowerCase()), 'audio/mp3', 'audio/m4a', 'video/mpg'])
const officeMimes = new Set(Object.values(officeTypes))

function inputTypeForMime(mimeType: string): GoogleInputType | undefined {
  const base = mimeType.split(';', 1)[0].trim().toLowerCase()
  if (!nativeMimes.has(base)) return undefined
  return base.startsWith('image/') ? 'image'
    : base.startsWith('audio/') ? 'audio' : base.startsWith('video/') ? 'video'
      : base === 'application/pdf' ? 'pdf' : officeMimes.has(base) ? 'office' : 'text'
}

export function supportsFileMime(mime: string | undefined, allowed: readonly GoogleInputType[] | undefined, office: boolean): boolean {
  const type = mime === undefined ? undefined : inputTypeForMime(mime)
  return type !== undefined && (type !== 'office' || office) && (allowed === undefined || allowed.includes(type))
}

function assertMimeType(mimeType: string, allowed: readonly GoogleInputType[] | undefined): void {
  const type = inputTypeForMime(mimeType)
  if (type === undefined) throw LlmError.fromFailure({ message: '文件 MIME 类型不属于支持的原生输入类型。', code: 'UNSUPPORTED_FILE_TYPE' })
  assertNativeInputType(type, allowed)
}

/** Missing objects from imported history become a truthful text placeholder. */
function unavailableAttachment(error: unknown): boolean {
  return error instanceof Error && 'code' in error
    && (error.code === 'ATTACHMENT_NOT_FOUND' || error.code === 'INVALID_ATTACHMENT_REF')
}

function unavailableFile(ref: FileAttachmentRef): Part {
  return { text: `File ${JSON.stringify(ref.name)} is unavailable: its original contents are not stored. Ask for a new upload if its contents are needed.` }
}

/** Reads exclusively through the verified durable attachment store. */
export class NativeFileStore {
  private readonly options: Required<NativeFileOptions>
  private readonly uploaded = new Map<string, { part: Part; expires: number }>()
  private readonly inspected = new Map<string, string | undefined>()

  constructor(
    private readonly client: GoogleGenAI,
    private readonly backend: 'ai-studio' | 'vertex',
    private readonly attachments: AttachmentStore,
    options: NativeFileOptions = {},
    private readonly executionPath?: (hostPath: string) => string | undefined,
  ) {
    this.options = {
      inlineThresholdBytes: positiveOption(options.inlineThresholdBytes, 8 * MiB, 'inlineThresholdBytes'),
      inlineMaxBytes: positiveOption(options.inlineMaxBytes, 16 * MiB, 'inlineMaxBytes'),
      maxFileBytes: positiveOption(options.maxFileBytes, 300 * MiB, 'maxFileBytes'),
      pollIntervalMs: positiveOption(options.pollIntervalMs, 1500, 'pollIntervalMs'),
      processingTimeoutMs: positiveOption(options.processingTimeoutMs, 300_000, 'processingTimeoutMs'),
    }
  }

  async imagePart(ref: ImageAttachmentRef, signal?: AbortSignal, allowed?: readonly GoogleInputType[]): Promise<Part> {
    signal?.throwIfAborted()
    assertNativeInputType('image', allowed)
    if (ref.mediaType === 'image/gif') {
      const hostPath = this.attachments.imageHostPath(ref)
      const path = hostPath && this.executionPath?.(hostPath)
      return { text: path ? `Read the normalized GIF with local file tools at ${JSON.stringify(path)} (read-only).`
        : `GIF ${JSON.stringify(ref.name ?? ref.attachmentId)} has no readable local path in this environment.` }
    }
    const stored = await this.attachments.readImage(ref, signal)
    signal?.throwIfAborted()
    return { inlineData: { mimeType: stored.ref.mediaType, data: Buffer.from(stored.data).toString('base64') } }
  }

  /** Inspect only a prefix. The cache holds type metadata for immutable attachment references. */
  private async inputMime(ref: FileAttachmentRef, signal?: AbortSignal): Promise<string | undefined> {
    signal?.throwIfAborted()
    const key = `${ref.attachmentId}:${extname(ref.name).toLowerCase()}`
    const cached = this.uploaded.get(key)
    if (cached && cached.expires > Date.now() + 60_000 && cached.part.fileData?.mimeType) {
      return cached.part.fileData.mimeType
    }
    if (this.inspected.has(key)) return this.inspected.get(key)
    let prefix = Buffer.alloc(0)
    try {
      for await (const chunk of this.attachments.readFileStream(ref, signal)) {
        signal?.throwIfAborted()
        prefix = Buffer.concat([prefix, chunk.subarray(0, 32 - prefix.byteLength)])
        if (prefix.byteLength === 32) break
      }
    } catch (error) {
      signal?.throwIfAborted()
      if (unavailableAttachment(error)) return extensionTypes[extname(ref.name).toLowerCase()]
      throw error
    }
    const mime = nativeMimeType(ref.name, prefix)
    if (this.inspected.size >= 256) this.inspected.delete(this.inspected.keys().next().value!)
    this.inspected.set(key, mime)
    return mime
  }

  async canSendFile(ref: FileAttachmentRef, allowed: readonly GoogleInputType[] | undefined, office: boolean, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    if (!office && Object.hasOwn(officeTypes, extname(ref.name).toLowerCase())) return false
    return supportsFileMime(await this.inputMime(ref, signal), allowed, office)
  }

  async validateInputType(ref: FileAttachmentRef, allowed: readonly GoogleInputType[], signal?: AbortSignal): Promise<void> {
    this.validateSize(ref)
    assertMimeType(await this.inputMime(ref, signal) ?? '', allowed)
  }

  private validateSize(ref: FileAttachmentRef): void {
    if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > this.options.maxFileBytes) {
      throw LlmError.fromFailure({ message: `Attachment exceeds maxFileBytes (${this.options.maxFileBytes}).`, code: 'FILE_TOO_LARGE' })
    }
    if (this.backend === 'vertex' && ref.bytes > this.options.inlineMaxBytes) {
      throw LlmError.fromFailure({ message: `Vertex local attachment exceeds inlineMaxBytes (${this.options.inlineMaxBytes}). Supply a Google Cloud Storage gs:// URI as a native fileData part, or reduce the file.`, code: 'FILE_TOO_LARGE' })
    }
  }

  async filePart(ref: FileAttachmentRef, signal?: AbortSignal, allowed?: readonly GoogleInputType[]): Promise<Part> {
    try {
      return await this.readFilePart(ref, signal, allowed)
    } catch (error) {
      signal?.throwIfAborted()
      if (unavailableAttachment(error)) return unavailableFile(ref)
      throw error
    }
  }

  private async readFilePart(ref: FileAttachmentRef, signal?: AbortSignal, allowed?: readonly GoogleInputType[]): Promise<Part> {
    signal?.throwIfAborted()
    this.validateSize(ref)
    const key = `${ref.attachmentId}:${extname(ref.name).toLowerCase()}`
    const cached = this.uploaded.get(key)
    if (cached && cached.expires > Date.now() + 60_000) {
      if (cached.part.fileData?.mimeType) assertMimeType(cached.part.fileData.mimeType, allowed)
      return structuredClone(cached.part)
    }
    this.uploaded.delete(key)
    if (this.backend === 'ai-studio' && ref.bytes > this.options.inlineThresholdBytes) {
      return this.upload(ref, key, signal, allowed)
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of this.attachments.readFileStream(ref, signal)) {
      signal?.throwIfAborted()
      size += chunk.byteLength
      if (size > ref.bytes || size > this.options.maxFileBytes) throw LlmError.fromFailure({ message: 'Attachment size does not match its durable reference.', code: 'INVALID_ATTACHMENT' })
      chunks.push(Buffer.from(chunk))
    }
    if (size !== ref.bytes) throw LlmError.fromFailure({ message: 'Attachment size does not match its durable reference.', code: 'INVALID_ATTACHMENT' })
    const bytes = Buffer.concat(chunks, size)
    const mimeType = detectMimeType(ref.name, bytes.subarray(0, 32))
    assertMimeType(mimeType, allowed)
    signal?.throwIfAborted()
    return { inlineData: { mimeType, data: bytes.toString('base64') } }
  }

  private async upload(ref: FileAttachmentRef, key: string, signal?: AbortSignal, allowed?: readonly GoogleInputType[]): Promise<Part> {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-google-file-'))
    const path = join(directory, 'attachment')
    try {
      const file = await open(path, 'wx', 0o600)
      let prefix = Buffer.alloc(0)
      let size = 0
      try {
        for await (const chunk of this.attachments.readFileStream(ref, signal)) {
          signal?.throwIfAborted()
          size += chunk.byteLength
          if (size > ref.bytes || size > this.options.maxFileBytes) throw LlmError.fromFailure({ message: 'Attachment size does not match its durable reference.', code: 'INVALID_ATTACHMENT' })
          if (prefix.byteLength < 32) prefix = Buffer.concat([prefix, Buffer.from(chunk).subarray(0, 32 - prefix.byteLength)])
          // writeFile accepts Uint8Array and completes each chunk before the next is read.
          await file.writeFile(chunk)
        }
      } finally { await file.close() }
      if (size !== ref.bytes) throw LlmError.fromFailure({ message: 'Attachment size does not match its durable reference.', code: 'INVALID_ATTACHMENT' })
      const mimeType = detectMimeType(ref.name, prefix)
      assertMimeType(mimeType, allowed)
      signal?.throwIfAborted()
      const uploaded = await withGoogleAbort(signal, () => this.client.files.upload({
        file: path,
        // SDK 2.32.0 replaces its resumable-upload headers when httpOptions is supplied.
        // Client transport adds attribution and cancellation to every upload request.
        config: { mimeType, displayName: ref.name, abortSignal: signal },
      }))
      const active = await this.waitForActive(uploaded, signal)
      if (!active.uri) throw new LlmError('Google Files API returned no file URI.', 'INVALID_RESPONSE')
      const activeMimeType = active.mimeType ?? mimeType
      assertMimeType(activeMimeType, allowed)
      const part: Part = { fileData: { fileUri: active.uri, mimeType: activeMimeType } }
      const expiration = active.expirationTime === undefined ? Date.now() + 60 * 60_000 : Date.parse(active.expirationTime)
      this.uploaded.set(key, { part, expires: Number.isFinite(expiration) ? expiration : Date.now() })
      // Bound metadata growth in a long-lived profile. Remote objects retain Google's own TTL.
      if (this.uploaded.size > 256) this.uploaded.delete(this.uploaded.keys().next().value!)
      return structuredClone(part)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }

  private async waitForActive(initial: GoogleFile, signal?: AbortSignal): Promise<GoogleFile> {
    const deadline = AbortSignal.timeout(this.options.processingTimeoutMs)
    const processingSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    let file = initial
    try {
      while (true) {
        processingSignal.throwIfAborted()
        if (file.state === 'ACTIVE') return file
        if (file.state === 'FAILED') throw LlmError.fromFailure({ message: 'Google could not process the uploaded file.', code: 'FILE_PROCESSING_FAILED' })
        if (!file.name || file.state !== 'PROCESSING') throw new LlmError('Google Files API returned an unexpected processing state.', 'INVALID_RESPONSE')
        await delay(this.options.pollIntervalMs, undefined, { signal: processingSignal })
        file = await this.client.files.get({ name: file.name, config: { abortSignal: processingSignal, httpOptions: { headers: attributionHeaders() } } })
      }
    } catch (error) {
      if (deadline.aborted && !signal?.aborted) throw LlmError.fromFailure({ message: 'Timed out waiting for Google file processing.', code: 'FILE_PROCESSING_TIMEOUT' })
      throw error
    }
  }
}
