import ODContext from '../core/context'
import { ODMiddlewareFunction } from '../core/middleware'

export interface ODSecurityHeadersHSTSOptions {
  /** max-age in seconds. Default: 31536000 (1 year) */
  maxAge?: number
  /** Include the includeSubDomains directive. Default: false */
  includeSubDomains?: boolean
  /** Include the preload directive. Default: false */
  preload?: boolean
}

export interface ODSecurityHeadersOptions {
  /**
   * X-Content-Type-Options header.
   * Prevents MIME-type sniffing.
   * Default: 'nosniff'
   * Set to false to omit.
   */
  contentTypeOptions?: 'nosniff' | false

  /**
   * X-Frame-Options header.
   * Controls whether the page can be embedded in a frame.
   * Common values: 'DENY', 'SAMEORIGIN'
   * Default: not set (omitted)
   * Set to false to explicitly omit.
   */
  frameOptions?: string | false

  /**
   * Strict-Transport-Security header (HSTS).
   * Only effective when the site is served over HTTPS.
   * Default: not set (omitted) - must be explicitly enabled.
   * Set to false to explicitly omit.
   */
  hsts?: ODSecurityHeadersHSTSOptions | false

  /**
   * Content-Security-Policy header value (raw string).
   * Example: "default-src 'self'; script-src 'self' 'nonce-{nonce}'"
   * Default: not set (omitted)
   * Set to false to explicitly omit.
   */
  contentSecurityPolicy?: string | false

  /**
   * Referrer-Policy header value.
   * Example: 'strict-origin-when-cross-origin'
   * Default: not set (omitted)
   * Set to false to explicitly omit.
   */
  referrerPolicy?: string | false

  /**
   * Permissions-Policy header value (raw string).
   * Example: 'camera=(), microphone=(), geolocation=(self)'
   * Default: not set (omitted)
   * Set to false to explicitly omit.
   */
  permissionsPolicy?: string | false

  /**
   * Cross-Origin-Opener-Policy header value.
   * Example: 'same-origin'
   * Default: not set (omitted)
   * Set to false to explicitly omit.
   */
  crossOriginOpenerPolicy?: string | false

  /**
   * Cross-Origin-Embedder-Policy header value.
   * Example: 'require-corp'
   * Default: not set (omitted)
   * Set to false to explicitly omit.
   */
  crossOriginEmbedderPolicy?: string | false

  /**
   * Cross-Origin-Resource-Policy header value.
   * Example: 'same-origin'
   * Default: not set (omitted)
   * Set to false to explicitly omit.
   */
  crossOriginResourcePolicy?: string | false
}

/**
 * Validates and normalizes the configured HSTS header value.
 *
 * @param hsts Raw HSTS options.
 * @returns A serialized Strict-Transport-Security header value.
 */
function buildHSTSValue(hsts: ODSecurityHeadersHSTSOptions): string {
  const maxAge = hsts.maxAge ?? 31536000
  if (!Number.isInteger(maxAge) || maxAge < 0) {
    throw new Error('ODSecurityHeadersMiddleware: hsts.maxAge must be a non-negative integer')
  }
  if (hsts.preload) {
    if (!hsts.includeSubDomains) {
      throw new Error('ODSecurityHeadersMiddleware: hsts.preload requires includeSubDomains:true')
    }
    if (maxAge < 31536000) {
      throw new Error('ODSecurityHeadersMiddleware: hsts.preload requires maxAge >= 31536000')
    }
  }

  let value = `max-age=${maxAge}`
  if (hsts.includeSubDomains) value += '; includeSubDomains'
  if (hsts.preload) value += '; preload'
  return value
}

/**
 * Middleware that adds security-related HTTP response headers.
 * All headers are opt-in (or have safe defaults) - nothing is added without configuration.
 * Only X-Content-Type-Options has a default value ('nosniff'); all other headers
 * must be explicitly configured. This keeps the middleware non-breaking for existing
 * deployments and lets you adopt headers incrementally.
 *
 * @example
 * app.useMiddleware(ODSecurityHeadersMiddleware({
 * frameOptions: 'SAMEORIGIN',
 * hsts: { maxAge: 63072000, includeSubDomains: true },
 * contentSecurityPolicy: "default-src 'self'",
 * referrerPolicy: 'strict-origin-when-cross-origin',
 * }))
 * @param options Optional configuration values.
 * @returns A configured middleware function.
 */
export default function ODSecurityHeadersMiddleware(options: ODSecurityHeadersOptions = {}): ODMiddlewareFunction {
  const contentTypeOptions = options.contentTypeOptions !== false
    ? (options.contentTypeOptions ?? 'nosniff')
    : false

  const frameOptions = options.frameOptions ?? false
  const csp = options.contentSecurityPolicy ?? false
  const referrerPolicy = options.referrerPolicy ?? false
  const permissionsPolicy = options.permissionsPolicy ?? false
  const coop = options.crossOriginOpenerPolicy ?? false
  const coep = options.crossOriginEmbedderPolicy ?? false
  const corp = options.crossOriginResourcePolicy ?? false

  // Build the HSTS value once at middleware creation time (it never changes per request).
  let hstsValue: string | false = false
  if (options.hsts !== undefined && options.hsts !== false) {
    hstsValue = buildHSTSValue(options.hsts)
  }

  return async(context: ODContext) => {
    const res = context.response
    if (contentTypeOptions !== false) res.setHeader('X-Content-Type-Options', contentTypeOptions)
    if (frameOptions !== false) res.setHeader('X-Frame-Options', frameOptions)
    if (hstsValue !== false) res.setHeader('Strict-Transport-Security', hstsValue)
    if (csp !== false) res.setHeader('Content-Security-Policy', csp)
    if (referrerPolicy !== false) res.setHeader('Referrer-Policy', referrerPolicy)
    if (permissionsPolicy !== false) res.setHeader('Permissions-Policy', permissionsPolicy)
    if (coop !== false) res.setHeader('Cross-Origin-Opener-Policy', coop)
    if (coep !== false) res.setHeader('Cross-Origin-Embedder-Policy', coep)
    if (corp !== false) res.setHeader('Cross-Origin-Resource-Policy', corp)
  }
}
