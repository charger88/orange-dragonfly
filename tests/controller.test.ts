import ODController from '../src/core/controller'
import ODContext from '../src/core/context'
import ODRequest from '../src/core/request'
import ODResponse from '../src/core/response'
import ODApp from '../src/core/app'
import ODRoute from '../src/core/route'
import { ODValidatorException, ODValidatorRulesException } from 'orange-dragonfly-validator'
import { Readable } from 'stream'

function createContext(route?: Partial<ODRoute>): ODContext {
  const app = new ODApp()
  const request = new ODRequest({ method: 'GET', url: '/' })
  const response = new ODResponse()
  const defaultRoute: ODRoute = { controller: ODController, action: 'doGet', method: 'GET', path: '/', ...route }
  return new ODContext(app, request, response, defaultRoute)
}

// --- Path generation ---

test('path: Index controller maps to root', () => {
  class IndexController extends ODController {
    async doGet() { return '' }
  }
  Object.defineProperty(IndexController, 'name', { value: 'IndexController' })
  expect(IndexController.path).toBe('/')
})

test('path: named controller maps to dash-case', () => {
  class UsersController extends ODController {
    async doGet() { return '' }
  }
  expect(UsersController.path).toBe('/users')
})

test('path: multi-word controller', () => {
  class UserProfilesController extends ODController {
    async doGet() { return '' }
  }
  expect(UserProfilesController.path).toBe('/user-profiles')
})

test('path: controller without Controller suffix', () => {
  class Products extends ODController {
    async doGet() { return '' }
  }
  expect(Products.path).toBe('/products')
})

test('idParameterName defaults to #id', () => {
  expect(ODController.idParameterName).toBe('#id')
})

// --- buildRoutes ---

test('buildRoutes: basic GET', () => {
  class TestController extends ODController {
    async doGet() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toEqual([
    { method: 'get', path: '/test', action: 'doGet' },
  ])
})

test('buildRoutes: GET with Id', () => {
  class TestController extends ODController {
    async doGetId() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toEqual([
    { method: 'get', path: '/test/{#id}', action: 'doGetId' },
  ])
})

test('buildRoutes: GET with Id and action', () => {
  class TestController extends ODController {
    async doGetIdProfile() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toEqual([
    { method: 'get', path: '/test/{#id}/profile', action: 'doGetIdProfile' },
  ])
})

test('buildRoutes: POST', () => {
  class TestController extends ODController {
    async doPost() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toEqual([
    { method: 'post', path: '/test', action: 'doPost' },
  ])
})

test('buildRoutes: multiple methods', () => {
  class TestController extends ODController {
    async doGet() { return '' }
    async doPost() { return '' }
    async doDelete() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toHaveLength(3)
  expect(routes.map(r => r.method).sort()).toEqual(['delete', 'get', 'post'])
})

test('buildRoutes: Index controller routes to root', () => {
  class IndexController extends ODController {
    async doGet() { return '' }
    async doGetId() { return '' }
  }
  Object.defineProperty(IndexController, 'name', { value: 'IndexController' })
  const routes = IndexController.buildRoutes()
  expect(routes).toContainEqual({ method: 'get', path: '/', action: 'doGet' })
  expect(routes).toContainEqual({ method: 'get', path: '/{#id}', action: 'doGetId' })
})

test('buildRoutes: non-do methods are ignored', () => {
  class TestController extends ODController {
    async doGet() { return '' }
    async helperMethod() { return '' }
    async validateGet() { return undefined }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toHaveLength(1)
  expect(routes[0].action).toBe('doGet')
})

test('buildRoutes: custom idParameterName', () => {
  class TestController extends ODController {
    static get idParameterName() { return '#slug' }
    async doGetId() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes[0].path).toBe('/test/{#slug}')
})

test('buildRoutes: custom relative path via static getter', () => {
  class TestController extends ODController {
    static get pathPost() { return 'create' }
    async doPost() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toEqual([{ method: 'post', path: '/test/create', action: 'doPost' }])
})

test('buildRoutes: custom absolute path via static getter', () => {
  class TestController extends ODController {
    static get pathGet() { return '/absolute-path' }
    async doGet() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toEqual([{ method: 'get', path: '/absolute-path', action: 'doGet' }])
})

test('buildRoutes: custom path for action with Id suffix', () => {
  class TestController extends ODController {
    static get pathGetId() { return 'details' }
    async doGetId() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toEqual([{ method: 'get', path: '/test/{#id}/details', action: 'doGetId' }])
})

test('buildRoutes: custom path replaces suffix, keeping Id in path', () => {
  class TestController extends ODController {
    static get pathGetIdAvatar() { return 'userpic' }
    async doGetIdAvatar() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toEqual([{ method: 'get', path: '/test/{#id}/userpic', action: 'doGetIdAvatar' }])
})

test('buildRoutes: custom path for action with extra suffix', () => {
  class TestController extends ODController {
    static get pathPostIdTricks() { return '/tricks' }
    async doPostIdTricks() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toEqual([{ method: 'post', path: '/tricks', action: 'doPostIdTricks' }])
})

test('buildRoutes: custom relative path on root (Index) controller', () => {
  class IndexController extends ODController {
    static get pathPost() { return 'submit' }
    async doPost() { return '' }
  }
  Object.defineProperty(IndexController, 'name', { value: 'IndexController' })
  const routes = IndexController.buildRoutes()
  expect(routes).toEqual([{ method: 'post', path: '/submit', action: 'doPost' }])
})

test('buildRoutes: action without custom path getter uses default convention', () => {
  class TestController extends ODController {
    async doGet() { return '' }
    static get pathPost() { return 'create' }
    async doPost() { return '' }
  }
  const routes = TestController.buildRoutes()
  expect(routes).toContainEqual({ method: 'get', path: '/test', action: 'doGet' })
  expect(routes).toContainEqual({ method: 'post', path: '/test/create', action: 'doPost' })
})

test('buildRoutes throws when no routes found and no app is passed', () => {
  class EmptyController extends ODController {}
  expect(() => EmptyController.buildRoutes()).toThrow('There is no routes found in controller EmptyController')
})

// --- _getMethods ---

test('_getMethods returns method names from prototype chain', () => {
  class TestController extends ODController {
    async doGet() { return '' }
    async doPost() { return '' }
  }
  const methods = (TestController as any)._getMethods()
  expect(methods).toContain('doGet')
  expect(methods).toContain('doPost')
  // Should not include ODController internals beyond its own methods
  expect(methods).toContain('invoke')
})

test('_getMethods stops at ODController.prototype', () => {
  class TestController extends ODController {
    async doGet() { return '' }
  }
  const methods = (TestController as any)._getMethods()
  // Should not include Object.prototype methods
  expect(methods).not.toContain('toString')
  expect(methods).not.toContain('hasOwnProperty')
})

// --- invoke ---

test('invoke runs action and returns response', async () => {
  class TestController extends ODController {
    async doGet() { return { hello: 'world' } }
  }
  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  const response = await controller.invoke('doGet', {})
  expect(response.content).toEqual({ hello: 'world' })
})

test('invoke runs beforewares before action', async () => {
  const order: string[] = []
  class TestController extends ODController {
    get beforewares() {
      return [async () => { order.push('beforeware'); return undefined }]
    }
    async doGet() { order.push('action'); return '' }
  }
  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  await controller.invoke('doGet', {})
  expect(order).toEqual(['beforeware', 'action'])
})

test('invoke runs afterwares after action', async () => {
  const order: string[] = []
  class TestController extends ODController {
    get afterwares() {
      return [async () => { order.push('afterware'); return undefined }]
    }
    async doGet() { order.push('action'); return '' }
  }
  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  await controller.invoke('doGet', {})
  expect(order).toEqual(['action', 'afterware'])
})

test('invoke stops if beforeware returns response', async () => {
  class TestController extends ODController {
    get beforewares() {
      return [async (ctx: ODContext) => {
        ctx.response.setError(401, 'Unauthorized')
        return ctx.response
      }]
    }
    async doGet() { return 'should not run' }
  }
  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  const response = await controller.invoke('doGet', {})
  expect(response.code).toBe(401)
  expect(response.content).toEqual({ error: 'Unauthorized' })
})

test('invoke calls validation method', async () => {
  class TestController extends ODController {
    async validateGet() {
      this.context.response.setError(422, 'Invalid')
      return this.context.response
    }
    async doGet() { return 'should not run' }
  }
  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  const response = await controller.invoke('doGet', {})
  expect(response.code).toBe(422)
})

test('invoke rethrows errors so app can process them', async () => {
  class TestController extends ODController {
    async doGet() { throw new Error('boom') }
  }
  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  await expect(controller.invoke('doGet', {})).rejects.toThrow('boom')
})

test('invoke: action returning ODResponse replaces context response', async () => {
  class TestController extends ODController {
    async doGet() {
      return new ODResponse(201, 'Created')
    }
  }
  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  const response = await controller.invoke('doGet', {})
  expect(response.code).toBe(201)
  expect(response.content).toBe('Created')
})

test('invoke: afterware returning a different response destroys the abandoned stream', async () => {
  const abandonedStream = Readable.from(['payload'])

  class TestController extends ODController {
    get afterwares() {
      return [async () => new ODResponse(418, 'Teapot')]
    }

    async doGet() {
      return this.response.stream(abandonedStream, 'text/plain')
    }
  }

  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  const response = await controller.invoke('doGet', {})

  expect(response).not.toBe(ctx.response)
  expect(response.code).toBe(418)
  expect(abandonedStream.destroyed).toBe(true)
})

// --- corsOptions ---

test('corsOptions sets Allow header with available methods', async () => {
  class TestController extends ODController {
    async doGet() { return '' }
    async doPost() { return '' }
  }
  const ctx = createContext({ controller: TestController, path: '/test' })
  const controller = new TestController(ctx)
  await controller.corsOptions()
  const allowHeader = ctx.response.headers.find(h => h.name === 'Allow')
  expect(allowHeader).toBeDefined()
  expect(allowHeader!.value).toContain('GET')
  expect(allowHeader!.value).toContain('POST')
  expect(allowHeader!.value).toContain('OPTIONS')
  expect(ctx.response.code).toBe(204)
})

test('corsOptions does not set Access-Control-Allow-Methods without CORS', async () => {
  class TestController extends ODController {
    async doGet() { return '' }
  }
  const ctx = createContext({ controller: TestController, path: '/test' })
  const controller = new TestController(ctx)
  await controller.corsOptions()
  const aclHeader = ctx.response.headers.find(h => h.name === 'Access-Control-Allow-Methods')
  expect(aclHeader).toBeUndefined()
})

test('corsOptions sets Access-Control-Allow-Methods when CORS origin present', async () => {
  class TestController extends ODController {
    async doGet() { return '' }
  }
  const ctx = createContext({ controller: TestController, path: '/test' })
  // Simulate CORS middleware having run
  ctx.response.setHeader('Access-Control-Allow-Origin', '*')
  const controller = new TestController(ctx)
  await controller.corsOptions()
  const aclHeader = ctx.response.headers.find(h => h.name === 'Access-Control-Allow-Methods')
  expect(aclHeader).toBeDefined()
})

// --- setError shorthand ---

test('setError is available on controller instance', async () => {
  class TestController extends ODController {
    async doGet() {
      return this.setError(400, 'Bad request')
    }
  }
  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  const response = await controller.invoke('doGet', {})
  expect(response.code).toBe(400)
  expect(response.content).toEqual({ error: 'Bad request' })
})

// --- request/response shortcuts ---

test('controller.request returns context request', () => {
  class TestController extends ODController {}
  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  expect(controller.request).toBe(ctx.request)
})

test('controller.response returns context response', () => {
  class TestController extends ODController {}
  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  expect(controller.response).toBe(ctx.response)
})

// --- bodyValidator edge cases ---

describe('bodyValidator validation edge cases', () => {
  function makeCtxWithBody(body: string, contentType?: string): ODContext {
    const app = new ODApp()
    const headers: Record<string, string> = {}
    if (contentType) headers['content-type'] = contentType
    const request = new ODRequest({ method: 'POST', url: '/', headers, body })
    const response = new ODResponse()
    const route: ODRoute = { controller: ODController, action: 'doPost', method: 'POST', path: '/' }
    return new ODContext(app, request, response, route)
  }

  test('empty body returns 400 when bodyValidatorPost is present', async () => {
    class TestController extends ODController {
      get bodyValidatorPost() {
        return { exceptionMode: false, validate: jest.fn() } as any
      }
      async doPost() { return 'ok' }
    }
    const ctx = makeCtxWithBody('')
    const controller = new TestController(ctx)
    const response = await controller.invoke('doPost', {})
    expect(response.code).toBe(400)
    expect((response.content as Record<string, unknown>).error).toBe('Empty request')
  })

  test('empty JSON body returns 400 without triggering JSON parse errors when bodyValidatorPost is present', async () => {
    class TestController extends ODController {
      get bodyValidatorPost() {
        return { exceptionMode: false, validate: jest.fn() } as any
      }
      async doPost() { return 'ok' }
    }
    const ctx = makeCtxWithBody('', 'application/json')
    const controller = new TestController(ctx)
    const response = await controller.invoke('doPost', {})
    expect(response.code).toBe(400)
    expect((response.content as Record<string, unknown>).error).toBe('Empty request')
  })

  test('empty form body returns 400 before validation when bodyValidatorPost is present', async () => {
    const validateMock = jest.fn()
    class TestController extends ODController {
      get bodyValidatorPost() {
        return { exceptionMode: false, validate: validateMock } as any
      }
      async doPost() { return 'ok' }
    }
    const ctx = makeCtxWithBody('', 'application/x-www-form-urlencoded')
    const controller = new TestController(ctx)
    const response = await controller.invoke('doPost', {})
    expect(validateMock).not.toHaveBeenCalled()
    expect(response.code).toBe(400)
    expect((response.content as Record<string, unknown>).error).toBe('Empty request')
  })

  test('non-object body returns 400 when bodyValidatorPost is present', async () => {
    class TestController extends ODController {
      get bodyValidatorPost() {
        return { exceptionMode: false, validate: jest.fn() } as any
      }
      async doPost() { return 'ok' }
    }
    const ctx = makeCtxWithBody('plain text', 'text/plain')
    const controller = new TestController(ctx)
    const response = await controller.invoke('doPost', {})
    expect(response.code).toBe(400)
    expect((response.content as Record<string, unknown>).error).toBe("Request can't be parsed for validation")
  })

  test('validator throwing ODValidatorException returns 422', async () => {
    class TestController extends ODController {
      get bodyValidatorPost() {
        return {
          exceptionMode: false,
          validate: jest.fn().mockImplementation(() => {
            throw new ODValidatorException('Validation failed')
          }),
        } as any
      }
      async doPost() { return 'ok' }
    }
    const ctx = makeCtxWithBody('{"a":1}', 'application/json')
    const controller = new TestController(ctx)
    const response = await controller.invoke('doPost', {})
    expect(response.code).toBe(422)
    expect((response.content as Record<string, unknown>).error).toBe('Validation error')
  })

  test('validator throwing ODValidatorRulesException is rethrown', async () => {
    class TestController extends ODController {
      get bodyValidatorPost() {
        return {
          exceptionMode: false,
          validate: jest.fn().mockImplementation(() => {
            throw new ODValidatorRulesException('bad rules')
          }),
        } as any
      }
      async doPost() { return 'ok' }
    }
    const ctx = makeCtxWithBody('{"a":1}', 'application/json')
    const controller = new TestController(ctx)
    await expect(controller.invoke('doPost', {})).rejects.toBeInstanceOf(ODValidatorRulesException)
  })

  test('queryValidatorPost is run and passes without blocking action', async () => {
    const validateMock = jest.fn()
    class TestController extends ODController {
      get queryValidatorPost() {
        return { exceptionMode: false, validate: validateMock } as any
      }
      async doPost() { return 'ok' }
    }
    const ctx = makeCtxWithBody('{"a":1}', 'application/json')
    const controller = new TestController(ctx)
    const response = await controller.invoke('doPost', {})
    expect(validateMock).toHaveBeenCalled()
    expect(response.code).toBe(200)
  })

  test('queryValidatorPost failing returns 422 and short-circuits the action', async () => {
    const validateMock = jest.fn().mockImplementation(() => {
      throw new ODValidatorException('Query validation failed')
    })
    class TestController extends ODController {
      get queryValidatorPost() {
        return { exceptionMode: false, validate: validateMock } as any
      }
      async doPost() { return 'ok' }
    }
    const ctx = makeCtxWithBody('{"a":1}', 'application/json')
    const controller = new TestController(ctx)
    const response = await controller.invoke('doPost', {})
    expect(validateMock).toHaveBeenCalled()
    expect(response.code).toBe(422)
  })
})

// --- handleError wraps non-Error throwables ---

test('handleError wraps a non-Error thrown from the action into an Error', async () => {
  class NonErrorController extends ODController {
    async doGet() {
      throw 'a string was thrown'
    }
  }
  const ctx = createContext({ controller: NonErrorController, action: 'doGet', method: 'GET' })
  const controller = new NonErrorController(ctx)
  await expect(controller.invoke('doGet', {})).rejects.toThrow('a string was thrown')
})

// --- _runEndpoint: endpoint not found ---

test('_runEndpoint throws when action does not exist in controller', async () => {
  const ctx = createContext()
  const controller = new ODController(ctx)
  await expect(controller.invoke('nonExistentAction', {}))
    .rejects.toThrow('System error: action nonExistentAction not found in the controller')
})

// --- afterware returning a response short-circuits ---

test('invoke: afterware returning a response stops further afterwares and returns early', async () => {
  const order: string[] = []
  class TestController extends ODController {
    get afterwares() {
      return [
        async (ctx: ODContext) => {
          order.push('afterware1')
          ctx.response.setError(403, 'Forbidden by afterware')
          return ctx.response
        },
        async () => { order.push('afterware2'); return undefined },
      ]
    }
    async doGet() { order.push('action'); return 'ok' }
  }
  const ctx = createContext({ controller: TestController })
  const controller = new TestController(ctx)
  const response = await controller.invoke('doGet', {})
  expect(response.code).toBe(403)
  expect(order).toEqual(['action', 'afterware1'])
})

// --- action returning undefined leaves response unchanged ---

test('invoke: action returning undefined does not change the context response', async () => {
  class TestController extends ODController {
    async doGet(): Promise<undefined> {
      return undefined
    }
  }
  const ctx = createContext({ controller: TestController })
  ctx.response.code = 201
  const controller = new TestController(ctx)
  const response = await controller.invoke('doGet', {})
  expect(response.code).toBe(201)
})

// --- corsOptions when OPTIONS is already in buildRoutes ---

test('corsOptions does not double-add OPTIONS when controller has explicit doOptions', async () => {
  class TestController extends ODController {
    async doGet() { return '' }
    async doOptions() { return '' }
  }
  const ctx = createContext({ controller: TestController, path: '/test' })
  const controller = new TestController(ctx)
  await controller.corsOptions()
  const allow = ctx.response.headers.find(h => h.name === 'Allow')
  expect(allow).toBeDefined()
  const optionCount = allow!.value.split(',').filter(m => m.trim() === 'OPTIONS').length
  expect(optionCount).toBe(1)
})

// --- buildRoutes: IndexController with named action suffix ---

test('buildRoutes: IndexController with doGetUsers maps to /users', () => {
  class IndexController extends ODController {
    async doGetUsers() { return '' }
  }
  Object.defineProperty(IndexController, 'name', { value: 'IndexController' })
  const routes = IndexController.buildRoutes()
  // path='/', m[3]='Users' -> separator is '' (path === '/') -> '/users'
  expect(routes).toContainEqual({ method: 'get', path: '/users', action: 'doGetUsers' })
})

// --- buildRoutes: warns with app ---

test('buildRoutes logs a warning (instead of throwing) when app is provided and no routes found', () => {
  class EmptyController extends ODController {}
  const app = new ODApp()
  const warnSpy = jest.spyOn(app.logger, 'warn').mockImplementation(() => {})
  const routes = EmptyController.buildRoutes(app)
  expect(routes).toHaveLength(0)
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('EmptyController'))
  warnSpy.mockRestore()
})
