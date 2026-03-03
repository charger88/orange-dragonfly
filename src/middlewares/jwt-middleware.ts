import ODContext from '../core/context'
import ODController from '../core/controller'
import { ODMiddlewareFunction } from '../core/middleware'
import { sanitizeInput } from '../utils/sanitize-input'
import { buildJWKSResolver, decodeAndVerify } from '../utils/jwt'
import type { ODJWTAlgorithm, ODJWTOptions, ODJWTPayload, KeySource, ClaimsOptions } from '../utils/jwt'

export type { ODJWTAlgorithm, ODJWTOptions, ODJWTPayload } from '../utils/jwt'

/**
 * Middleware that decodes and verifies a JWT from the request.
 * On success, stores the decoded payload in `context.state` under `stateKey` (default: 'user').
 * On failure, returns a 401 response (unless `optional` is true).
 * Key source - exactly one of the following must be provided:
 * - `secret`    - shared secret for HMAC algorithms (HS256/384/512)
 * - `publicKey` - PEM/DER public key for RSA or EC algorithms
 * - `jwksUri`   - URL of a JWKS endpoint; supports multiple keys and automatic key rotation
 *
 * @param options Optional configuration values.
 * @returns A configured middleware function.
 */
export default function ODJWTMiddleware(options: ODJWTOptions): ODMiddlewareFunction {
  const hasSecret = options.secret !== undefined
  if (hasSecret) {
    const secret = options.secret
    const secretLength = typeof secret === 'string'
      ? secret.length
      : (Buffer.isBuffer(secret) ? secret.length : 0)
    if (secretLength === 0) {
      throw new Error('ODJWTMiddleware: options.secret must not be empty')
    }
  }

  const sourceCount = [hasSecret, Boolean(options.publicKey), Boolean(options.jwksUri)].filter(Boolean).length
  if (sourceCount === 0) {
    throw new Error('ODJWTMiddleware requires one of: options.secret, options.publicKey, or options.jwksUri')
  }
  if (sourceCount > 1) {
    throw new Error('ODJWTMiddleware: options.secret, options.publicKey, and options.jwksUri are mutually exclusive')
  }

  const algorithms: ODJWTAlgorithm[] = options.algorithms ?? (options.jwksUri || options.publicKey ? ['RS256'] : ['HS256'])
  if (algorithms.length === 0) {
    throw new Error('ODJWTMiddleware: options.algorithms must not be empty')
  }
  const headerName = options.header ?? 'authorization'
  const scheme = options.scheme !== undefined ? options.scheme : 'Bearer'
  const optional = options.optional ?? false
  const stateKey = options.stateKey ?? 'user'
  const expirationGap = options.expirationGap ?? 0
  const clockTolerance = options.clockTolerance ?? 60
  const ignoreCorsOptions = options.ignoreCorsOptions ?? true
  const jtiValidator = options.jtiValidator

  const claims: ClaimsOptions = {
    issuer: options.issuer !== undefined
      ? (Array.isArray(options.issuer) ? options.issuer : [options.issuer])
      : undefined,
    audience: options.audience !== undefined
      ? (Array.isArray(options.audience) ? options.audience : [options.audience])
      : undefined,
    typ: options.typ !== undefined
      ? (Array.isArray(options.typ) ? options.typ : [options.typ])
      : undefined,
    crit: options.crit !== undefined
      ? (Array.isArray(options.crit) ? options.crit : [options.crit])
      : undefined,
  }

  let keySource: KeySource
  if (options.jwksUri) {
    const cacheTtl = options.jwksCacheTtl ?? 600
    const fetchTimeout = options.jwksFetchTimeout ?? 5000
    const maxBodySize = options.jwksMaxBodySize ?? 1_048_576
    const jwksRetries = options.jwksRetries ?? 1
    const instantKeyResolution = options.instantKeyResolution ?? false
    keySource = { type: 'jwks', resolve: buildJWKSResolver(options.jwksUri, cacheTtl, fetchTimeout, maxBodySize, jwksRetries, instantKeyResolution) }
  } else if (hasSecret) {
    keySource = { type: 'secret', value: options.secret! }
  } else {
    keySource = { type: 'publicKey', value: options.publicKey! }
  }

  return async(context: ODContext) => {
    const isCorsPreflight = context.request.method === 'OPTIONS'
      && context.request.getHeader('origin') !== undefined
      && context.request.getHeader('access-control-request-method') !== undefined
    if (ignoreCorsOptions && isCorsPreflight) return

    const rawHeader = context.request.getHeader(headerName)

    if (!rawHeader) {
      if (optional) return
      return context.response.setError(401, 'Authorization header missing')
    }

    let token: string
    if (scheme) {
      const prefix = scheme + ' '
      if (!rawHeader.toLowerCase().startsWith(prefix.toLowerCase())) {
        if (optional) return
        return context.response.setError(401, 'Invalid authorization scheme')
      }
      token = rawHeader.slice(prefix.length).trim()
    } else {
      token = rawHeader.trim()
    }

    try {
      const payload = await decodeAndVerify(token, algorithms, keySource, expirationGap, clockTolerance, claims)
      if (jtiValidator !== undefined) {
        if (typeof payload.jti !== 'string' || payload.jti === '') {
          throw new Error('Token missing required jti claim')
        }
        const jtiValid = await jtiValidator(payload, context)
        if (!jtiValid) {
          throw new Error('Token jti rejected')
        }
      }
      context.state.set(stateKey, sanitizeInput(payload))
    } catch (e) {
      if (optional) return
      context.app.logger.warn('Invalid JWT token', e instanceof Error ? e.message : '')
      return context.response.setError(401, 'Unauthorized')
    }
  }
}

/**
 * Class decorator factory that adds a typed `user` getter to an ODController subclass.
 * The getter reads the decoded JWT payload from `context.state`.
 *
 * TypeScript augments the external type of the decorated class automatically.
 * To enable `this.user` type-checking *inside* the class body, add a `declare` field:
 *
 * @param stateKey - Key used to store the payload (must match ODJWTMiddleware's stateKey). Default: 'user'
 *
 * @example
 * interface MyUser { id: string; email: string }
 *
 * @ODWithUser<MyUser>()
 * class UsersController extends ODController {
 *   declare user: MyUser | undefined   // enables this.user typing inside the class
 *
 *   async doGet() {
 *     return { email: this.user?.email }
 *   }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AbstractControllerCtor<T extends ODController = ODController> = abstract new (...args: any[]) => T

/**
 * Creates a controller decorator that exposes a typed user property backed by controller state.
 *
 * @param stateKey State property name used to expose the decoded user payload.
 */
export function ODWithUser<TUser = ODJWTPayload>(stateKey = 'user') {
  return function<T extends AbstractControllerCtor>(
    target: T,
  ): T & AbstractControllerCtor<ODController & { readonly user: TUser | undefined }> {
    Object.defineProperty(target.prototype, 'user', {
      /**
       * Returns the value exposed by this property descriptor.
       *
       * @returns The computed result.
       */
      get(this: ODController): TUser | undefined {
        return this.context.state.get(stateKey) as TUser | undefined
      },
      enumerable: false,
      configurable: true,
    })
    return target as T & AbstractControllerCtor<ODController & { readonly user: TUser | undefined }>
  }
}
