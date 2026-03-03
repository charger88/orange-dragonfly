import ODContext from '../core/context'
import { ODMiddlewareFunction } from '../core/middleware'
import ODResponse from '../core/response'

/**
 * Appends vary for use by this module.
 *
 * @param res Framework response object.
 * @param values Header values to merge into the existing Vary header.
 */
function appendVary(res: ODResponse, values: string[]): void {
  // Collect all existing Vary values across potentially multiple headers,
  // then merge them into a single deduplicated header.
  const existing = res.headers
    .filter(h => h.name.toLowerCase() === 'vary')
    .flatMap(h => h.value.split(',').map(v => v.trim()).filter(Boolean))
  // Build the merged list while preserving original casing of the first occurrence.
  const current: string[] = []
  for (const v of existing) {
    if (!current.some(e => e.toLowerCase() === v.toLowerCase())) current.push(v)
  }
  for (const v of values) {
    if (!current.some(e => e.toLowerCase() === v.toLowerCase())) current.push(v)
  }
  res.setHeader('Vary', current.join(', '))
}

export interface ODCORSOptions {
  origins?: string[]
  allowHeaders?: string[]
  exposeHeaders?: string[]
  credentials?: boolean
  maxAge?: number
  rejectUnallowed?: boolean
}

/**
 * Compiles an origin pattern into a RegExp.
 * Supported wildcards:
 * - `*`  matches a single subdomain label (no dots), e.g. `https://*.example.com`
 * matches `https://api.example.com` but NOT `https://a.b.example.com`
 * - `**` matches one or more labels at any depth, e.g. `https://**.example.com`
 * matches both `https://api.example.com` AND `https://a.b.example.com`
 * Multiple single wildcards can be combined: `https://*.*.example.com` matches
 * exactly two subdomain levels.
 *
 * @param pattern Origin pattern string.
 * @returns Regular expression that matches the configured origin pattern.
 */
function compileOriginPattern(pattern: string): RegExp {
  // Escape all regex-special characters except * which we handle specially.
  // Process ** before * so the double-star placeholder is not overwritten by
  // the single-star replacement.
  let regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  regexStr = regexStr.replace(/\*\*/g, '\x00') // temporary placeholder
  regexStr = regexStr.replace(/\*/g, '[^.]+')   // single label: no dots
  // eslint-disable-next-line no-control-regex
  regexStr = regexStr.replace(/\x00/g, '[^/]+') // any depth: dots ok, no slash
  return new RegExp(`^${regexStr}$`)
}

type CompiledPattern =
  | { kind: 'wildcard' }
  | { kind: 'literal'; value: string }
  | { kind: 'regex'; re: RegExp }

/**
 * Builds compiled origin matchers for the configured origin allow-list.
 *
 * @param origins Configured allowed origins.
 * @returns The computed result.
 */
function buildCompiledPatterns(origins: string[]): CompiledPattern[] {
  return origins.map((o): CompiledPattern => {
    if (o === '*') return { kind: 'wildcard' }
    if (o.includes('*')) return { kind: 'regex', re: compileOriginPattern(o) }
    return { kind: 'literal', value: o }
  })
}

/**
 * Checks whether a request origin matches any configured allow rule.
 *
 * @param origin Request origin header value.
 * @param compiled Compiled origin matchers.
 * @returns True when the check succeeds.
 */
function isOriginAllowed(origin: string, compiled: CompiledPattern[]): boolean {
  for (const p of compiled) {
    if (p.kind === 'wildcard') return true
    if (p.kind === 'literal' && p.value === origin) return true
    if (p.kind === 'regex' && p.re.test(origin)) return true
  }
  return false
}

/**
 * Creates CORS middleware that validates origins and sets preflight/response headers from the provided policy.
 *
 * @param options Optional configuration values.
 * @returns A configured middleware function.
 */
export default function ODCORSMiddleware(options: ODCORSOptions = {}): ODMiddlewareFunction {
  const origins = options.origins ?? ['*']
  const allowHeaders = options.allowHeaders ?? []
  const exposeHeaders = options.exposeHeaders ?? []
  const credentials = options.credentials ?? false
  const maxAge = options.maxAge
  const rejectUnallowed = options.rejectUnallowed ?? false

  if (credentials && origins.includes('*')) {
    throw new Error(
      'ODCORSMiddleware: credentials:true cannot be combined with origins:[\'*\']. ' +
      'Allowing credentials with a wildcard origin effectively grants every website ' +
      'access to authenticated resources. Specify explicit allowed origins instead.',
    )
  }

  // Pre-compile patterns once at middleware creation time (not per request)
  const compiledPatterns = buildCompiledPatterns(origins)
  const isWildcard = origins.includes('*')

  return async(context: ODContext) => {
    const requestOrigin = context.request.getHeader('origin')
    const res = context.response
    const vary: string[] = []

    if (!requestOrigin) {
      return
    }

    const allowed = isOriginAllowed(requestOrigin, compiledPatterns)
    if (!allowed) {
      vary.push('Origin')
      appendVary(res, vary)
      if (rejectUnallowed) {
        return res.setError(403, 'Origin not allowed')
      }
      return
    }

    // Set Access-Control-Allow-Origin
    if (isWildcard && !credentials) {
      res.setHeader('Access-Control-Allow-Origin', '*')
    } else {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin)
      vary.push('Origin')
    }

    // Credentials
    if (credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    // Exposed headers (for non-preflight responses)
    if (exposeHeaders.length) {
      res.setHeader('Access-Control-Expose-Headers', exposeHeaders.join(', '))
    }

    // Preflight request: set CORS-specific headers, let the controller handle the response
    if (context.request.method === 'OPTIONS') {
      const requestedHeaders = context.request.getHeader('access-control-request-headers')
      if (allowHeaders.length) {
        res.setHeader('Access-Control-Allow-Headers', allowHeaders.join(', '))
      } else if (requestedHeaders) {
        res.setHeader('Access-Control-Allow-Headers', requestedHeaders)
        vary.push('Access-Control-Request-Headers')
      }

      if (maxAge !== undefined) {
        res.setHeader('Access-Control-Max-Age', String(maxAge))
      }
    }

    if (vary.length) {
      appendVary(res, vary)
    }
  }
}
