import { createHmac, createPublicKey, createSecretKey, createVerify, timingSafeEqual } from 'node:crypto'
import type { KeyObject } from 'node:crypto'

export type ODJWTAlgorithm =
  | 'HS256' | 'HS384' | 'HS512'
  | 'RS256' | 'RS384' | 'RS512'
  | 'ES256' | 'ES384' | 'ES512'

export interface ODJWTOptions {
  /** Secret for HMAC algorithms (HS256/384/512) */
  secret?: string | Buffer
  /** Public key PEM string or DER Buffer for asymmetric algorithms (RS256/384/512, ES256/384/512) */
  publicKey?: string | Buffer
  /** URL of a JWKS endpoint. Keys are fetched and cached automatically. Mutually exclusive with secret/publicKey. */
  jwksUri?: string
  /** How long to cache keys fetched from jwksUri, in seconds. Default: 600 */
  jwksCacheTtl?: number
  /** Timeout in milliseconds for each JWKS HTTP fetch. Default: 5000 */
  jwksFetchTimeout?: number
  /** Maximum allowed JWKS response body size in bytes. Default: 1_048_576 (1 MB) */
  jwksMaxBodySize?: number
  /** Allowed algorithms. Default: ['HS256'] for secret, ['RS256'] for publicKey/jwksUri */
  algorithms?: ODJWTAlgorithm[]
  /** Request header to read the token from. Default: 'authorization' */
  header?: string
  /** Token scheme prefix (e.g. 'Bearer'). Set to null to read the raw header value. Default: 'Bearer' */
  scheme?: string | null
  /** When true, missing or invalid tokens are silently skipped instead of returning 401. Default: false */
  optional?: boolean
  /** Key used to store the decoded payload in context.state. Default: 'user' */
  stateKey?: string
  /**
   * How many seconds past a token's `exp` claim it is still accepted. Default: 0.
   * Intended for emergency use only (e.g. identity server is temporarily unavailable
   * and tokens cannot be refreshed). Should not be enabled in normal operation.
   */
  expirationGap?: number
  /**
   * When true, CORS preflight requests bypass token verification entirely.
   * Applies only to OPTIONS requests that include both Origin and
   * Access-Control-Request-Method headers.
   * Default: true
   */
  ignoreCorsOptions?: boolean
  /**
   * Expected token issuer(s) (`iss` claim). When provided, the token's `iss` claim must
   * exactly match one of the supplied values, otherwise the token is rejected.
   * Strongly recommended in multi-service environments to prevent token cross-service misuse.
   */
  issuer?: string | string[]
  /**
   * Expected token audience(s) (`aud` claim). When provided, at least one value in the
   * token's `aud` claim must match one of the supplied values, otherwise the token is rejected.
   * Strongly recommended to prevent accepting tokens intended for a different service.
   */
  audience?: string | string[]
  /**
   * Expected `typ` header value(s). When provided, the token's `typ` header claim must
   * case-insensitively match one of the supplied values, otherwise the token is rejected.
   * Common values: `'JWT'` (standard), `'at+jwt'` (OAuth 2.0 access tokens).
   * Default: not validated.
   */
  typ?: string | string[]
  /**
   * Allowed critical header parameter names from the JWT `crit` header.
   * When a token includes `crit`, each listed name must also be present in the header
   * and must appear in this allowlist, otherwise the token is rejected.
   * When omitted, tokens that include `crit` are rejected.
   */
  crit?: string | string[]
  /**
   * Maximum clock skew in seconds tolerated between the token issuer and this server.
   * Applies to `nbf` (not-before) and `iat` (issued-at) claims:
   *  - `nbf > now + clockTolerance` -> rejected (not yet valid beyond tolerance)
   *  - `iat > now + clockTolerance` -> rejected (future-dated token beyond tolerance)
   * Does not affect `exp` validation (use `expirationGap` for that).
   * Default: 60
   */
  clockTolerance?: number
  /**
   * How many additional times to retry a failed JWKS fetch before giving up.
   * A value of 1 (the default) means one initial attempt plus one retry.
   * Set to 0 to disable retries.
   * Default: 1
   */
  jwksRetries?: number
  /**
   * When true, an unknown JWT `kid` forces one immediate JWKS refresh to discover
   * newly published keys. When false, unknown `kid` values are rejected until the
   * cache refreshes naturally.
   * Default: false
   */
  instantKeyResolution?: boolean
  /**
   * Optional async function for `jti` (JWT ID) claim validation.
   * When provided:
   *  - The token MUST contain a non-empty string `jti` claim, otherwise it is rejected.
   *  - The function is called with the verified payload and the current request context.
   *  - Returning `false` rejects the token with a 401 response.
   * Intended for replay prevention: implement this function to check `jti` against a
   * short-lived denylist or a one-time-use store (e.g. Redis SET with TTL = token lifetime).
   * When omitted, `jti` is not validated.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jtiValidator?: (payload: ODJWTPayload, context: any) => Promise<boolean>
}

export interface ODJWTPayload {
  [key: string]: unknown
  iat?: number
  exp?: number
  sub?: string
  iss?: string
  aud?: string | string[]
  nbf?: number
  jti?: string
}

export interface ODJWTHeader {
  alg: string
  typ?: string
  kid?: string
  crit?: string[]
}

export interface JWK {
  kty: string
  kid?: string
  use?: string
  alg?: string
  // RSA fields
  n?: string
  e?: string
  // EC fields
  crv?: string
  x?: string
  y?: string
  // Symmetric
  k?: string
  [key: string]: unknown
}

export interface JWKSCacheEntry {
  /** Keys indexed by kid for O(1) lookup */
  byKid: Map<string, KeyObject>
  /** All keys, for fallback when the JWT has no kid */
  all: KeyObject[]
  expiresAt: number
}

export type KeySource =
  | { type: 'secret'; value: string | Buffer }
  | { type: 'publicKey'; value: string | Buffer }
  | { type: 'jwks'; resolve: (kid: string | undefined, forceRefresh?: boolean) => Promise<KeyObject[]> }

export interface ClaimsOptions {
  issuer?: string[]
  audience?: string[]
  typ?: string[]
  crit?: string[]
}

const HMAC_ALGORITHMS: Partial<Record<ODJWTAlgorithm, string>> = {
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512',
}

const RSA_ALGORITHMS: Partial<Record<ODJWTAlgorithm, string>> = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512',
}

interface ECDSAAlgorithmConfig {
  nodeAlg: string
  namedCurve: string
  signatureLength: number
}

const EC_ALGORITHMS: Partial<Record<ODJWTAlgorithm, ECDSAAlgorithmConfig>> = {
  ES256: { nodeAlg: 'SHA256', namedCurve: 'prime256v1', signatureLength: 64 },
  ES384: { nodeAlg: 'SHA384', namedCurve: 'secp384r1', signatureLength: 96 },
  ES512: { nodeAlg: 'SHA512', namedCurve: 'secp521r1', signatureLength: 132 },
}

const BASE64URL_SEGMENT_PATTERN = /^[A-Za-z0-9_-]*$/

/**
 * Decodes a base64url-encoded string (such as a JWT segment) into a Buffer.
 *
 * @param str Encoded string value.
 * @returns The decoded buffer.
 */
function base64urlDecode(str: string): Buffer {
  if (!BASE64URL_SEGMENT_PATTERN.test(str)) {
    throw new Error('Invalid base64url encoding')
  }

  const decoded = Buffer.from(str, 'base64url')
  if (decoded.toString('base64url') !== str) {
    throw new Error('Invalid base64url encoding')
  }

  return decoded
}

/**
 * Parses JSON for use by this module.
 *
 * @param buf Buffer input.
 * @returns The computed result.
 */
function parseJSON<T>(buf: Buffer): T {
  return JSON.parse(buf.toString('utf8')) as T
}

function isJSONObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sanitizeErrorDetail(value: string): string {
  return value.replace(/[\r\n]+/g, ' ')
}

function parseHeader(value: unknown): Record<string, unknown> & ODJWTHeader {
  if (!isJSONObject(value)) {
    throw new Error('Invalid JWT header')
  }

  if (typeof value.alg !== 'string' || value.alg === '') {
    throw new Error('Invalid JWT header')
  }
  if (value.typ !== undefined && typeof value.typ !== 'string') {
    throw new Error('Invalid token type')
  }
  if (value.kid !== undefined && typeof value.kid !== 'string') {
    throw new Error('Invalid JWT header')
  }
  if (value.crit !== undefined) {
    if (!Array.isArray(value.crit) || value.crit.length === 0) {
      throw new Error('Invalid token crit header')
    }

    const seen = new Set<string>()
    for (const entry of value.crit) {
      if (typeof entry !== 'string' || entry === '' || entry === 'crit') {
        throw new Error('Invalid token crit header')
      }
      if (seen.has(entry) || !(entry in value)) {
        throw new Error('Invalid token crit header')
      }
      seen.add(entry)
    }
  }

  return value as Record<string, unknown> & ODJWTHeader
}

function parsePayload(value: unknown): ODJWTPayload {
  if (!isJSONObject(value)) {
    throw new Error('Invalid JWT payload')
  }

  if (value.iat !== undefined && !isFiniteNumber(value.iat)) {
    throw new Error('Token has invalid iat claim')
  }
  if (value.exp !== undefined && !isFiniteNumber(value.exp)) {
    throw new Error('Token has invalid exp claim')
  }
  if (value.nbf !== undefined && !isFiniteNumber(value.nbf)) {
    throw new Error('Token has invalid nbf claim')
  }
  if (value.sub !== undefined && typeof value.sub !== 'string') {
    throw new Error('Token has invalid sub claim')
  }
  if (value.iss !== undefined && typeof value.iss !== 'string') {
    throw new Error('Token has invalid iss claim')
  }
  if (value.jti !== undefined && typeof value.jti !== 'string') {
    throw new Error('Token has invalid jti claim')
  }
  if (
    value.aud !== undefined
    && typeof value.aud !== 'string'
    && (!Array.isArray(value.aud) || value.aud.some((entry) => typeof entry !== 'string'))
  ) {
    throw new Error('Token has invalid aud claim')
  }

  return value as ODJWTPayload
}

function validateCriticalHeaders(header: ODJWTHeader, allowedCrit: string[] | undefined): void {
  if (header.crit === undefined) return
  if (allowedCrit === undefined) {
    throw new Error('Invalid token crit header')
  }
  if (!header.crit.every(entry => allowedCrit.includes(entry))) {
    throw new Error('Invalid token crit header')
  }
}

/**
 * Verifies hmac for use by this module.
 *
 * @param nodeAlg Node.js crypto algorithm name.
 * @param secret Secret or key material used for verification.
 * @param signingInput JWT signing input (`header.payload`).
 * @param signature Signature bytes to verify.
 * @returns True when the check succeeds.
 */
function verifyHmac(nodeAlg: string, secret: string | Buffer | KeyObject, signingInput: string, signature: Buffer): boolean {
  try {
    const expected = createHmac(nodeAlg, secret).update(signingInput).digest()
    if (expected.length !== signature.length) return false
    return timingSafeEqual(expected, signature)
  } catch {
    return false
  }
}

/**
 * Encodes a DER/ASN.1 length field using the minimum number of bytes.
 * Values 0-127 use a single byte; 128-255 use two bytes (0x81, len); larger use three (0x82, hi, lo).
 *
 * @param len Length value to encode.
 * @returns DER-encoded length bytes.
 */
function derLen(len: number): Buffer {
  if (len < 128) return Buffer.from([len])
  if (len < 256) return Buffer.from([0x81, len])
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff])
}

/**
 * Converts an ECDSA signature from IEEE P1363 format (r||s) used in JWTs
 * to ASN.1 DER format expected by Node.js crypto.createVerify.
 * Uses proper multi-byte DER length encoding for correctness with ES512.
 *
 * @param signature Signature bytes to verify.
 * @returns The signature converted to DER format.
 */
function p1363ToDER(signature: Buffer): Buffer {
  if (signature.length === 0) return Buffer.alloc(0)
  const half = Math.floor(signature.length / 2)
  let r = signature.subarray(0, half)
  let s = signature.subarray(half)

  while (r.length > 1 && r[0] === 0) r = r.subarray(1)
  while (s.length > 1 && s[0] === 0) s = s.subarray(1)

  if (r[0] & 0x80) r = Buffer.concat([Buffer.from([0x00]), r])
  if (s[0] & 0x80) s = Buffer.concat([Buffer.from([0x00]), s])

  const rDer = Buffer.concat([Buffer.from([0x02]), derLen(r.length), r])
  const sDer = Buffer.concat([Buffer.from([0x02]), derLen(s.length), s])
  const body = Buffer.concat([rDer, sDer])
  return Buffer.concat([Buffer.from([0x30]), derLen(body.length), body])
}

/**
 * Detects whether a buffer appears to contain PEM text.
 *
 * @param key Buffer input.
 * @returns True when the buffer starts with a PEM header.
 */
function isPEMBuffer(key: Buffer): boolean {
  const prefix = key.subarray(0, Math.min(key.length, 32)).toString('ascii').trimStart()
  return prefix.startsWith('-----BEGIN ')
}

/**
 * Normalizes a key input into a public KeyObject for asymmetric verification.
 * Buffers are accepted as either PEM text or DER-encoded SPKI data.
 *
 * @param key Key input from middleware options or JWKS.
 * @returns A public key object ready for verification.
 */
function toPublicKeyObject(key: string | Buffer | KeyObject): KeyObject {
  if (typeof key === 'string') return createPublicKey(key)
  if (Buffer.isBuffer(key)) {
    return isPEMBuffer(key)
      ? createPublicKey(key)
      : createPublicKey({ key, format: 'der', type: 'spki' })
  }
  return key
}

/**
 * Verifies asymmetric for use by this module.
 *
 * @param alg JWT algorithm.
 * @param key Lookup key.
 * @param signingInput JWT signing input (`header.payload`).
 * @param signature Signature bytes to verify.
 * @returns True when the check succeeds.
 */
function verifyAsymmetric(alg: ODJWTAlgorithm, key: string | Buffer | KeyObject, signingInput: string, signature: Buffer): boolean {
  const rsaAlg = RSA_ALGORITHMS[alg]
  const ecAlg = EC_ALGORITHMS[alg]
  const nodeAlg = rsaAlg ?? ecAlg?.nodeAlg
  if (!nodeAlg) return false

  try {
    const publicKey = toPublicKeyObject(key)
    if (ecAlg) {
      if (publicKey.asymmetricKeyType !== 'ec') return false
      if (publicKey.asymmetricKeyDetails?.namedCurve !== ecAlg.namedCurve) return false
      if (signature.length !== ecAlg.signatureLength) return false
    }

    const verify = createVerify(nodeAlg)
    verify.update(signingInput)

    // EC signatures in JWTs are IEEE P1363; Node.js createVerify expects ASN.1 DER
    const sig = ecAlg ? p1363ToDER(signature) : signature
    return verify.verify(publicKey, sig)
  } catch {
    return false
  }
}

/**
 * Verifies with Key for use by this module.
 *
 * @param alg JWT algorithm.
 * @param key Lookup key.
 * @param signingInput JWT signing input (`header.payload`).
 * @param signature Signature bytes to verify.
 * @returns True when the check succeeds.
 */
function verifyWithKey(alg: ODJWTAlgorithm, key: string | Buffer | KeyObject, signingInput: string, signature: Buffer): boolean {
  const hmacAlg = HMAC_ALGORITHMS[alg]
  return hmacAlg
    ? verifyHmac(hmacAlg, key, signingInput, signature)
    : verifyAsymmetric(alg, key, signingInput, signature)
}

/**
 * Converts a JWK entry into a Node.js KeyObject used for JWT signature verification.
 *
 * @param jwk JWK entry to convert.
 * @returns The converted Node.js KeyObject.
 */
function jwkToKeyObject(jwk: JWK): KeyObject {
  if (jwk.kty === 'oct') {
    // Symmetric key: decode the raw bytes from the base64url-encoded "k" field
    if (typeof jwk.k !== 'string') throw new Error('Invalid symmetric JWK: missing "k" field')
    return createSecretKey(base64urlDecode(jwk.k))
  }
  // RSA / EC public key - Node.js createPublicKey supports JWK format natively
  return createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' })
}

/**
 * Fetches JWKS for use by this module.
 *
 * @param uri Remote endpoint URL.
 * @param timeoutMs Timeout in milliseconds.
 * @param maxBodySize Maximum allowed request body size in bytes, or null to disable the limit.
 * @returns A promise that resolves to the operation result.
 */
async function fetchJWKS(uri: string, timeoutMs: number, maxBodySize: number): Promise<JWK[]> {
  const response = await fetch(uri, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS from ${uri}: HTTP ${response.status}`)
  }

  const responseHeaders = (response as { headers?: { get?: (name: string) => string | null } }).headers
  const contentLength = typeof responseHeaders?.get === 'function'
    ? responseHeaders.get('content-length')
    : null
  if (contentLength !== null) {
    const declaredLength = Number(contentLength)
    if (Number.isFinite(declaredLength) && declaredLength > maxBodySize) {
      throw new Error(`JWKS response from ${uri} exceeds maximum allowed size (${maxBodySize} bytes)`)
    }
  }

  let text: string
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let bodyBytes = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const chunk = Buffer.from(value)
      bodyBytes += chunk.byteLength
      if (bodyBytes > maxBodySize) {
        void reader.cancel().catch(() => undefined)
        throw new Error(`JWKS response from ${uri} exceeds maximum allowed size (${maxBodySize} bytes)`)
      }
      chunks.push(chunk)
    }
    text = Buffer.concat(chunks).toString('utf8')
  } else {
    text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBodySize) {
      throw new Error(`JWKS response from ${uri} exceeds maximum allowed size (${maxBodySize} bytes)`)
    }
  }
  const body = JSON.parse(text) as { keys?: unknown }
  if (!Array.isArray(body.keys)) {
    throw new Error(`Invalid JWKS response from ${uri}: missing "keys" array`)
  }
  return body.keys as JWK[]
}

/**
 * Builds a JWKS key resolver with in-process caching.
 * Concurrent refresh requests are coalesced into a single fetch to avoid thundering-herd
 * against the identity provider. When `instantKeyResolution` is enabled and a kid is
 * not found in the cache, the cache is refreshed once immediately to handle key rotation.
 * Otherwise, unknown kids are rejected until the cache naturally refreshes.
 * Failed fetches are retried up to `retries` additional times before giving up.
 *
 * @param uri Remote endpoint URL.
 * @param cacheTtl JWKS cache TTL in seconds.
 * @param fetchTimeout JWKS fetch timeout in milliseconds.
 * @param maxBodySize Maximum allowed request body size in bytes, or null to disable the limit.
 * @param retries Number of retry attempts.
 * @param instantKeyResolution When true, unknown kids trigger one immediate refresh.
 * @returns The computed result.
 */
export function buildJWKSResolver(
  uri: string,
  cacheTtl: number,
  fetchTimeout: number,
  maxBodySize: number,
  retries: number,
  instantKeyResolution = false,
): (kid: string | undefined, forceRefresh?: boolean) => Promise<KeyObject[]> {
  let cache: JWKSCacheEntry | null = null
  let inFlightRefresh: Promise<JWKSCacheEntry> | null = null
  let parsedJwksUri: URL
  try {
    parsedJwksUri = new URL(uri)
  } catch {
    throw new Error(`JWKS endpoint is not a valid URL: "${uri}"`)
  }
  if (parsedJwksUri.protocol !== 'https:') {
    throw new Error('Incorrect schema for JWKS endpoint ("https://" is required)')
  }

  /**
   * Performs the asynchronous attempt Fetch operation for this module.
   *
   * @param remaining Remaining retry attempts.
   * @returns A promise that resolves to the operation result.
   */
  async function attemptFetch(remaining: number): Promise<JWKSCacheEntry> {
    try {
      const jwks = await fetchJWKS(uri, fetchTimeout, maxBodySize)
      const byKid = new Map<string, KeyObject>()
      const all: KeyObject[] = []
      for (const jwk of jwks) {
        if (jwk.use && jwk.use !== 'sig') continue // skip non-signature keys (e.g. enc)
        try {
          const key = jwkToKeyObject(jwk)
          all.push(key)
          if (jwk.kid) byKid.set(jwk.kid, key)
        } catch {
          // Skip keys that cannot be imported (e.g. unsupported curve or key type)
        }
      }
      if (all.length === 0) throw new Error(`JWKS at ${uri} contains no usable keys`)
      const entry: JWKSCacheEntry = { byKid, all, expiresAt: Date.now() + cacheTtl * 1000 }
      cache = entry
      return entry
    } catch (e) {
      if (remaining > 0) return attemptFetch(remaining - 1)
      throw e
    }
  }

  /**
   * Performs the asynchronous do Fetch operation for this module.
   *
   * @returns A promise that resolves to the operation result.
   */
  function doFetch(): Promise<JWKSCacheEntry> {
    const promise = attemptFetch(retries).finally(() => {
      inFlightRefresh = null
    })
    return promise
  }

  /**
   * Returns cache.
   *
   * @param forceRefresh When true, bypasses cached keys and fetches fresh JWKS data.
   * @returns A promise that resolves to the operation result.
   */
  async function getCache(forceRefresh = false): Promise<JWKSCacheEntry> {
    const now = Date.now()
    if (!forceRefresh && cache && cache.expiresAt > now) return cache

    // Coalesce concurrent refreshes: reuse an already in-flight fetch instead of
    // issuing a second request to the identity provider.
    if (!inFlightRefresh) {
      inFlightRefresh = doFetch()
    }
    return inFlightRefresh
  }

  return async(kid: string | undefined, forceRefresh = false): Promise<KeyObject[]> => {
    const entry = await getCache(forceRefresh)

    if (kid) {
      let key = entry.byKid.get(kid)
      if (!key && !forceRefresh && instantKeyResolution) {
        // Optional compatibility mode: re-fetch once to pick up a newly published key immediately.
        const fresh = await getCache(true)
        key = fresh.byKid.get(kid)
      }
      if (!key) throw new Error(`No key found in JWKS for kid "${sanitizeErrorDetail(kid)}"`)
      return [key]
    }

    // No kid in JWT - try all cached keys
    return entry.all
  }
}

/**
 * Decodes and Verify for use by this module.
 *
 * @param token JWT string to decode and verify.
 * @param algorithms Allowed JWT algorithms.
 * @param keySource JWT signing key source configuration.
 * @param expirationGap Allowed expiration grace period in seconds.
 * @param clockTolerance Allowed clock skew in seconds.
 * @param claims JWT claim validation options.
 * @returns A promise that resolves to the verified payload.
 */
export async function decodeAndVerify(
  token: string,
  algorithms: ODJWTAlgorithm[],
  keySource: KeySource,
  expirationGap: number,
  clockTolerance: number,
  claims: ClaimsOptions,
): Promise<ODJWTPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT format')

  const [headerB64, payloadB64, signatureB64] = parts

  let rawHeader: unknown
  let rawPayload: unknown
  let signature: Buffer
  try {
    rawHeader = parseJSON<unknown>(base64urlDecode(headerB64))
    rawPayload = parseJSON<unknown>(base64urlDecode(payloadB64))
    signature = base64urlDecode(signatureB64)
  } catch {
    throw new Error('Invalid JWT encoding')
  }

  const header = parseHeader(rawHeader)
  const payload = parsePayload(rawPayload)

  const rawAlg = header.alg
  if (!algorithms.includes(rawAlg as ODJWTAlgorithm)) {
    throw new Error(`Algorithm "${sanitizeErrorDetail(rawAlg)}" is not allowed`)
  }
  const alg = rawAlg as ODJWTAlgorithm
  validateCriticalHeaders(header, claims.crit)

  const signingInput = `${headerB64}.${payloadB64}`

  let valid = false

  if (keySource.type === 'jwks') {
    const keys = await keySource.resolve(header.kid)
    for (const key of keys) {
      if (verifyWithKey(alg, key, signingInput, signature)) {
        valid = true
        break
      }
    }
  } else if (keySource.type === 'secret') {
    if (!HMAC_ALGORITHMS[alg]) throw new Error('options.secret is only valid for HMAC algorithms (HS256/384/512)')
    valid = verifyWithKey(alg, keySource.value, signingInput, signature)
  } else {
    if (HMAC_ALGORITHMS[alg]) throw new Error('options.publicKey is not valid for HMAC algorithms - use options.secret')
    valid = verifyWithKey(alg, keySource.value, signingInput, signature)
  }

  if (!valid) throw new Error('Invalid JWT signature')

  // Validate typ header claim before checking time-based claims
  if (claims.typ !== undefined) {
    const tokenTyp = (header.typ ?? '').toLowerCase()
    if (!claims.typ.some(t => t.toLowerCase() === tokenTyp)) {
      throw new Error(`Invalid token type "${sanitizeErrorDetail(header.typ ?? '')}"`)
    }
  }

  const now = Math.floor(Date.now() / 1000)
  if (payload.exp !== undefined) {
    if (payload.exp <= now - expirationGap) throw new Error('Token expired')
  }
  if (payload.nbf !== undefined) {
    if (payload.nbf > now + clockTolerance) throw new Error('Token not yet valid')
  }
  if (payload.iat !== undefined) {
    if (payload.iat > now + clockTolerance) throw new Error('Token has a future issued-at (iat) claim')
  }

  if (claims.issuer !== undefined) {
    if (typeof payload.iss !== 'string' || !claims.issuer.includes(payload.iss)) {
      throw new Error('Invalid token issuer')
    }
  }

  if (claims.audience !== undefined) {
    const tokenAud = Array.isArray(payload.aud)
      ? payload.aud
      : (typeof payload.aud === 'string' ? [payload.aud] : [])
    if (!tokenAud.some((a) => claims.audience!.includes(a))) {
      throw new Error('Invalid token audience')
    }
  }

  return payload
}
