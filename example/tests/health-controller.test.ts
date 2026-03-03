import ODApp from '../../src/core/app'
import ODRequest from '../../src/core/request'
import ODHealthController from '../../src/controllers/health'

let app: ODApp

beforeAll(async() => {
  app = await ODApp
    .create()
    .useController(ODHealthController)
    .init()
})

describe('ODHealthController', () => {
  describe('GET /health', () => {
    test('returns 200', async() => {
      const req = new ODRequest({ method: 'GET', url: '/health' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(200)
    })

    test('status is "ok"', async() => {
      const req = new ODRequest({ method: 'GET', url: '/health' })
      const res = await app.processRequest(req)
      const body = res.content as Record<string, unknown>
      expect(body.status).toBe('ok')
    })

    test('uptime is a non-negative number', async() => {
      const req = new ODRequest({ method: 'GET', url: '/health' })
      const res = await app.processRequest(req)
      const body = res.content as Record<string, unknown>
      expect(typeof body.uptime).toBe('number')
      expect(body.uptime as number).toBeGreaterThanOrEqual(0)
    })

    test('timestamp is a valid ISO 8601 string', async() => {
      const before = Date.now()
      const req = new ODRequest({ method: 'GET', url: '/health' })
      const res = await app.processRequest(req)
      const after = Date.now()
      const body = res.content as Record<string, unknown>
      expect(typeof body.timestamp).toBe('string')
      const parsed = new Date(body.timestamp as string).getTime()
      expect(parsed).toBeGreaterThanOrEqual(before)
      expect(parsed).toBeLessThanOrEqual(after)
    })
  })

  describe('OPTIONS /health', () => {
    test('returns 204 with Allow header listing GET and OPTIONS', async() => {
      const req = new ODRequest({ method: 'OPTIONS', url: '/health' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(204)
      const allow = res.headers.find(h => h.name === 'Allow')
      expect(allow).toBeDefined()
      expect(allow!.value).toContain('GET')
      expect(allow!.value).toContain('OPTIONS')
    })
  })

  describe('path', () => {
    test('GET /health is reachable and GET /users is not (path isolation)', async() => {
      const req = new ODRequest({ method: 'GET', url: '/users' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(404)
    })
  })
})
