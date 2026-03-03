import ODRequest from '../../src/core/request'
import app from '../setup'

const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
const appLoggerInfoSpy = jest.spyOn(app.logger, 'info').mockImplementation()

beforeAll(async() => {
  await app.init()
})

afterAll(() => {
  consoleLogSpy.mockRestore()
  appLoggerInfoSpy.mockRestore()
})

describe('X-Request-Id', () => {
  test('response includes X-Request-Id header', async() => {
    const req = new ODRequest({ method: 'GET', url: '/', id: 'req-1' })
    const res = await app.processRequest(req)
    expect(res.headers.find(h => h.name.toLowerCase() === 'x-request-id')?.value).toBe('req-1')
  })

  test('response includes X-Request-Id header on 404', async() => {
    const req = new ODRequest({ method: 'GET', url: '/test-wrong-url', id: 'req-2' })
    const res = await app.processRequest(req)
    expect(res.headers.find(h => h.name.toLowerCase() === 'x-request-id')?.value).toBe('req-2')
  })
})
