export interface ODResponseHeader {
  name: string
  value: string
}

import { Readable } from 'stream'

export type ODResponseContent = string | Record<string, unknown> | unknown[] | Buffer | Blob | Readable

export interface ODResponseOptions {
  compactJsonResponse?: boolean
}

/**
 * Mutable response container that accumulates status, headers, and content before transport serialization.
 */
export default class ODResponse {
  private _code!: number
  private _content!: ODResponseContent
  private _headers!: ODResponseHeader[]
  private _sent: boolean = false
  private _compactJsonResponse: boolean

  /**
   * Initializes internal state for this OD Response.
   *
   * @param code HTTP status code.
   * @param content Content value.
   * @param headers Headers map or list.
   * @param options Optional configuration values.
   */
  constructor(
    code: number = 200,
    content: ODResponseContent = '',
    headers: ODResponseHeader[] = [],
    options: ODResponseOptions = {},
  ) {
    this.code = code
    this.content = content
    this.headers = headers
    this._compactJsonResponse = options.compactJsonResponse ?? true
  }

  /**
   * Returns whether the response has already been sent.
   *
   * @returns Whether the response has already been sent.
   */
  get sent(): boolean {
    return this._sent
  }

  /**
   * Marks the response as sent so transports do not write it more than once.
   */
  markSent(): void {
    this._sent = true
  }

  /**
   * Sets the response status code.
   *
   * @param code HTTP status code.
   */
  set code(code: number) {
    this._code = code
  }

  /**
   * Returns the response status code.
   *
   * @returns The response status code.
   */
  get code(): number {
    return this._code
  }

  /**
   * Sets the response content payload.
   *
   * @param content Content value.
   */
  set content(content: ODResponseContent) {
    this._releaseContent(this._content, content)
    this._content = content
  }

  /**
   * Returns the response content payload.
   *
   * @returns The response content payload.
   */
  get content(): ODResponseContent {
    return this._content
  }

  /**
   * Releases any active streaming content held by this response.
   *
   * @returns This instance for chaining.
   */
  dispose(): this {
    this._releaseContent(this._content)
    this._content = ''
    return this
  }

  /**
   * Sets the response headers list.
   *
   * @param headers Header entries.
   */
  set headers(headers: ODResponseHeader[]) {
    this._headers = headers
  }

  /**
   * Returns the response headers list.
   *
   * @returns The response headers list.
   */
  get headers(): ODResponseHeader[] {
    return this._headers
  }

  /**
   * Appends a response header without removing existing values for the same header name.
   *
   * @param name Header name.
   * @param value Header value.
   * @returns This instance for chaining.
   */
  addHeader(name: string, value: string): this {
    this._headers.push({ name, value })
    return this
  }

  /**
   * Replaces existing values for a header name and optionally writes a new value.
   *
   * @param name Header name.
   * @param value New header value, or null to remove the header.
   * @returns This instance for chaining.
   */
  setHeader(name: string, value: string|null = null): this {
    const lowerName = name.toLowerCase()
    this._headers = this._headers.filter(h => h.name.toLowerCase() !== lowerName)
    if (value !== null) {
      this._headers.push({ name, value })
    }
    return this
  }

  /**
   * Sets an error response payload with a standard `{ error, ...data }` shape.
   *
   * @param code HTTP status code.
   * @param error Error message string.
   * @param data Additional fields to merge into the error response body.
   * @returns This instance for chaining.
   */
  setError(code: number, error: string, data: Record<string, unknown> = {}): this {
    this.code = code
    this.content = { error, ...data }
    return this
  }

  /**
   * Configures the response to send a readable stream as the response body.
   *
   * @param readable Readable stream.
   * @param contentType Content-Type header value.
   * @returns This instance for chaining.
   */
  stream(readable: Readable, contentType: string): this {
    this.content = readable
    this.setHeader('Content-Type', contentType)
    return this
  }

  /**
   * Destroys a replaced stream so abandoned responses do not leak resources.
   *
   * @param current Current content value.
   * @param replacement Replacement content value, when applicable.
   */
  private _releaseContent(
    current: ODResponseContent | undefined,
    replacement?: ODResponseContent,
  ): void {
    if (current === undefined || current === replacement) return
    if (current instanceof Readable) current.destroy()
  }

  /**
   * Converts the stored response content into a transport-ready content type and payload pair.
   *
   * @returns A promise that resolves to the operation result.
   */
  async convert(): Promise<[string | null, Buffer | string]> {
    if (this._code === 204 || this._code === 304) {
      return [null, '']
    }
    const { content } = this
    if (content instanceof Blob) {
      return [content.type ?? null, Buffer.from(await content.arrayBuffer())]
    }
    if (content instanceof Buffer) {
      return [null, content]
    }
    if (content === null) {
      return [null, '']
    }
    if (content instanceof Readable) {
      throw new Error('Readable streams cannot be converted; use the streaming path in writeResponse()')
    }
    if (typeof content === 'object') {
      return ['application/json; charset=utf-8', JSON.stringify(content, null, this._compactJsonResponse ? undefined : 2)]
    }
    if (typeof content === 'string') {
      return ['text/plain; charset=utf-8', content]
    }
    throw new Error(`Unknown response content of type: "${typeof content}"`)
  }
}
