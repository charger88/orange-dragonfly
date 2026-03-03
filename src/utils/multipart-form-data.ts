import { isDangerousKey } from './sanitize-input'
import { applyKeyValueToObject } from './magic-query-parser'

export interface MultipartPart {
  name: string
  value: string | Buffer
  filename: string | null
  contentType: string | null
  headers: Record<string, string>
}

/**
 * Stateful parser for multipart/form-data payloads that splits boundaries, part headers, and values into a plain object result.
 */
export default class MultipartFormDataParser {

  /**
   * Extracts a parameter value from a semicolon-delimited header value.
   * Accepts both quoted-string and token forms.
   *
   * @param header Header value to inspect.
   * @param parameterName Parameter name to find.
   * @returns The decoded parameter value, or null when absent.
   */
  private static _extractHeaderParameter(header: string, parameterName: string): string | null {
    const escapedParameterName = parameterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(
      `(?:^|;)\\s*${escapedParameterName}\\s*=\\s*(?:"((?:\\\\.|[^"\\\\])*)"|([^;]*))`,
      'i',
    )
    const match = pattern.exec(header)
    if (!match) return null
    return match[1] != null ? match[1].replace(/\\(.)/g, '$1') : match[2].trim()
  }

  /**
   * Decodes a text part using the declared charset when provided.
   * Defaults to UTF-8 and rejects unsupported charsets instead of silently
   * decoding with the wrong codec.
   *
   * @param valueBuf Raw text payload.
   * @param contentType Content-Type header value.
   * @returns The decoded string value.
   */
  private _decodeTextValue(valueBuf: Buffer, contentType: string | null): string {
    if (!contentType) return valueBuf.toString('utf-8')
    const charset = MultipartFormDataParser._extractHeaderParameter(contentType, 'charset')
    if (!charset) return valueBuf.toString('utf-8')

    const normalized = charset.toLowerCase() === 'binary'
      ? 'latin1'
      : charset.toLowerCase()

    try {
      return new TextDecoder(normalized).decode(valueBuf)
    } catch {
      throw new Error(`Unsupported multipart text charset: ${charset}`)
    }
  }

  /**
   * Extracts the boundary string from the Content-Type header details.
   * Expects a string like `boundary=----WebKitFormBoundary...`
   *
   * @param contentTypeDetails Content-Type parameter string (for example the multipart boundary).
   * @returns The multipart boundary string, or null when not present.
   */
  static extractBoundary(contentTypeDetails: string): string | null {
    const boundary = MultipartFormDataParser._extractHeaderParameter(contentTypeDetails, 'boundary')
    return boundary ? boundary : null
  }

  /**
   * Parses the Content-Disposition header value.
   * Extracts the disposition type plus `name` and optional `filename`
   * parameters, accepting both quoted-string and token values.
   *
   * @param header Header value to parse.
   * @returns Parsed disposition metadata.
   */
  private _parseContentDisposition(header: string): { type: string | null; name: string | null; filename: string | null } {
    const [typeSegment = ''] = header.split(';', 1)
    let name: string | null = null
    let filename: string | null = null
    const paramPattern = /(?:^|;)\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))/g
    let match: RegExpExecArray | null

    while ((match = paramPattern.exec(header)) !== null) {
      const key = match[1].toLowerCase()
      const value = match[2] != null ? match[2].replace(/\\(.)/g, '$1') : match[3].trim()

      if (key === 'name' && name === null) name = value
      if (key === 'filename' && filename === null) filename = value
    }

    return {
      type: typeSegment.trim().toLowerCase() || null,
      name,
      filename,
    }
  }

  /**
   * Parses the headers block of a single multipart part.
   * Returns a lowercase-keyed record of header values.
   *
   * @param headerLines Header lines for a multipart part.
   * @returns Lowercase-keyed multipart part headers.
   */
  private _parsePartHeaders(headerLines: string[]): Record<string, string> {
    const headers: Record<string, string> = {}
    let currentKey: string | null = null
    for (const line of headerLines) {
      if (/^\s/.test(line) && currentKey) {
        // Continuation of previous header (folded header)
        headers[currentKey] += ' ' + line.trim()
      } else {
        const colonIndex = line.indexOf(':')
        if (colonIndex !== -1) {
          currentKey = line.slice(0, colonIndex).trim().toLowerCase()
          headers[currentKey] = line.slice(colonIndex + 1).trim()
        } else {
          currentKey = null
        }
      }
    }
    return headers
  }

  /**
   * Detects whether a field name uses balanced bracket notation that should be
   * delegated to the query-path parser. Unbalanced names stay literal.
   *
   * @param fieldName Field name to inspect.
   * @returns True when the field name uses balanced bracket notation.
   */
  private _usesBracketNotation(fieldName: string): boolean {
    let depth = 0
    let sawBracket = false

    for (const ch of fieldName) {
      if (ch === '[') {
        depth++
        sawBracket = true
      } else if (ch === ']') {
        if (depth === 0) return false
        depth--
      }
    }

    return sawBracket && depth === 0
  }

  /**
   * Finds delimiter lines by matching the boundary only at the beginning of a
   * candidate line, which is how MIME multipart delimiters are defined.
   *
   * @param buf Buffer input.
   * @param needle Boundary delimiter bytes (`--` + boundary).
   * @returns Delimiter offsets and whether each one is the closing delimiter.
   */
  private _findDelimiters(buf: Buffer, needle: Buffer): Array<{ index: number; isClosing: boolean }> {
    const delimiters: Array<{ index: number; isClosing: boolean }> = []
    let offset = 0
    while (offset <= buf.length - needle.length) {
      const idx = buf.indexOf(needle, offset)
      if (idx === -1) break
      if (idx === 0 || buf[idx - 1] === 0x0A /* \n */) {
        let cursor = idx + needle.length
        let isClosing = false

        if (buf[cursor] === 0x2D /* - */ && buf[cursor + 1] === 0x2D /* - */) {
          isClosing = true
          cursor += 2
        }

        while (buf[cursor] === 0x20 /* space */ || buf[cursor] === 0x09 /* tab */) cursor++

        if (cursor === buf.length || buf[cursor] === 0x0A /* \n */ || buf[cursor] === 0x0D /* \r */) {
          delimiters.push({ index: idx, isClosing })
        }
      }
      offset = idx + needle.length
    }
    return delimiters
  }

  /**
   * Parses a multipart/form-data body into structured parts.
   *
   * @param body Raw body as Buffer or string
   * @param boundary Boundary string (without leading --)
   * @returns Array of parsed parts
   */
  parse(body: Buffer | string, boundary: string): MultipartPart[] {
    const buf = typeof body === 'string' ? Buffer.from(body) : body

    // Per RFC 2046, body delimiters use --boundary
    const delimiterStr = '--' + boundary
    const delimiterBuf = Buffer.from(delimiterStr)
    const crlfHeaderSep = Buffer.from('\r\n\r\n')
    const lfHeaderSep = Buffer.from('\n\n')

    // Find all delimiter lines and stop parsing when we reach the close delimiter.
    const delimiters = this._findDelimiters(buf, delimiterBuf)
    if (delimiters.length === 0) {
      throw new Error('Multipart boundary delimiter not found')
    }

    const closingDelimiterIndex = delimiters.findIndex(delimiter => delimiter.isClosing)
    if (closingDelimiterIndex === -1) {
      throw new Error('Multipart closing boundary delimiter not found')
    }

    const parts: MultipartPart[] = []

    for (let i = 0; i < closingDelimiterIndex; i++) {
      const current = delimiters[i]

      // Each part is between consecutive delimiter lines.
      const next = delimiters[i + 1]
      const partStart = current.index + delimiterBuf.length
      const partEnd = next.index
      const partBuf = buf.subarray(partStart, partEnd)

      // Strip leading linebreak after delimiter
      let offset = 0
      if (partBuf[0] === 0x0D && partBuf[1] === 0x0A) offset = 2
      else if (partBuf[0] === 0x0A) offset = 1

      const content = partBuf.subarray(offset)
      const crlfSepIdx = content.indexOf(crlfHeaderSep)
      const lfSepIdx = content.indexOf(lfHeaderSep)

      let lineBreak = '\n'
      let sepIdx = lfSepIdx
      let headerSepLength = lfHeaderSep.length

      if (crlfSepIdx !== -1 && (lfSepIdx === -1 || crlfSepIdx < lfSepIdx)) {
        lineBreak = '\r\n'
        sepIdx = crlfSepIdx
        headerSepLength = crlfHeaderSep.length
      }

      // Split headers from body
      if (sepIdx === -1) {
        throw new Error('Multipart part is missing header/body separator')
      }

      const headersBlock = content.subarray(0, sepIdx).toString('utf-8')
      let valueBuf = content.subarray(sepIdx + headerSepLength)

      // Remove trailing linebreak (part of MIME structure, not the value)
      const lb = Buffer.from(lineBreak)
      if (valueBuf.length >= lb.length &&
          valueBuf.subarray(valueBuf.length - lb.length).equals(lb)) {
        valueBuf = valueBuf.subarray(0, valueBuf.length - lb.length)
      }

      const headerLines = headersBlock.split(lineBreak)
      const headers = this._parsePartHeaders(headerLines)

      const disposition = headers['content-disposition']
      if (!disposition) continue

      const { type, name, filename } = this._parseContentDisposition(disposition)
      if (type !== 'form-data' || name === null) continue

      const contentType = headers['content-type'] || null

      // File parts keep the Buffer; text fields convert to string
      const value = filename !== null
        ? Buffer.from(valueBuf)
        : this._decodeTextValue(valueBuf, contentType)

      parts.push({ name, value, filename, contentType, headers })
    }

    return parts
  }

  /**
   * Converts parsed parts into a key-value object.
   * Supports full bracket notation in field names including nested paths
   * (e.g. `user[name]`, `tags[]`, `items[0]`, `items[][id]`) via
   * MagicQueryParser's path logic, where only empty brackets create arrays.
   * This keeps multipart and application/x-www-form-urlencoded parsing consistent.
   * Flat fields with the same name (no brackets) are collected into arrays.
   * File parts carry `{ filename, contentType, data }` as their value.
   *
   * @param parts Parsed multipart parts.
   * @returns Object representation of the parsed multipart payload.
   */
  toObject(parts: MultipartPart[]): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const part of parts) {
      if (isDangerousKey(part.name)) continue

      const val: unknown = part.filename !== null
        ? { filename: part.filename, contentType: part.contentType, data: part.value }
        : part.value

      if (this._usesBracketNotation(part.name)) {
        // Delegate all bracket-notation parsing to MagicQueryParser so nested
        // paths like items[][name] are handled correctly and consistently.
        applyKeyValueToObject(result, part.name, val)
      } else {
        // Flat field: group duplicate names into an array.
        if (Object.hasOwn(result, part.name)) {
          const existing = result[part.name]
          if (Array.isArray(existing)) {
            existing.push(val)
          } else {
            result[part.name] = [existing, val]
          }
        } else {
          result[part.name] = val
        }
      }
    }

    return result
  }
}

const defaultParser = new MultipartFormDataParser()

/**
 * Parses a multipart/form-data body and returns a key-value object.
 *
 * @param body Raw body as Buffer or string
 * @param boundary Boundary string (without leading --)
 * @returns Parsed fields as key-value object
 */
export function parseMultipartFormData(body: Buffer | string, boundary: string): Record<string, unknown> {
  return defaultParser.toObject(defaultParser.parse(body, boundary))
}
