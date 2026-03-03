import ODApp from '../../src/core/app'
import UsersController from '../controllers/users'

let app: ODApp

beforeAll(async() => {
  app = await ODApp
    .create({ queryParser: { integerParameters: ['offset', 'limit'] } })
    .useController(UsersController)
    .init()
})

describe('UsersController', () => {
  describe('GET /users', () => {
    test('returns a list of presidents', async() => {
      const req = app.createRequest({ method: 'GET', url: '/users' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(200)
      const body = res.content as { id: number; name: string }[]
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBe(10)
      expect(body[0]).toEqual({ id: 1, name: 'George Washington' })
    })

    test('supports offset and limit query params', async() => {
      const req = app.createRequest({ method: 'GET', url: '/users?offset=2&limit=3' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(200)
      const body = res.content as { id: number; name: string }[]
      expect(body.length).toBe(3)
      expect(body[0]).toEqual({ id: 3, name: 'Thomas Jefferson' })
    })

    test('returns empty array for large offset', async() => {
      const req = app.createRequest({ method: 'GET', url: '/users?offset=9999' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(200)
      expect(res.content).toEqual([])
    })
  })

  describe('GET /users/:id', () => {
    test('returns a single president by id', async() => {
      const req = app.createRequest({ method: 'GET', url: '/users/1' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(200)
      const body = res.content as Record<string, unknown>
      expect(body).toEqual({ id: 1, name: 'George Washington' })
    })

    test('returns 404 for non-existent id', async() => {
      const req = app.createRequest({ method: 'GET', url: '/users/9999' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(404)
      const body = res.content as Record<string, unknown>
      expect(body.error).toBe('Not found')
    })
  })

  describe('POST /users', () => {
    test('creates a new president', async() => {
      const req = app.createRequest({ method: 'POST', url: '/users', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test President' }) })
      const res = await app.processRequest(req)
      expect(res.code).toBe(201)
      const body = res.content as Record<string, unknown>
      expect(body.name).toBe('Test President')
      expect(body.id).toBeDefined()
    })

    test('returns 422 when name is missing', async() => {
      const req = app.createRequest({ method: 'POST', url: '/users', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
      const res = await app.processRequest(req)
      expect(res.code).toBe(422)
      const body = res.content as Record<string, unknown>
      expect(body.error).toBe('Validation error')
    })

    test('returns 422 when name is not a string', async() => {
      const req = app.createRequest({ method: 'POST', url: '/users', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 123 }) })
      const res = await app.processRequest(req)
      expect(res.code).toBe(422)
      const body = res.content as Record<string, unknown>
      expect(body.error).toBe('Validation error')
    })

    test('returns 400 when body is invalid JSON', async() => {
      const req = app.createRequest({ method: 'POST', url: '/users', headers: { 'content-type': 'application/json' }, body: '' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(400)
    })

    test('returns 409 when name is already in use', async() => {
      const req = app.createRequest({ method: 'POST', url: '/users', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'George Washington' }) })
      const res = await app.processRequest(req)
      expect(res.code).toBe(409)
      const body = res.content as Record<string, unknown>
      expect(body.error).toBe('Name is already in use')
    })
  })

  describe('DELETE /users/:id', () => {
    test('deletes an existing president and returns 204', async() => {
      // First create one to delete
      const createReq = app.createRequest({ method: 'POST', url: '/users', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'To Delete' }) })
      const createRes = await app.processRequest(createReq)
      const createdId = (createRes.content as Record<string, unknown>).id

      const req = app.createRequest({ method: 'DELETE', url: `/users/${createdId}` })
      const res = await app.processRequest(req)
      expect(res.code).toBe(204)
    })

    test('returns 404 when deleting non-existent id', async() => {
      const req = app.createRequest({ method: 'DELETE', url: '/users/9999' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(404)
      const body = res.content as Record<string, unknown>
      expect(body.error).toBe('Not found')
    })
  })

  describe('GET /users/:id/userpic', () => {
    test('route is registered as /users/{#id}/userpic not /users/{#id}/avatar', () => {
      const routes = UsersController.buildRoutes()
      const avatarRoute = routes.find(r => r.action === 'doGetIdAvatar')
      expect(avatarRoute).toBeDefined()
      expect(avatarRoute!.path).toBe('/users/{#id}/userpic')
    })

    test('returns avatar url for existing user', async() => {
      const req = app.createRequest({ method: 'GET', url: '/users/1/userpic' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(200)
      const body = res.content as Record<string, unknown>
      expect(body.userId).toBe(1)
      expect(typeof body.avatarUrl).toBe('string')
    })

    test('returns 404 for non-existent user', async() => {
      const req = app.createRequest({ method: 'GET', url: '/users/9999/userpic' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(404)
    })

    test('old /avatar path is not registered', async() => {
      const req = app.createRequest({ method: 'GET', url: '/users/1/avatar' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(404)
    })
  })

  describe('OPTIONS /users', () => {
    test('returns 204 with allowed methods', async() => {
      const req = app.createRequest({ method: 'OPTIONS', url: '/users' })
      const res = await app.processRequest(req)
      expect(res.code).toBe(204)
      const allowHeader = res.headers.find(h => h.name === 'Allow')
      expect(allowHeader).toBeDefined()
      expect(allowHeader!.value).toContain('GET')
      expect(allowHeader!.value).toContain('POST')
    })
  })
})
