import { createHash } from 'crypto'
import { constants as fsConstants, type Stats } from 'fs'
import { open, realpath, stat } from 'fs/promises'
import type { FileHandle } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import type ODRequest from '../core/request'
import ODResponse from '../core/response'

const MIME_TYPES: Record<string, string> = {
  '.txt':  'text/plain',
  '.html': 'text/html',
  '.htm':  'text/html',
  '.json': 'application/json',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.pdf':  'application/pdf',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4':  'video/mp4',
  '.mp3':  'audio/mpeg',
  '.xml':  'application/xml',
  '.csv':  'text/csv',
  '.zip':  'application/zip',
}

const MONTH_INDEX: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
}

const IMF_FIXDATE_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/
const RFC850_DATE_RE = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/
const ASCTIME_DATE_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ((?: [1-9])|(?:[12]\d)|(?:3[01])) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/

export interface ServeStaticOptions {
  /**
   * Additional or override MIME type mappings keyed by lowercase extension (e.g. '.wav').
   * Merged on top of the built-in table, so existing entries can be overridden too.
   */
  mimeTypes?: Record<string, string>
  /**
   * Cache-Control header value applied to successful static-file responses.
   * Default: 'public, max-age=3600'
   * Set to false to omit the header entirely.
   */
  cacheControl?: string | false
  /**
   * Charset appended to the Content-Type header for text-based MIME types
   * (text/*, application/json, application/javascript, application/xml).
   * Default: undefined (no charset appended).
   * Example: 'utf-8' produces 'text/html; charset=utf-8'.
   */
  charset?: string
  /**
   * Uses a content hash to emit a strong ETag instead of the default weak mtime/size tag.
   * Required for RFC-compliant 206 Partial Content responses; when false, Range
   * requests are ignored and the full file is served instead.
   * Default: false.
   * This reads the file contents before streaming, so it costs extra I/O and CPU.
   */
  strongEtags?: boolean
}

interface ParsedRange {
  start: number
  end: number
}

const STATIC_FILE_OPEN_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NONBLOCK
const STRONG_ETAG_CHUNK_SIZE = 64 * 1024

function stripWeakEtagPrefix(value: string): string {
  return value.startsWith('W/') ? value.slice(2) : value
}

function parseIfNoneMatchHeader(headerValue: string): string[] | '*' {
  const trimmed = headerValue.trim()
  if (trimmed === '*') return '*'

  const tags: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]
    if (char === '"') {
      inQuotes = !inQuotes
      current += char
      continue
    }
    if (char === ',' && !inQuotes) {
      const tag = current.trim()
      if (tag) tags.push(tag)
      current = ''
      continue
    }
    current += char
  }

  const tag = current.trim()
  if (tag) tags.push(tag)
  return tags
}

function matchesIfNoneMatch(headerValue: string, etag: string): boolean {
  const parsed = parseIfNoneMatchHeader(headerValue)
  if (parsed === '*') return true
  const normalizedEtag = stripWeakEtagPrefix(etag)
  return parsed.some(tag => stripWeakEtagPrefix(tag) === normalizedEtag)
}

function isStrongEtag(value: string): boolean {
  const trimmed = value.trim()
  return !trimmed.startsWith('W/') && trimmed.startsWith('"') && trimmed.endsWith('"')
}

function matchesIfRange(headerValue: string, etag: string, mtime: Date): boolean {
  const trimmed = headerValue.trim()
  const ifRangeTime = parseHttpDate(trimmed)
  if (ifRangeTime !== null) {
    // HTTP-date If-Range only works if Last-Modified is treated as a strong
    // validator. We assume the filesystem mtime is strong enough and require an
    // exact second-level match with the emitted Last-Modified value.
    const mtimeSeconds = Math.floor(mtime.getTime() / 1000) * 1000
    return mtimeSeconds === ifRangeTime
  }
  if (!isStrongEtag(trimmed) || !isStrongEtag(etag)) return false
  return trimmed === etag
}

function isSameFile(openedFile: Stats, currentPathFile: Stats): boolean {
  if (openedFile.dev === 0 || openedFile.ino === 0 || currentPathFile.dev === 0 || currentPathFile.ino === 0) {
    return false
  }
  return openedFile.dev === currentPathFile.dev && openedFile.ino === currentPathFile.ino
}

async function closeFile(fileHandle: FileHandle): Promise<void> {
  try {
    await fileHandle.close()
  } catch {
    // Ignore close failures during cleanup.
  }
}

async function buildStrongEtag(fileHandle: FileHandle, fileSize: number): Promise<string> {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(Math.min(STRONG_ETAG_CHUNK_SIZE, Math.max(fileSize, 1)))

  for (let position = 0; position < fileSize;) {
    const length = Math.min(buffer.length, fileSize - position)
    const { bytesRead } = await fileHandle.read(buffer, 0, length, position)
    if (bytesRead <= 0) break
    hash.update(buffer.subarray(0, bytesRead))
    position += bytesRead
  }

  return `"${hash.digest('hex')}"`
}

function parseBytePosition(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function buildUtcTimestamp(
  year: number,
  monthToken: string,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
): number | null {
  const month = MONTH_INDEX[monthToken]
  if (month === undefined) return null
  if (day < 1 || day > 31) return null
  if (hours > 23 || minutes > 59 || seconds > 59) return null

  const parsedDate = new Date(0)
  parsedDate.setUTCFullYear(year, month, day)
  parsedDate.setUTCHours(hours, minutes, seconds, 0)
  const timestamp = parsedDate.getTime()
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month ||
    parsedDate.getUTCDate() !== day ||
    parsedDate.getUTCHours() !== hours ||
    parsedDate.getUTCMinutes() !== minutes ||
    parsedDate.getUTCSeconds() !== seconds
  ) {
    return null
  }
  return timestamp
}

function parseObsoleteRfc850Year(twoDigitYear: number): number {
  const currentYear = new Date().getUTCFullYear()
  let resolvedYear = 2000 + twoDigitYear
  if (resolvedYear > currentYear + 50) resolvedYear -= 100
  return resolvedYear
}

function parseHttpDate(value: string): number | null {
  const trimmed = value.trim()

  let match = IMF_FIXDATE_RE.exec(trimmed)
  if (match) {
    return buildUtcTimestamp(
      Number(match[4]),
      match[3],
      Number(match[2]),
      Number(match[5]),
      Number(match[6]),
      Number(match[7]),
    )
  }

  match = RFC850_DATE_RE.exec(trimmed)
  if (match) {
    return buildUtcTimestamp(
      parseObsoleteRfc850Year(Number(match[4])),
      match[3],
      Number(match[2]),
      Number(match[5]),
      Number(match[6]),
      Number(match[7]),
    )
  }

  match = ASCTIME_DATE_RE.exec(trimmed)
  if (match) {
    return buildUtcTimestamp(
      Number(match[7]),
      match[2],
      Number(match[3].trim()),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  return null
}

function setNotModifiedResponse(response: ODResponse): ODResponse {
  response.code = 304
  response.content = ''
  response.setHeader('Content-Length', null)
  response.setHeader('Content-Type', null)
  response.setHeader('Content-Range', null)
  return response
}

function setStaticErrorResponse(
  response: ODResponse,
  code: number,
  error: string,
): ODResponse {
  response.setHeader('Content-Length', null)
  response.setHeader('Content-Type', null)
  response.setHeader('Content-Range', null)
  response.setHeader('Cache-Control', null)
  response.setHeader('ETag', null)
  response.setHeader('Last-Modified', null)
  response.setHeader('Accept-Ranges', null)
  return response.setError(code, error)
}

async function streamHeadResponse(
  response: ODResponse,
  fileHandle: FileHandle,
  contentType: string,
): Promise<ODResponse> {
  await closeFile(fileHandle)
  return response.stream(Readable.from([]), contentType)
}

/**
 * Parses a single byte range from a Range header value per RFC 7233.
 * Returns:
 * - `{ start, end }` - valid and satisfiable range -> caller sends 206
 * - `'unsatisfiable'` - syntactically valid but out of bounds -> caller sends 416
 * - `null` - syntactically invalid -> caller ignores the header and sends 200
 * Multi-range requests (e.g. "bytes=0-499,600-999") are not supported;
 * the header is ignored and the caller falls back to a normal 200 response.
 *
 * @param rangeHeader Raw HTTP Range header value.
 * @param fileSize File size in bytes.
 * @returns The computed result.
 */
function parseRange(rangeHeader: string, fileSize: number): ParsedRange | 'unsatisfiable' | null {
  // Multi-range requests (e.g. "bytes=0-499,600-999") are not supported.
  // RFC 7233 section 4.1 allows servers to respond with 200 for multi-range requests
  // rather than implementing multipart/byteranges. Returning null causes the
  // caller to fall through to a normal 200 response.
  if (rangeHeader.includes(',')) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) return null // syntactically invalid -> ignore

  const startStr = match[1]
  const endStr = match[2]

  if (!startStr && !endStr) return null // "bytes=-" is not a valid spec

  let start: number
  let end: number

  if (!startStr && endStr) {
    // Suffix range: bytes=-500 means last 500 bytes
    const suffix = parseBytePosition(endStr)
    if (suffix === null) return null
    // RFC 7233: if suffix-length >= content-length, use entire content
    start = Math.max(0, fileSize - suffix)
    end = fileSize - 1
  } else if (startStr && !endStr) {
    // Open-ended range: bytes=500-
    const parsedStart = parseBytePosition(startStr)
    if (parsedStart === null) return null
    start = parsedStart
    end = fileSize - 1
  } else {
    const parsedStart = parseBytePosition(startStr)
    const parsedEnd = parseBytePosition(endStr)
    if (parsedStart === null || parsedEnd === null) return null
    start = parsedStart
    end = parsedEnd
    // RFC 7233: last-byte-pos < first-byte-pos -> syntactically invalid
    if (end < start) return null
    // RFC 7233: clamp last-byte-pos to content-length - 1 (not an error)
    end = Math.min(end, fileSize - 1)
  }

  // start >= fileSize means no byte of the file falls within the range
  if (start >= fileSize) return 'unsatisfiable'

  return { start, end }
}

/**
 * Streams a static file from baseDir to the client.
 * requestedPath is the raw value from the URL (percent-encoding is decoded internally).
 * Relative sub-paths such as "assets/logo.png" are accepted; anything that would resolve
 * outside baseDir is rejected - including ".." segments, absolute paths, and symlinks that
 * point outside the directory.
 * When request is provided, the following features are enabled:
 * - Conditional requests: If-None-Match and If-Modified-Since -> 304 Not Modified
 * - Range requests: GET + Range + strongEtags -> 206 Partial Content
 * - HEAD requests send the same metadata as GET without streaming the file body
 * Returns the response configured for streaming (200/206/304) or an error response (404).
 *
 * @param requestedPath Requested path relative to the static directory.
 * @param baseDir Base directory used for static file resolution.
 * @param response Response object used by the operation.
 * @param request Incoming request object.
 * @param options Optional configuration values.
 * @returns A promise that resolves to the operation result.
 */
export async function serveStaticFiles(
  requestedPath: string,
  baseDir: string,
  response: ODResponse,
  request?: ODRequest | null,
  options: ServeStaticOptions = {},
): Promise<ODResponse> {
  // Percent-decode so encoded separators (%2F) are resolved during validation.
  let filePath: string
  try {
    filePath = decodeURIComponent(requestedPath)
  } catch {
    return setStaticErrorResponse(response, 404, 'File not found')
  }

  // Reject obviously bad inputs early.
  // A colon is disallowed everywhere for predictable cross-platform behavior:
  // it blocks NTFS alternate data streams on Windows and avoids platform-specific
  // filename edge cases in this web-facing helper.
  if (!filePath || filePath.includes('\0') || filePath.includes(':')) {
    return setStaticErrorResponse(response, 404, 'File not found')
  }

  // Build an absolute, normalised candidate path and verify containment.
  // path.resolve handles '..', leading '/', Windows drive letters, and mixed separators,
  // so this check catches all traversal attempts before touching the filesystem.
  // All security-gate rejections return 404 to avoid leaking filesystem structure.
  const normalizedBase = path.resolve(baseDir)
  // Build the expected prefix: normalizedBase + separator.
  // If normalizedBase already ends with sep (e.g. filesystem root on Unix: '/'),
  // avoid doubling it so the prefix check stays correct.
  const separator = normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep
  const resolved = path.resolve(normalizedBase, filePath)
  if (!resolved.startsWith(separator)) {
    return setStaticErrorResponse(response, 404, 'File not found')
  }

  // Resolve the real (canonical) casing of baseDir once so that the post-symlink
  // containment check below works correctly on case-insensitive filesystems (Windows).
  let realBase: string
  try {
    realBase = await realpath(normalizedBase)
  } catch {
    return setStaticErrorResponse(response, 404, 'File not found')
  }
  const realBaseSeparator = realBase.endsWith(path.sep) ? realBase : realBase + path.sep

  // Open the file once and keep that handle for streaming so the final send
  // does not re-open by path after validation.
  let fileHandle: FileHandle
  try {
    // O_NONBLOCK prevents FIFOs and similar special files from stalling the request
    // before we can reject them via the post-open stat() check.
    fileHandle = await open(resolved, STATIC_FILE_OPEN_FLAGS)
  } catch {
    return setStaticErrorResponse(response, 404, 'File not found')
  }

  // Reject directories and device nodes - only regular files may be served.
  let fileStat: Awaited<ReturnType<FileHandle['stat']>>
  try {
    fileStat = await fileHandle.stat()
  } catch {
    await closeFile(fileHandle)
    return setStaticErrorResponse(response, 404, 'File not found')
  }

  if (!fileStat.isFile()) {
    await closeFile(fileHandle)
    return setStaticErrorResponse(response, 404, 'File not found')
  }

  // Resolve symlinks after opening, then verify the still-current path remains
  // inside baseDir and still points at the same file handle we opened.
  let real: string
  try {
    real = await realpath(resolved)
  } catch {
    await closeFile(fileHandle)
    return setStaticErrorResponse(response, 404, 'File not found')
  }

  if (!real.startsWith(realBaseSeparator)) {
    await closeFile(fileHandle)
    return setStaticErrorResponse(response, 404, 'File not found')
  }

  let currentPathStat: Awaited<ReturnType<typeof stat>>
  try {
    currentPathStat = await stat(real)
  } catch {
    await closeFile(fileHandle)
    return setStaticErrorResponse(response, 404, 'File not found')
  }

  if (!isSameFile(fileStat, currentPathStat)) {
    await closeFile(fileHandle)
    return setStaticErrorResponse(response, 404, 'File not found')
  }

  const fileSize = fileStat.size
  const mtime = fileStat.mtime
  let etag = `W/"${mtime.getTime().toString(16)}-${fileSize.toString(16)}"`
  if (options.strongEtags) {
    try {
      etag = await buildStrongEtag(fileHandle, fileSize)
    } catch {
      await closeFile(fileHandle)
      return setStaticErrorResponse(response, 404, 'File not found')
    }
  }
  const lastModified = mtime.toUTCString()

  // Determine MIME type (built-in table merged with caller-supplied overrides).
  const ext = path.extname(filePath).toLowerCase()
  const mimes = options.mimeTypes ? { ...MIME_TYPES, ...options.mimeTypes } : MIME_TYPES
  const baseMime = mimes[ext] ?? 'application/octet-stream'
  const isTextMime = baseMime.startsWith('text/') ||
    baseMime === 'application/json' ||
    baseMime === 'application/javascript' ||
    baseMime === 'application/xml'
  const contentType = (options.charset && isTextMime)
    ? `${baseMime}; charset=${options.charset}`
    : baseMime

  const cacheControl = options.cacheControl !== undefined ? options.cacheControl : 'public, max-age=3600'
  if (cacheControl !== false) {
    response.setHeader('Cache-Control', cacheControl)
  } else {
    response.setHeader('Cache-Control', null)
  }
  response.setHeader('ETag', etag)
  response.setHeader('Last-Modified', lastModified)
  response.setHeader('Accept-Ranges', options.strongEtags ? 'bytes' : null)
  response.setHeader('Content-Range', null)

  const method = request?.method ?? 'GET'
  const isHeadRequest = method === 'HEAD'
  const isGetOrHeadRequest = method === 'GET' || isHeadRequest

  // Conditional request handling (requires the request object)
  if (request) {
    const ifNoneMatch = request.getHeader('if-none-match')
    if (ifNoneMatch !== undefined) {
      if (matchesIfNoneMatch(ifNoneMatch, etag)) {
        await closeFile(fileHandle)
        if (isGetOrHeadRequest) return setNotModifiedResponse(response)
        return setStaticErrorResponse(response, 412, 'Precondition Failed')
      }
    } else if (isGetOrHeadRequest) {
      const ifModifiedSince = request.getHeader('if-modified-since')
      const mtimeSeconds = Math.floor(mtime.getTime() / 1000) * 1000
      const ifModifiedSinceTime = ifModifiedSince !== undefined ? parseHttpDate(ifModifiedSince) : null
      if (ifModifiedSinceTime !== null && ifModifiedSinceTime >= mtimeSeconds) {
        await closeFile(fileHandle)
        return setNotModifiedResponse(response)
      }
    }

    // 206 responses must not use weak validators, so disable range processing
    // unless strong ETags are enabled for this response.
    const rangeHeader = request.getHeader('range')
    if (method === 'GET' && rangeHeader && options.strongEtags) {
      const ifRange = request.getHeader('if-range')
      if (ifRange === undefined || matchesIfRange(ifRange, etag, mtime)) {
        const range = parseRange(rangeHeader, fileSize)
        // null = syntactically invalid -> RFC 7233 says ignore and serve 200
        if (range === 'unsatisfiable') {
          setStaticErrorResponse(response, 416, 'Range Not Satisfiable')
          response.setHeader('Content-Range', `bytes */${fileSize}`)
          // Remove caching headers that were added for the file — they are not
          // appropriate on a 416 error response and must not be cached by intermediaries.
          response.setHeader('Cache-Control', null)
          response.setHeader('ETag', null)
          response.setHeader('Last-Modified', null)
          await closeFile(fileHandle)
          return response
        }

        if (range !== null) {
          const { start, end } = range
          const chunkSize = end - start + 1
          response.code = 206
          response.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`)
          response.setHeader('Content-Length', String(chunkSize))
          return response.stream(fileHandle.createReadStream({ start, end }), contentType)
        }
        // range === null (syntactically invalid) -> fall through and serve 200
      }
      // Failed If-Range validators disable range processing and fall through to 200.
    }
  }

  response.code = 200
  response.setHeader('Content-Length', String(fileSize))
  if (isHeadRequest) return streamHeadResponse(response, fileHandle, contentType)
  return response.stream(fileHandle.createReadStream({ start: 0 }), contentType)
}
