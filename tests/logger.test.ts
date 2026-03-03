import { defaultLogger, ODLogger } from '../src/core/logger'
import ODApp from '../src/core/app'
import ODRequest from '../src/core/request'
import ODController from '../src/core/controller'

describe('defaultLogger', () => {
  test('has error, warn, info methods', () => {
    expect(typeof defaultLogger.error).toBe('function')
    expect(typeof defaultLogger.warn).toBe('function')
    expect(typeof defaultLogger.info).toBe('function')
  })
})

describe('custom logger via ODApp', () => {
  test('app exposes the logger', () => {
    const app = new ODApp()
    expect(app.logger).toBe(defaultLogger)
  })

  test('app uses custom logger', () => {
    const custom: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const app = new ODApp({ logger: custom })
    expect(app.logger).toBe(custom)
  })

  test('custom logger receives error calls from processRequest', async () => {
    const custom: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }

    class FailController extends ODController {
      static get path() { return '/' }
      async doGet() {
        throw new Error('Boom')
      }
    }

    const app = await ODApp
      .create({ logger: custom })
      .useController(FailController)
      .init()

    const req = new ODRequest({ method: 'GET', url: '/' })
    const res = await app.processRequest(req)
    expect(custom.error).toHaveBeenCalled()
    expect(res.code).toBe(500)
  })
})
