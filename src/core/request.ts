import { randomUUID } from 'crypto'
import { isIP } from 'net'
import MagicQueryParser, { parseQuery } from '../utils/magic-query-parser'
import MultipartFormDataParser from '../utils/multipart-form-data'
import { sanitizeInput } from '../utils/sanitize-input'
import ODRequestError from './request-error'

type ParsedBody = Record<string, unknown> | unknown[] | string | number | boolean | null

export interface ODRequestInit {
  method: string
  url: string
  headers?: Record<string, string>
  body?: Buffer | string
  ip?: string
  id?: string
  /** Transport protocol. Used to construct accurate absolute URLs. Default: 'http'. */
  protocol?: 'http' | 'https'
}

export interface ODRequestOptions {
  queryParser?: MagicQueryParser
  /**
   * List of trusted proxy IP addresses. When the connecting IP matches one of
   * these values, the real client IP is read from the X-Forwarded-For header
   * using a right-to-left traversal: the rightmost untrusted IP is used.
   * Only set this if your app runs behind a known reverse proxy you control.
   */
  trustedProxy?: string[]
}

/**
 * Normalizes an IPv4-mapped IPv6 address (::ffff:x.x.x.x) to its plain IPv4
 * form. Node.js reports socket.remoteAddress as ::ffff:127.0.0.1 for loopback
 * connections even when the client is IPv4-only.
 *
 * @param ip IP address string.
 * @returns The computed result.
 */
export function normalizeIp(ip: string): string {
  if (ip.toLowerCase().startsWith('::ffff:')) {
    const mapped = ip.slice(7)
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(mapped)) return mapped
  }
  return ip
}

/**
 * Framework request wrapper that normalizes incoming HTTP data and exposes derived URL, header, query, and body helpers.
 */
export default class ODRequest {
  private _method!: string
  private _url!: string
  private _headers!: Record<string, string>
  private _u!: URL
  private _protocol: 'http' | 'https'
  private _query: Record<string, unknown> | null = null
  private _querySearchParams: URLSearchParams | null = null
  private _rawBody: Buffer
  private _parsedBody: ParsedBody = null
  private _parsedBodyCreated: boolean = false
  private _queryParser: MagicQueryParser | null
  id: string
  ip: string
  now: number

  /**
   * Initializes internal state for this OD Request.
   *
   * @param request Incoming request object.
   * @param options Optional configuration values.
   */
  constructor(request: ODRequestInit, options: ODRequestOptions = {}) {
    this._protocol = request.protocol ?? 'http'
    this.method = request.method
    this.url = request.url
    this.headers = request.headers ?? {} // Also re-parses URL with real host (see url setter)
    this.id = request.id ?? randomUUID()
    // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 -> 127.0.0.1) immediately
    this.ip = normalizeIp(request.ip ?? '0.0.0.0')
    this.now = Date.now()
    this._rawBody = typeof request.body === 'string' ? Buffer.from(request.body) : (request.body ?? Buffer.alloc(0))
    this._queryParser = options.queryParser ?? null
    if (options.trustedProxy) {
      this.resolveTrustedProxy(options.trustedProxy)
    }
  }

  /**
   * Sets the query Parser value.
   *
   * @param parser Query parser instance to use for query-string parsing.
   */
  set queryParser(parser: MagicQueryParser | null) {
    this._queryParser = parser
  }

  /**
   * Resolves the real client IP from the X-Forwarded-For header when the
   * current IP belongs to a trusted proxy.
   * Uses right-to-left traversal per RFC 7239: starting from the rightmost
   * entry (set by the last proxy before us), each IP is checked against the
   * trusted list. The first untrusted IP encountered is the real client address.
   * This prevents spoofing via attacker-controlled leftmost entries.
   * Called by `ODApp.processRequest` using the app-level `trustedProxy`
   * configuration. Can also be called directly by custom transport layers
   * before handing the request off.
   *
   * @param trustedProxy Trusted proxy IP addresses.
   */
  resolveTrustedProxy(trustedProxy: string[]): void {
    if (trustedProxy.length === 0 || !trustedProxy.includes(this.ip)) return
    const forwarded = this.getHeader('x-forwarded-for')
    if (!forwarded) return
    const ips = forwarded.split(',').map(ip => normalizeIp(ip.trim()))
    // Walk right-to-left, skipping each trusted proxy. The first IP that is
    // NOT in the trusted list is the real client address.
    for (let i = ips.length - 1; i >= 0; i--) {
      if (!trustedProxy.includes(ips[i])) {
        if (isIP(ips[i]) !== 0) this.ip = ips[i]
        break
      }
    }
  }

  /**
   * Returns the normalized HTTP method.
   *
   * @returns The normalized HTTP method.
   */
  get method(): string {
    return this._method
  }

  /**
   * Sets the normalized HTTP method.
   *
   * @param method HTTP method name.
   */
  set method(method: string) {
    this._method = method.toUpperCase()
  }

  /**
   * Returns the raw request URL path and query string.
   *
   * @returns The raw request URL path and query string.
   */
  get url(): string {
    return this._url
  }

  /**
   * Sets the raw request URL path and query string.
   *
   * @param url URL string.
   */
  set url(url: string) {
    this._url = url
    this._rebuildURLRelatedData()
  }

  /**
   * Returns the normalized lowercase request headers map.
   *
   * @returns The normalized lowercase request headers map.
   */
  get headers(): Record<string, string> {
    return this._headers
  }

  /**
   * Sets the normalized lowercase request headers map.
   *
   * @param headers Header entries.
   */
  set headers(headers: Record<string, string>) {
    const h: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
      h[k.toLowerCase()] = v
    }
    this._headers = h
    this._rebuildURLRelatedData()
  }

  /**
   * Returns the request protocol used to build absolute URLs.
   *
   * @returns The request protocol used to build absolute URLs.
   */
  get protocol(): 'http' | 'https' {
    return this._protocol
  }

  /**
   * Returns the request host (hostname and port) from the parsed URL.
   *
   * @returns The request host (hostname and port) from the parsed URL.
   */
  get host(): string {
    return this._u.host
  }

  /**
   * Returns the request hostname from the parsed URL.
   *
   * @returns The request hostname from the parsed URL.
   */
  get hostname(): string {
    return this._u.hostname
  }

  /**
   * Returns the request port from the parsed URL, or null when not present.
   *
   * @returns The request port from the parsed URL, or null when not present.
   */
  get port(): number | null {
    return this._u.port ? parseInt(this._u.port) : null
  }

  /**
   * Returns the request pathname.
   *
   * @returns The request pathname.
   */
  get path(): string {
    return this._u.pathname
  }

  /**
   * Returns the parsed query object (lazily parsed and cached).
   *
   * @returns The parsed query object (lazily parsed and cached).
   */
  get query(): Record<string, unknown> {
    if (this._query === null) {
      if (this._u.search) {
        const qs = this._u.search.slice(1)
        this._query = this._parseAndSanitize(
          () => this._queryParser ? this._queryParser.parse(qs) : parseQuery(qs),
          'Invalid query string',
        )
      } else {
        this._query = {}
      }
    }
    return this._query
  }

  /**
   * Returns URLSearchParams for the request query string (lazily created and cached).
   *
   * @returns URLSearchParams for the request query string (lazily created and cached).
   */
  get querySearchParams(): URLSearchParams {
    if (this._querySearchParams === null) {
      this._querySearchParams = new URLSearchParams(this._u.search)
    }
    return this._querySearchParams
  }

  /**
   * Sets the parsed request body (lazily parsed and cached).
   *
   * @param rawBody Raw body content.
   */
  set body(rawBody: Buffer | string) {
    this._rawBody = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody
    this._parsedBodyCreated = false
    this._parsedBody = null
  }

  /**
   * Returns the parsed request body (lazily parsed and cached).
   *
   * @returns The parsed request body (lazily parsed and cached).
   */
  get body(): ParsedBody {
    return this._parsedBodyCreated ? this._parsedBody : this._parseBody()
  }

  /**
   * Returns the raw request body buffer.
   *
   * @returns The raw request body buffer.
   */
  get rawBody(): Buffer {
    return this._rawBody
  }

  /**
   * Returns the normalized request Content-Type without parameters.
   *
   * @returns The normalized request Content-Type without parameters.
   */
  get contentType(): string {
    const contentType = this.getHeader('content-type', '').split(';')
    return contentType[0].trim().toLowerCase()
  }

  /**
   * Returns the Content-Type parameters portion of the request header.
   *
   * @returns The Content-Type parameters portion of the request header.
   */
  get contentTypeDetails(): string {
    const contentType = this.getHeader('content-type', '').split(';')
    return contentType.length > 1 ? contentType.slice(1).map(v => v.trim()).join(';') : ''
  }

  /**
   * Returns the most-preferred non-wildcard content type from the Accept header,
   * respecting quality values (q=) per RFC 7231 §5.3.2.
   * Falls back to 'application/json' when the request Content-Type contains 'json'
   * and no usable Accept type is found.
   *
   * @returns The preferred response content type derived from the Accept header, or a JSON fallback when applicable.
   */
  get expectedResponseContentType(): string | null {
    const accept = this.getHeader('accept')
    if (accept && accept.length) {
      // Parse each media type with its quality value (default q=1.0) and
      // filter out wildcards, then sort descending by q.
      const types = accept
        .split(',')
        .map(part => {
          const segments = part.trim().split(';')
          const mediaType = segments[0].trim()
          const qParam = segments.slice(1).find(s => s.trim().toLowerCase().startsWith('q='))
          const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1.0
          return { mediaType, q: Number.isFinite(q) ? q : 1.0 }
        })
        .filter(t => t.q > 0)
        .filter(t => !t.mediaType.includes('*'))
        .sort((a, b) => b.q - a.q)
      if (types.length > 0) return types[0].mediaType
    }
    // Fallback: infer from request Content-Type
    const requestContentType = this.contentType
    if (requestContentType && requestContentType.includes('json')) {
      return 'application/json'
    }
    return null
  }

  /**
   * Returns whether the current request content type should be parsed as JSON.
   *
   * @param contentType Normalized content type value.
   * @returns True when the body should be parsed as JSON.
   */
  private _isJsonContentType(contentType: string): boolean {
    return contentType === 'application/json' || contentType.endsWith('+json')
  }

  /**
   * Recomputes cached URL-derived fields after the request URL changes.
   */
  private _rebuildURLRelatedData() {
    if (this._headers !== undefined && this._url !== undefined) {
      this._u = new URL(`${this._protocol ?? 'http'}://${this.getHeader('host', 'localhost')}${this._url}`)
      this._query = null
      this._querySearchParams = null
    }
  }

  /**
   * Runs a parser and sanitizes its result, mapping parser/sanitizer failures to a request error.
   *
   * @param parser Parser callback.
   * @param message Error message to surface on failure.
   * @returns The parsed and sanitized value.
   */
  private _parseAndSanitize<T>(parser: () => T, message: string): T {
    try {
      return sanitizeInput(parser())
    } catch (e) {
      if (e instanceof ODRequestError) throw e
      throw new ODRequestError(400, message)
    }
  }

  /**
   * Parses the raw request body based on the current content type and stores the normalized value.
   */
  private _parseBody() {
    const contentType = this.contentType
    if (contentType === 'multipart/form-data') {
      const boundary = MultipartFormDataParser.extractBoundary(this.contentTypeDetails)
      if (!boundary) {
        throw new ODRequestError(400, 'Invalid multipart form body')
      }
      const parser = new MultipartFormDataParser()
      this._parsedBody = this._parseAndSanitize(
        () => parser.toObject(parser.parse(this._rawBody, boundary)),
        'Invalid multipart form body',
      )
    } else {
      const bodyStr = this._rawBody.toString('utf-8')
      if (contentType === 'application/x-www-form-urlencoded') {
        this._parsedBody = this._parseAndSanitize(
          () => this._queryParser ? this._queryParser.parse(bodyStr) : parseQuery(bodyStr),
          'Invalid form body',
        )
      } else if (this._isJsonContentType(contentType)) {
        this._parsedBody = this._parseAndSanitize(() => JSON.parse(bodyStr), 'Invalid JSON body')
      } else if (!contentType) {
        let parsedBody: ParsedBody
        try {
          parsedBody = JSON.parse(bodyStr) as ParsedBody
        } catch {
          this._parsedBody = bodyStr
          this._parsedBodyCreated = true
          return this._parsedBody
        }
        this._parsedBody = this._parseAndSanitize(() => parsedBody, 'Invalid JSON body')
      } else {
        this._parsedBody = bodyStr
      }
    }
    this._parsedBodyCreated = true
    return this._parsedBody
  }

  getHeader(name: string, def: string): string
  getHeader(name: string, def?: string): string | undefined
  /**
   * Returns a header value using case-insensitive header lookup.
   *
   * @param name Header name.
   * @param def Default value returned when the requested value is missing.
   * @returns The header value, or the provided default when the header is missing.
   */
  getHeader(name: string, def: string | undefined = undefined): string | undefined {
    return this.headers[name.toLowerCase()] ?? def
  }

  /**
   * Returns a value from the parsed query object, or the provided default when missing.
   *
   * @param name Query parameter name.
   * @param def Default value returned when the requested value is missing.
   * @returns The query parameter value, or the provided default when it is missing.
   */
  getQueryParam(name: string, def: unknown = null): unknown {
    return Object.hasOwn(this.query, name) ? this.query[name] : def
  }
}

