import ODApp from '../../src/core/app'
import ODRequest from '../../src/core/request'
import { IndexController } from '../controllers'

let app: ODApp

beforeAll(async() => {
  app = await ODApp
    .create()
    .useController(IndexController)
    .init()
})

describe('IndexController', () => {
  test('GET / returns welcome message', async() => {
    const req = new ODRequest({ method: 'GET', url: '/' })
    const res = await app.processRequest(req)
    expect(res.code).toBe(200)
    const body = res.content as Record<string, unknown>
    expect(body.message).toBe('Welcome to OD.js!')
    expect(body).toHaveProperty('env')
  })

  test('OPTIONS / returns 204 with allowed methods', async() => {
    const req = new ODRequest({ method: 'OPTIONS', url: '/' })
    const res = await app.processRequest(req)
    expect(res.code).toBe(204)
    const allowHeader = res.headers.find(h => h.name === 'Allow')
    expect(allowHeader).toBeDefined()
    expect(allowHeader!.value).toContain('GET')
    expect(allowHeader!.value).toContain('OPTIONS')
  })
})
