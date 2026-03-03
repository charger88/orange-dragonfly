import { createHmac } from 'node:crypto'
import ODApp from '../../src/core/app'
import ODRequest from '../../src/core/request'
import { generateJWT } from '../actions/generate-demo-token'
import PrivateController, { DEMO_JWT_SECRET } from '../controllers/private'

/** Builds an arbitrary JWT signed with the given secret - used to craft edge-case tokens. */
function buildToken(secret: string, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

function validClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return { sub: 'test-user', name: 'Test User', role: 'admin', iat: now, exp: now + 3600, ...overrides }
}

let app: ODApp

beforeAll(async() => {
  app = await ODApp
    .create()
    .useController(PrivateController)
    .init()
})

describe('PrivateController', () => {
  describe('GET /private - success', () => {
    test('returns 200 for a valid token', async() => {
      const { token } = generateJWT('alice', 'Alice', 'admin')
      const req = new ODRequest({ method: 'GET', url: '/private', headers: { authorization: `Bearer ${token}` } })
      const res = await app.processRequest(req)
      expect(res.code).toBe(200)
    })

    test('response body contains message and decoded user payload', async() => {
      const { token } = generateJWT('alice', 'Alice', 'viewer')
      const req = new ODRequest({ method: 'GET', url: '/private', headers: { authorization: `Bearer ${token}` } })
      const res = await app.processRequest(req)
      const body = res.content as Record<string, unknown>
      expect(body.message).toBe('Access granted')
      const user = body.user as Record<string, unknown>
      expect(user.sub).toBe('alice')
      expect(user.name).toBe('Alice')
      expect(user.role).toBe('viewer')
    })
  })

  describe('GET /private - auth failures', () => {
    test('returns 401 when Authorization header is missing', async() => {
      const req = new ODRequest({ method: 'GET', url: '/private' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(401)
    })

    test('returns 401 when Bearer prefix is absent', async() => {
      const { token } = generateJWT('alice', 'Alice', 'admin')
      const req = new ODRequest({ method: 'GET', url: '/private', headers: { authorization: token } })
      const res = await app.processRequest(req)
      expect(res.code).toBe(401)
    })

    test('returns 401 when token is signed with a different secret', async() => {
      const token = buildToken('wrong-secret', validClaims())
      const req = new ODRequest({ method: 'GET', url: '/private', headers: { authorization: `Bearer ${token}` } })
      const res = await app.processRequest(req)
      expect(res.code).toBe(401)
    })

    test('returns 401 when token is expired', async() => {
      const now = Math.floor(Date.now() / 1000)
      const token = buildToken(DEMO_JWT_SECRET, validClaims({ iat: now - 7200, exp: now - 3600 }))
      const req = new ODRequest({ method: 'GET', url: '/private', headers: { authorization: `Bearer ${token}` } })
      const res = await app.processRequest(req)
      expect(res.code).toBe(401)
    })

    test('returns 401 when nbf claim is in the future', async() => {
      const now = Math.floor(Date.now() / 1000)
      const token = buildToken(DEMO_JWT_SECRET, validClaims({ nbf: now + 3600 }))
      const req = new ODRequest({ method: 'GET', url: '/private', headers: { authorization: `Bearer ${token}` } })
      const res = await app.processRequest(req)
      expect(res.code).toBe(401)
    })

    test('returns 401 for a structurally malformed token', async() => {
      const req = new ODRequest({ method: 'GET', url: '/private', headers: { authorization: 'Bearer not-a-jwt' } })
      const res = await app.processRequest(req)
      expect(res.code).toBe(401)
    })

    test('returns 401 when payload JSON is corrupted', async() => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
      const corruptPayload = Buffer.from('not-valid-json{{{').toString('base64url')
      const sig = createHmac('sha256', DEMO_JWT_SECRET).update(`${header}.${corruptPayload}`).digest('base64url')
      const token = `${header}.${corruptPayload}.${sig}`
      const req = new ODRequest({ method: 'GET', url: '/private', headers: { authorization: `Bearer ${token}` } })
      const res = await app.processRequest(req)
      expect(res.code).toBe(401)
    })
  })

  describe('OPTIONS /private', () => {
    // JWT verification is skipped for CORS preflight requests by default,
    // so browser preflight checks work without a token.
    test('returns 204 with Allow header for CORS preflight without a token', async() => {
      const req = new ODRequest({
        method: 'OPTIONS',
        url: '/private',
        headers: {
          origin: 'https://client.example',
          'access-control-request-method': 'GET',
        },
      })
      const res = await app.processRequest(req)
      expect(res.code).toBe(204)
      const allow = res.headers.find(h => h.name === 'Allow')
      expect(allow).toBeDefined()
      expect(allow!.value).toContain('GET')
      expect(allow!.value).toContain('OPTIONS')
    })
  })
})
