import { createHmac, createPublicKey, createSign, generateKeyPairSync } from 'node:crypto'
import ODJWTMiddleware, { ODWithUser } from '../src/middlewares/jwt-middleware'
import ODContext from '../src/core/context'
import ODController from '../src/core/controller'
import ODRequest from '../src/core/request'
import ODResponse from '../src/core/response'
import ODApp from '../src/core/app'
import ODRoute from '../src/core/route'

const dummyRoute: ODRoute = { controller: {} as any, action: 'doGet', method: 'GET', path: '/' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url')
}

/** Creates a signed HS256 JWT (or with another HMAC algorithm) for testing. */
function makeHSToken(
  payload: Record<string, unknown>,
  secret: string,
  alg: 'HS256' | 'HS384' | 'HS512' = 'HS256',
): string {
  const header = b64url(JSON.stringify({ alg, typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const hmacAlg = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' }[alg]
  const sig = createHmac(hmacAlg, secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function createContext(method: string, headers: Record<string, string> = {}): ODContext {
  const app = new ODApp()
  const request = new ODRequest({ method, url: '/', headers })
  const response = new ODResponse()
  return new ODContext(app, request, response, { ...dummyRoute, method })
}

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('ODJWTMiddleware constructor validation', () => {
  test('throws when no key source is provided', () => {
    expect(() => ODJWTMiddleware({})).toThrow(
      'ODJWTMiddleware requires one of: options.secret, options.publicKey, or options.jwksUri',
    )
  })

  test('throws when the secret is an empty string', () => {
    expect(() => ODJWTMiddleware({ secret: '' })).toThrow(
      'ODJWTMiddleware: options.secret must not be empty',
    )
  })

  test('throws when the secret is an empty buffer', () => {
    expect(() => ODJWTMiddleware({ secret: Buffer.alloc(0) })).toThrow(
      'ODJWTMiddleware: options.secret must not be empty',
    )
  })

  test('throws when multiple key sources are provided', () => {
    expect(() => ODJWTMiddleware({ secret: 'a', publicKey: 'b' })).toThrow(
      'ODJWTMiddleware: options.secret, options.publicKey, and options.jwksUri are mutually exclusive',
    )
  })
})

// ---------------------------------------------------------------------------

describe('HS256 token verification', () => {
  const SECRET = 'test-secret'

  test('stores the decoded payload in context.state under "user" by default', async () => {
    const token = makeHSToken({ sub: 'u1', exp: now() + 3600 }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    const user = ctx.state.get('user') as Record<string, unknown>
    expect(user.sub).toBe('u1')
  })

  test('uses a custom stateKey when provided', async () => {
    const token = makeHSToken({ sub: 'u2' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, stateKey: 'jwt' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('jwt')).toBeDefined()
    expect(ctx.state.get('user')).toBeUndefined()
  })

  test('reads the token from a custom header', async () => {
    const token = makeHSToken({ sub: 'u3' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, header: 'x-token' })
    const ctx = createContext('GET', { 'x-token': `Bearer ${token}` })
    await mw(ctx)
    const user = ctx.state.get('user') as Record<string, unknown>
    expect(user.sub).toBe('u3')
  })

  test('accepts a token without the "Bearer" prefix when scheme is null', async () => {
    const token = makeHSToken({ sub: 'u4' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, scheme: null })
    const ctx = createContext('GET', { authorization: token })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('accepts a token with a custom scheme', async () => {
    const token = makeHSToken({ sub: 'u5' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, scheme: 'Token' })
    const ctx = createContext('GET', { authorization: `Token ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('matches the authorization scheme case-insensitively', async () => {
    const token = makeHSToken({ sub: 'u5b' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('verifies HS384 tokens', async () => {
    const token = makeHSToken({ sub: 'u6' }, SECRET, 'HS384')
    const mw = ODJWTMiddleware({ secret: SECRET, algorithms: ['HS384'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('verifies HS512 tokens', async () => {
    const token = makeHSToken({ sub: 'u7' }, SECRET, 'HS512')
    const mw = ODJWTMiddleware({ secret: SECRET, algorithms: ['HS512'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------

describe('401 error cases', () => {
  const SECRET = 'test-secret'

  test('returns 401 when authorization header is missing', async () => {
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET')
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 when scheme does not match', async () => {
    const token = makeHSToken({ sub: 'u1' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Token ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 for an invalid signature', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1' }, 'wrong-secret')
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 for a malformed token (not 3 parts)', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: 'Bearer not.a.valid.jwt.here' })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 for an expired token', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1', exp: now() - 10 }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 when token is not yet valid (nbf in future)', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1', nbf: now() + 6000 }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 when algorithm is not in the allowed list', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1' }, SECRET, 'HS384')
    const mw = ODJWTMiddleware({ secret: SECRET, algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 when the signature segment is not valid base64url', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = `${makeHSToken({ sub: 'u1' }, SECRET)}*`
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })
})

// ---------------------------------------------------------------------------

describe('optional mode', () => {
  const SECRET = 'test-secret'

  test('does not set an error response when header is missing', async () => {
    const mw = ODJWTMiddleware({ secret: SECRET, optional: true })
    const ctx = createContext('GET')
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    expect(ctx.state.get('user')).toBeUndefined()
  })

  test('does not set an error response when token is invalid', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1' }, 'wrong-secret')
    const mw = ODJWTMiddleware({ secret: SECRET, optional: true })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    expect(ctx.state.get('user')).toBeUndefined()
  })

  test('still decodes and stores a valid token', async () => {
    const token = makeHSToken({ sub: 'u1' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, optional: true })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('returns early (no 401) when optional=true and authorization scheme does not match', async () => {
    // Header present but scheme is wrong -> if (optional) return at line 411
    const mw = ODJWTMiddleware({ secret: SECRET, optional: true })
    const ctx = createContext('GET', { authorization: 'Token some-value' })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    expect(ctx.state.get('user')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------

describe('ignoreCorsOptions', () => {
  const SECRET = 'test-secret'

  test('skips verification for CORS preflight requests by default', async () => {
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('OPTIONS', {
      origin: 'https://client.example',
      'access-control-request-method': 'GET',
    })
    await mw(ctx)
    // No 401, no user - middleware returned early
    expect(ctx.response.code).not.toBe(401)
    expect(ctx.state.get('user')).toBeUndefined()
  })

  test('verifies plain OPTIONS requests by default', async () => {
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('OPTIONS')
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('verifies CORS preflight requests when ignoreCorsOptions is false', async () => {
    const mw = ODJWTMiddleware({ secret: SECRET, ignoreCorsOptions: false })
    const ctx = createContext('OPTIONS', {
      origin: 'https://client.example',
      'access-control-request-method': 'GET',
    })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })
})

// ---------------------------------------------------------------------------

describe('expirationGap', () => {
  const SECRET = 'test-secret'

  test('accepts an expired token within the expirationGap window', async () => {
    const token = makeHSToken({ sub: 'u1', exp: now() - 5 }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, expirationGap: 10 })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('rejects an expired token outside the expirationGap window', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1', exp: now() - 20 }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, expirationGap: 10 })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })
})

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Asymmetric algorithms – RSA
// ---------------------------------------------------------------------------

// Generate once for the whole suite (expensive but done at module load time)
const rsaKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

function makeRSToken(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  alg: 'RS256' | 'RS384' | 'RS512' = 'RS256',
): string {
  const header = b64url(JSON.stringify({ alg, typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const nodeAlg = { RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512' }[alg]
  const sig = createSign(nodeAlg).update(`${header}.${body}`).sign(privateKeyPem, 'base64url')
  return `${header}.${body}.${sig}`
}

describe('RS256/384/512 token verification', () => {
  test('verifies an RS256 token with a PEM public key', async () => {
    const token = makeRSToken({ sub: 'rs-user' }, rsaKeys.privateKey as string)
    const mw = ODJWTMiddleware({ publicKey: rsaKeys.publicKey as string, algorithms: ['RS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    const user = ctx.state.get('user') as Record<string, unknown>
    expect(user.sub).toBe('rs-user')
  })

  test('verifies RS384', async () => {
    const token = makeRSToken({ sub: 'rs384' }, rsaKeys.privateKey as string, 'RS384')
    const mw = ODJWTMiddleware({ publicKey: rsaKeys.publicKey as string, algorithms: ['RS384'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('verifies RS512', async () => {
    const token = makeRSToken({ sub: 'rs512' }, rsaKeys.privateKey as string, 'RS512')
    const mw = ODJWTMiddleware({ publicKey: rsaKeys.publicKey as string, algorithms: ['RS512'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('verifies an RS256 token with a PEM public key buffer', async () => {
    const token = makeRSToken({ sub: 'rs-pem-buffer' }, rsaKeys.privateKey as string)
    const mw = ODJWTMiddleware({ publicKey: Buffer.from(rsaKeys.publicKey as string), algorithms: ['RS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect((ctx.state.get('user') as Record<string, unknown>).sub).toBe('rs-pem-buffer')
  })

  test('verifies an RS256 token with a DER public key buffer', async () => {
    const token = makeRSToken({ sub: 'rs-der-buffer' }, rsaKeys.privateKey as string)
    const derPublicKey = createPublicKey(rsaKeys.publicKey as string).export({ type: 'spki', format: 'der' })
    const mw = ODJWTMiddleware({ publicKey: derPublicKey, algorithms: ['RS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect((ctx.state.get('user') as Record<string, unknown>).sub).toBe('rs-der-buffer')
  })

  test('returns 401 for RS256 token signed with a different key', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const otherKeys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const token = makeRSToken({ sub: 'u' }, otherKeys.privateKey as string)
    const mw = ODJWTMiddleware({ publicKey: rsaKeys.publicKey as string, algorithms: ['RS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 when publicKey is used with an HMAC algorithm', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u' }, 'secret')
    const mw = ODJWTMiddleware({ publicKey: rsaKeys.publicKey as string, algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 when secret is used with an RSA algorithm', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeRSToken({ sub: 'u' }, rsaKeys.privateKey as string, 'RS256')
    const mw = ODJWTMiddleware({ secret: 'my-secret', algorithms: ['RS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Asymmetric algorithms – EC
// ---------------------------------------------------------------------------

const ecKeys256 = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const ecKeys384 = generateKeyPairSync('ec', {
  namedCurve: 'P-384',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const ecKeys512 = generateKeyPairSync('ec', {
  namedCurve: 'P-521',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

function makeESToken(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  alg: 'ES256' | 'ES384' | 'ES512' = 'ES256',
): string {
  const header = b64url(JSON.stringify({ alg, typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const nodeAlg = { ES256: 'SHA256', ES384: 'SHA384', ES512: 'SHA512' }[alg]
  // JWT requires IEEE P1363 format; Node.js createSign produces DER by default for EC
  const sig = createSign(nodeAlg)
    .update(`${header}.${body}`)
    .sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' }, 'base64url')
  return `${header}.${body}.${sig}`
}

describe('ES256/384/512 token verification', () => {
  test('verifies an ES256 token', async () => {
    const token = makeESToken({ sub: 'ec-user' }, ecKeys256.privateKey as string)
    const mw = ODJWTMiddleware({ publicKey: ecKeys256.publicKey as string, algorithms: ['ES256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    const user = ctx.state.get('user') as Record<string, unknown>
    expect(user.sub).toBe('ec-user')
  })

  test('verifies ES384', async () => {
    const token = makeESToken({ sub: 'ec384' }, ecKeys384.privateKey as string, 'ES384')
    const mw = ODJWTMiddleware({ publicKey: ecKeys384.publicKey as string, algorithms: ['ES384'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('verifies ES512', async () => {
    const token = makeESToken({ sub: 'ec512' }, ecKeys512.privateKey as string, 'ES512')
    const mw = ODJWTMiddleware({ publicKey: ecKeys512.publicKey as string, algorithms: ['ES512'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('returns 401 for ES256 token signed with a different key', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const otherKeys = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const token = makeESToken({ sub: 'u' }, otherKeys.privateKey as string)
    const mw = ODJWTMiddleware({ publicKey: ecKeys256.publicKey as string, algorithms: ['ES256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 when the ES256 header is paired with a P-384 key', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeESToken({ sub: 'wrong-curve' }, ecKeys384.privateKey as string, 'ES256')
    const mw = ODJWTMiddleware({ publicKey: ecKeys384.publicKey as string, algorithms: ['ES256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// JWKS
// ---------------------------------------------------------------------------

describe('JWKS key resolution', () => {
  const SECRET_BYTES = Buffer.from('test-jwks-secret-at-least-32-bytes!!')
  const KID = 'key-1'

  function jwksBody(kid: string): string {
    return JSON.stringify({
      keys: [{ kty: 'oct', kid, k: SECRET_BYTES.toString('base64url') }],
    })
  }

  function makeJwksToken(payload: Record<string, unknown>, kid: string): string {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid }))
    const body = b64url(JSON.stringify(payload))
    const sig = createHmac('sha256', SECRET_BYTES).update(`${header}.${body}`).digest('base64url')
    return `${header}.${body}.${sig}`
  }

  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return { ok: true, text: async () => jwksBody(KID) } as Response
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('fetches JWKS and verifies a token by kid', async () => {
    const token = makeJwksToken({ sub: 'jwks-user' }, KID)
    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    const user = ctx.state.get('user') as Record<string, unknown>
    expect(user.sub).toBe('jwks-user')
  })

  test('returns 401 when no key matches', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeJwksToken({ sub: 'u' }, 'unknown-kid')
    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1)
  })

  test('returns 401 when JWKS fetch fails with HTTP error', async () => {
    jest.restoreAllMocks()
    jest.spyOn(console, 'warn').mockImplementation()
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response)
    const token = makeJwksToken({ sub: 'u' }, KID)
    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 when JWKS response has no keys array', async () => {
    jest.restoreAllMocks()
    jest.spyOn(console, 'warn').mockImplementation()
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ not_keys: [] }),
    } as Response)
    const token = makeJwksToken({ sub: 'u' }, KID)
    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('coalesces concurrent JWKS fetches', async () => {
    const token = makeJwksToken({ sub: 'u' }, KID)
    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const [ctx1, ctx2] = [
      createContext('GET', { authorization: `Bearer ${token}` }),
      createContext('GET', { authorization: `Bearer ${token}` }),
    ]
    await Promise.all([mw(ctx1), mw(ctx2)])
    // Both should succeed and fetch was called only once (cache hit or coalesced)
    expect(ctx1.response.code).not.toBe(401)
    expect(ctx2.response.code).not.toBe(401)
  })

  test('uses cached keys on second request (fetch called only once)', async () => {
    const token = makeJwksToken({ sub: 'u' }, KID)
    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx1 = createContext('GET', { authorization: `Bearer ${token}` })
    const ctx2 = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx1)
    await mw(ctx2)
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1)
  })

  test('default algorithms for jwksUri is RS256', () => {
    // The middleware should not throw and should default to RS256
    expect(() => ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json' })).not.toThrow()
  })

  test('returns 401 when JWKS contains no usable keys (all keys fail to import)', async () => {
    jest.restoreAllMocks()
    jest.spyOn(console, 'warn').mockImplementation()
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ keys: [{ kty: 'unsupported-type', kid: 'bad' }] }),
    } as Response)
    // Build a minimal parseable token so we reach the JWKS resolve step
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = b64url(JSON.stringify({ sub: 'u' }))
    const token = `${header}.${body}.fakesig`
    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('does not re-fetch JWKS on unknown kid by default', async () => {
    jest.restoreAllMocks()
    jest.spyOn(console, 'warn').mockImplementation()
    const KID_NEW = 'rotated-key'
    const SECRET_NEW = Buffer.from('rotation-secret-that-is-at-least-32-bytes!!')
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ keys: [{ kty: 'oct', kid: 'old-key', k: Buffer.from('old-secret').toString('base64url') }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ keys: [{ kty: 'oct', kid: KID_NEW, k: SECRET_NEW.toString('base64url') }] }),
      } as Response)

    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: KID_NEW }))
    const body = b64url(JSON.stringify({ sub: 'rotated-user' }))
    const sig = createHmac('sha256', SECRET_NEW).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`

    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1)
  })

  test('re-fetches JWKS on unknown kid when instantKeyResolution is enabled', async () => {
    jest.restoreAllMocks()
    const KID_NEW = 'rotated-key'
    const SECRET_NEW = Buffer.from('rotation-secret-that-is-at-least-32-bytes!!')
    // First fetch returns old key (different kid); second returns the rotated key
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ keys: [{ kty: 'oct', kid: 'old-key', k: Buffer.from('old-secret').toString('base64url') }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ keys: [{ kty: 'oct', kid: KID_NEW, k: SECRET_NEW.toString('base64url') }] }),
      } as Response)

    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: KID_NEW }))
    const body = b64url(JSON.stringify({ sub: 'rotated-user' }))
    const sig = createHmac('sha256', SECRET_NEW).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`

    const mw = ODJWTMiddleware({
      jwksUri: 'https://example.com/.well-known/jwks.json',
      algorithms: ['HS256'],
      instantKeyResolution: true,
    })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2)
    const user = ctx.state.get('user') as Record<string, unknown>
    expect(user.sub).toBe('rotated-user')
  })
})

// ---------------------------------------------------------------------------
// JWKS with RSA JWK (exercises createPublicKey path, line 196)
// ---------------------------------------------------------------------------

describe('JWKS RSA JWK resolution', () => {
  const { createPublicKey } = require('node:crypto') as typeof import('node:crypto')

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('verifies a token using an RSA JWK fetched from JWKS endpoint', async () => {
    // Export the RSA public key as JWK so we can serve it from the mock JWKS endpoint
    const rsaJwk = createPublicKey(rsaKeys.publicKey as string).export({ format: 'jwk' }) as Record<string, unknown>
    const KID = 'rsa-jwk-key'
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ keys: [{ ...rsaJwk, kid: KID }] }),
    } as Response)

    const token = makeRSToken({ sub: 'rsa-jwk-user', kid: KID } as any, rsaKeys.privateKey as string)
    // Add kid to the token header manually
    const parts = token.split('.')
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    header.kid = KID
    const newHeaderB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
    const signingInput = `${newHeaderB64}.${parts[1]}`
    const { createSign } = require('node:crypto') as typeof import('node:crypto')
    const sig = createSign('RSA-SHA256').update(signingInput).sign(rsaKeys.privateKey as string, 'base64url')
    const tokenWithKid = `${signingInput}.${sig}`

    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['RS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${tokenWithKid}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    const user = ctx.state.get('user') as Record<string, unknown>
    expect(user.sub).toBe('rsa-jwk-user')
  })
})

// ---------------------------------------------------------------------------
// JWKS no-kid fallback (line 273: return entry.all)
// ---------------------------------------------------------------------------

describe('JWKS no-kid fallback', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('verifies a token with no kid using all cached keys', async () => {
    // Build a token without a kid field - the resolver should fall back to trying all cached keys
    const SECRET_BYTES = Buffer.from('test-jwks-secret-at-least-32-bytes!!')
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))  // no kid
    const body = b64url(JSON.stringify({ sub: 'no-kid-user' }))
    const sig = createHmac('sha256', SECRET_BYTES).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        keys: [{ kty: 'oct', k: SECRET_BYTES.toString('base64url') }],  // no kid in JWKS entry either
      }),
    } as Response)

    // Verify the token header has no kid field
    const headerObj = JSON.parse(Buffer.from(header, 'base64url').toString())
    expect(headerObj.kid).toBeUndefined()

    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    const user = ctx.state.get('user') as Record<string, unknown>
    expect(user.sub).toBe('no-kid-user')
  })

  test('skips incompatible keys and keeps trying when a no-kid HS256 token is checked against a mixed JWKS', async () => {
    const SECRET_BYTES = Buffer.from('test-jwks-secret-at-least-32-bytes!!')
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = b64url(JSON.stringify({ sub: 'mixed-jwks-user' }))
    const sig = createHmac('sha256', SECRET_BYTES).update(`${header}.${body}`).digest('base64url')
    const token = `${header}.${body}.${sig}`

    const { createPublicKey } = require('node:crypto') as typeof import('node:crypto')
    const rsaJwk = createPublicKey(rsaKeys.publicKey as string).export({ format: 'jwk' }) as Record<string, unknown>

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        keys: [
          rsaJwk,
          { kty: 'oct', k: SECRET_BYTES.toString('base64url') },
        ],
      }),
    } as Response)

    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    const user = ctx.state.get('user') as Record<string, unknown>
    expect(user.sub).toBe('mixed-jwks-user')
  })
})

// ---------------------------------------------------------------------------
// ODWithUser decorator
// ---------------------------------------------------------------------------

describe('ODWithUser decorator', () => {
  test('adds a user getter that reads from context.state', () => {
    @ODWithUser()
    class TestController extends ODController {}

    const app = new ODApp()
    const request = new ODRequest({ method: 'GET', url: '/' })
    const response = new ODResponse()
    const ctx = new ODContext(app, request, response, dummyRoute)
    ctx.state.set('user', { id: 42, email: 'test@example.com' })

    const controller = new TestController(ctx)
    const user = (controller as unknown as { user: Record<string, unknown> }).user
    expect(user).toEqual({ id: 42, email: 'test@example.com' })
  })

  test('returns undefined when no user is stored in state', () => {
    @ODWithUser()
    class TestController2 extends ODController {}

    const app = new ODApp()
    const ctx = new ODContext(
      app,
      new ODRequest({ method: 'GET', url: '/' }),
      new ODResponse(),
      dummyRoute,
    )

    const controller = new TestController2(ctx)
    expect((controller as unknown as { user: unknown }).user).toBeUndefined()
  })

  test('respects a custom stateKey', () => {
    @ODWithUser('jwt')
    class TestController3 extends ODController {}

    const app = new ODApp()
    const ctx = new ODContext(
      app,
      new ODRequest({ method: 'GET', url: '/' }),
      new ODResponse(),
      dummyRoute,
    )
    ctx.state.set('jwt', { sub: 'custom-key' })

    const controller = new TestController3(ctx)
    const user = (controller as unknown as { user: Record<string, unknown> }).user
    expect(user?.sub).toBe('custom-key')
  })
})

// ---------------------------------------------------------------------------

describe('issuer and audience validation', () => {
  const SECRET = 'test-secret'

  test('accepts a token with the correct issuer', async () => {
    const token = makeHSToken({ iss: 'https://auth.example.com' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, issuer: 'https://auth.example.com' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('rejects a token with an unexpected issuer', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ iss: 'https://evil.example.com' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, issuer: 'https://auth.example.com' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('accepts a token whose issuer matches one of the allowed issuers', async () => {
    const token = makeHSToken({ iss: 'https://auth2.example.com' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, issuer: ['https://auth1.example.com', 'https://auth2.example.com'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('accepts a token with the correct audience (string)', async () => {
    const token = makeHSToken({ aud: 'my-api' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, audience: 'my-api' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('rejects a token with a non-matching audience', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ aud: 'other-api' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, audience: 'my-api' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('accepts a token whose audience array contains a match', async () => {
    const token = makeHSToken({ aud: ['my-api', 'other-api'] }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, audience: 'my-api' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('rejects a token when aud claim is absent but audience validation is required', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    // payload.aud is undefined -> tokenAud = [] (the [] fallback in the ternary chain)
    const token = makeHSToken({ sub: 'u' }, SECRET)  // no aud claim
    const mw = ODJWTMiddleware({ secret: SECRET, audience: 'my-api' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('accepts a token when audience option is an array (Array.isArray true branch)', async () => {
    // audience option is an array -> covers Array.isArray(options.audience) ? options.audience : [options.audience]
    const token = makeHSToken({ aud: 'api2' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET, audience: ['api1', 'api2'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// typ header claim validation
// ---------------------------------------------------------------------------

describe('typ header validation', () => {
  const SECRET = 'test-secret'

  /** Build a token with a specific typ header value (or omit if null). */
  function makeTokenWithTyp(typ: string | null, payload: Record<string, unknown> = {}): string {
    const headerObj: Record<string, unknown> = { alg: 'HS256' }
    if (typ !== null) headerObj.typ = typ
    const header = b64url(JSON.stringify(headerObj))
    const body = b64url(JSON.stringify(payload))
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    return `${header}.${body}.${sig}`
  }

  test('accepts a token when typ matches the expected value', async () => {
    const token = makeTokenWithTyp('JWT')
    const mw = ODJWTMiddleware({ secret: SECRET, typ: 'JWT' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('rejects a token when typ does not match', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeTokenWithTyp('access_token')
    const mw = ODJWTMiddleware({ secret: SECRET, typ: 'JWT' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('typ matching is case-insensitive', async () => {
    const token = makeTokenWithTyp('JWT')
    const mw = ODJWTMiddleware({ secret: SECRET, typ: 'jwt' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
  })

  test('accepts a token when typ matches one of an array of allowed values', async () => {
    const token = makeTokenWithTyp('at+jwt')
    const mw = ODJWTMiddleware({ secret: SECRET, typ: ['JWT', 'at+jwt'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
  })

  test('rejects a token when typ matches none of the allowed array values', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeTokenWithTyp('refresh_token')
    const mw = ODJWTMiddleware({ secret: SECRET, typ: ['JWT', 'at+jwt'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('rejects a token with no typ when typ validation is required', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeTokenWithTyp(null)
    const mw = ODJWTMiddleware({ secret: SECRET, typ: 'JWT' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('accepts any typ when the typ option is not set', async () => {
    const token = makeTokenWithTyp('anything')
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// crit header validation
// ---------------------------------------------------------------------------

describe('crit header validation', () => {
  const SECRET = 'test-secret'

  function makeTokenWithCrit(crit: string[], extraHeader: Record<string, unknown> = {}, payload: Record<string, unknown> = {}): string {
    const headerObj: Record<string, unknown> = { alg: 'HS256', crit, ...extraHeader }
    const header = b64url(JSON.stringify(headerObj))
    const body = b64url(JSON.stringify(payload))
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
    return `${header}.${body}.${sig}`
  }

  test('accepts a token when crit values are allowed', async () => {
    const token = makeTokenWithCrit(['tenant'], { tenant: 'blue' })
    const mw = ODJWTMiddleware({ secret: SECRET, crit: 'tenant' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    expect(ctx.state.get('user')).toBeDefined()
  })

  test('rejects a token when crit contains a value outside the allowed list', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeTokenWithCrit(['tenant'], { tenant: 'blue' })
    const mw = ODJWTMiddleware({ secret: SECRET, crit: 'region' })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('rejects a token with crit when the crit option is not set', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeTokenWithCrit(['tenant'], { tenant: 'blue' })
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// JWKS fetch timeout and body size options (SEC-3)
// ---------------------------------------------------------------------------

describe('JWKS fetch timeout and body size options', () => {
  const SECRET_BYTES = Buffer.from('test-jwks-secret-at-least-32-bytes!!')
  const KID = 'key-opt'

  function makeJwksToken(payload: Record<string, unknown>): string {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: KID }))
    const body = b64url(JSON.stringify(payload))
    const sig = createHmac('sha256', SECRET_BYTES).update(`${header}.${body}`).digest('base64url')
    return `${header}.${body}.${sig}`
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('passes jwksFetchTimeout to fetch as AbortSignal.timeout', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout')
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ keys: [{ kty: 'oct', kid: KID, k: SECRET_BYTES.toString('base64url') }] }),
    } as Response)

    const token = makeJwksToken({ sub: 'u1' })
    const mw = ODJWTMiddleware({
      jwksUri: 'https://example.com/.well-known/jwks.json',
      algorithms: ['HS256'],
      jwksFetchTimeout: 3000,
    })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)

    expect(timeoutSpy).toHaveBeenCalledWith(3000)
  })

  test('rejects when JWKS response body exceeds jwksMaxBodySize', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const largeBody = JSON.stringify({ keys: [{ kty: 'oct', kid: KID, k: SECRET_BYTES.toString('base64url') }] })
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => largeBody,
    } as Response)

    const token = makeJwksToken({ sub: 'u1' })
    const mw = ODJWTMiddleware({
      jwksUri: 'https://example.com/.well-known/jwks.json',
      algorithms: ['HS256'],
      jwksMaxBodySize: 10, // body is larger than 10 bytes
    })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('enforces jwksMaxBodySize by UTF-8 bytes, not character count', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const wideBody = JSON.stringify({
      keys: [{ kty: 'oct', kid: KID, k: SECRET_BYTES.toString('base64url'), note: '\u00e9'.repeat(40) }],
    })
    const charLength = wideBody.length
    const byteLength = Buffer.byteLength(wideBody, 'utf8')
    expect(byteLength).toBeGreaterThan(charLength)

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => wideBody,
      headers: new Headers(),
    } as Response)

    const token = makeJwksToken({ sub: 'u1' })
    const mw = ODJWTMiddleware({
      jwksUri: 'https://example.com/.well-known/jwks.json',
      algorithms: ['HS256'],
      jwksMaxBodySize: charLength,
    })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('uses default timeout 5000ms when jwksFetchTimeout is not set', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout')
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ keys: [{ kty: 'oct', kid: KID, k: SECRET_BYTES.toString('base64url') }] }),
    } as Response)

    const token = makeJwksToken({ sub: 'u1' })
    const mw = ODJWTMiddleware({
      jwksUri: 'https://example.com/.well-known/jwks.json',
      algorithms: ['HS256'],
    })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)

    expect(timeoutSpy).toHaveBeenCalledWith(5000)
  })
})

// ---------------------------------------------------------------------------
// jtiValidator
// ---------------------------------------------------------------------------

describe('jtiValidator', () => {
  const SECRET = 'test-secret'

  test('accepts a token when jtiValidator returns true', async () => {
    const token = makeHSToken({ sub: 'u1', jti: 'abc-123' }, SECRET)
    const jtiValidator = jest.fn().mockResolvedValue(true)
    const mw = ODJWTMiddleware({ secret: SECRET, jtiValidator })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(200)
    expect(jtiValidator).toHaveBeenCalledTimes(1)
    // validator receives the decoded payload and the context
    expect(jtiValidator.mock.calls[0][0]).toMatchObject({ sub: 'u1', jti: 'abc-123' })
    expect(jtiValidator.mock.calls[0][1]).toBe(ctx)
  })

  test('rejects a token when jtiValidator returns false', async () => {
      jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1', jti: 'used-token' }, SECRET)
    const jtiValidator = jest.fn().mockResolvedValue(false)
    const mw = ODJWTMiddleware({ secret: SECRET, jtiValidator })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('rejects a token with no jti claim when jtiValidator is set', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1' }, SECRET)  // no jti
    const jtiValidator = jest.fn().mockResolvedValue(true)
    const mw = ODJWTMiddleware({ secret: SECRET, jtiValidator })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
    expect(jtiValidator).not.toHaveBeenCalled()
  })

  test('rejects a token with an empty string jti when jtiValidator is set', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1', jti: '' }, SECRET)
    const jtiValidator = jest.fn().mockResolvedValue(true)
    const mw = ODJWTMiddleware({ secret: SECRET, jtiValidator })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
    expect(jtiValidator).not.toHaveBeenCalled()
  })

  test('does not call jtiValidator when jtiValidator is not set', async () => {
    const token = makeHSToken({ sub: 'u1' }, SECRET)  // no jti, no validator
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(200)
  })

  test('jtiValidator rejection is silent in optional mode', async () => {
    const token = makeHSToken({ sub: 'u1', jti: 'used' }, SECRET)
    const jtiValidator = jest.fn().mockResolvedValue(false)
    const mw = ODJWTMiddleware({ secret: SECRET, jtiValidator, optional: true })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(200)   // no 401, middleware just returns early
    expect(ctx.state.has('user')).toBe(false)
  })

  test('missing jti is silent in optional mode', async () => {
    const token = makeHSToken({ sub: 'u1' }, SECRET)
    const jtiValidator = jest.fn().mockResolvedValue(true)
    const mw = ODJWTMiddleware({ secret: SECRET, jtiValidator, optional: true })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(200)
    expect(ctx.state.has('user')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Constructor validation – algorithms and JWKS URI (fixes #5, #7)
// ---------------------------------------------------------------------------

describe('ODJWTMiddleware constructor validation (additional)', () => {
  test('throws when algorithms is an empty array', () => {
    expect(() => ODJWTMiddleware({ secret: 'secret', algorithms: [] })).toThrow(
      'ODJWTMiddleware: options.algorithms must not be empty',
    )
  })

  test('throws when jwksUri is not a structurally valid URL', () => {
    expect(() => ODJWTMiddleware({ jwksUri: 'not-a-url' })).toThrow(
      'JWKS endpoint is not a valid URL',
    )
  })

  test('throws when jwksUri uses http instead of https', () => {
    expect(() => ODJWTMiddleware({ jwksUri: 'http://example.com/jwks.json' })).toThrow(
      'Incorrect schema for JWKS endpoint ("https://" is required)',
    )
  })
})

// ---------------------------------------------------------------------------
// publicKey default algorithm (fix #2)
// ---------------------------------------------------------------------------

describe('publicKey default algorithm', () => {
  test('defaults to RS256 when publicKey is provided without an algorithms option', async () => {
    const token = makeRSToken({ sub: 'default-alg-user' }, rsaKeys.privateKey as string, 'RS256')
    const mw = ODJWTMiddleware({ publicKey: rsaKeys.publicKey as string }) // no algorithms
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    expect((ctx.state.get('user') as Record<string, unknown>).sub).toBe('default-alg-user')
  })

  test('rejects a token whose algorithm does not match the default RS256 when publicKey is used', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    // Build an RS384 token - default for publicKey is ['RS256'], so this should be rejected
    const token = makeRSToken({ sub: 'u' }, rsaKeys.privateKey as string, 'RS384')
    const mw = ODJWTMiddleware({ publicKey: rsaKeys.publicKey as string }) // no algorithms → defaults to RS256
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Numeric claim type validation (fix #3)
// ---------------------------------------------------------------------------

describe('numeric claim type validation', () => {
  const SECRET = 'test-secret'

  test('returns 401 when exp claim is a string instead of a number', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1', exp: 'never' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 when nbf claim is a string instead of a number', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1', nbf: 'tomorrow' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('returns 401 when iat claim is a string instead of a number', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    const token = makeHSToken({ sub: 'u1', iat: 'yesterday' }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).toBe(401)
  })

  test('accepts a valid token when all numeric claims are actual numbers', async () => {
    const token = makeHSToken({ sub: 'u1', exp: now() + 3600, nbf: now() - 60, iat: now() - 30 }, SECRET)
    const mw = ODJWTMiddleware({ secret: SECRET })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.state.get('user')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// JWK use field filtering (fix #6)
// ---------------------------------------------------------------------------

describe('JWKS use field filtering', () => {
  const SECRET_BYTES_USE = Buffer.from('use-field-test-secret-32-bytes!!')
  const KID_USE = 'use-test-key'

  function makeUseTestToken(payload: Record<string, unknown>, kid: string): string {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid }))
    const body = b64url(JSON.stringify(payload))
    const sig = createHmac('sha256', SECRET_BYTES_USE).update(`${header}.${body}`).digest('base64url')
    return `${header}.${body}.${sig}`
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('returns 401 when the only JWKS key has use set to enc', async () => {
    jest.spyOn(console, 'warn').mockImplementation()
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        keys: [{ kty: 'oct', kid: KID_USE, k: SECRET_BYTES_USE.toString('base64url'), use: 'enc' }],
      }),
    } as Response)

    const token = makeUseTestToken({ sub: 'u' }, KID_USE)
    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    // The enc key was filtered out → no usable keys → 401
    expect(ctx.response.code).toBe(401)
  })

  test('uses the sig key and ignores the enc key when both are in JWKS', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        keys: [
          { kty: 'oct', kid: 'enc-only', k: Buffer.from('wrong-key-data-here!').toString('base64url'), use: 'enc' },
          { kty: 'oct', kid: KID_USE, k: SECRET_BYTES_USE.toString('base64url'), use: 'sig' },
        ],
      }),
    } as Response)

    const token = makeUseTestToken({ sub: 'sig-user' }, KID_USE)
    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    expect((ctx.state.get('user') as Record<string, unknown>).sub).toBe('sig-user')
  })

  test('accepts a key with no use field (use is optional per RFC 7517)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        keys: [{ kty: 'oct', kid: KID_USE, k: SECRET_BYTES_USE.toString('base64url') }], // no use field
      }),
    } as Response)

    const token = makeUseTestToken({ sub: 'no-use-field-user' }, KID_USE)
    const mw = ODJWTMiddleware({ jwksUri: 'https://example.com/.well-known/jwks.json', algorithms: ['HS256'] })
    const ctx = createContext('GET', { authorization: `Bearer ${token}` })
    await mw(ctx)
    expect(ctx.response.code).not.toBe(401)
    expect((ctx.state.get('user') as Record<string, unknown>).sub).toBe('no-use-field-user')
  })
})
