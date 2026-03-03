import path from 'path'
import ODApp from '../src/core/app'
import ODAction from '../src/core/action'
import ODController from '../src/core/controller'
import ODRequest from '../src/core/request'
import ODContext from '../src/core/context'
import { ODCache } from '../src/core/cache'
import * as fsHelpers from '../src/utils/fs-helpers'

// --- Construction ---

test('create returns ODApp instance', () => {
  const app = ODApp.create()
  expect(app).toBeInstanceOf(ODApp)
})

test('createResponse uses app responseOptions', async () => {
  const app = ODApp.create({ responseOptions: { compactJsonResponse: false } })
  const res = app.createResponse()
  res.content = { hello: 'world' }
  const [, body] = await res.convert()
  expect(body).not.toBe('{"hello":"world"}')
})

// --- Controller registration ---

test('useController registers a controller', async () => {
  class TestController extends ODController {
    async doGet() { return 'hello' }
  }
  const app = ODApp.create().useController(TestController)
  await app.init()
  const req = app.createRequest({ method: 'GET', url: '/test' })
  const res = await app.processRequest(req)
  expect(res.content).toBe('hello')
})

test('useController is chainable', () => {
  class A extends ODController { async doGet() { return '' } }
  class B extends ODController { async doGet() { return '' } }
  const app = ODApp.create()
  expect(app.useController(A).useController(B)).toBe(app)
})

test('use loads controllers/actions from a directory, sorts files, and skips declaration files', async () => {
  const exampleDir = path.resolve(process.cwd(), 'example')
  const readSpy = jest.spyOn(fsHelpers, 'readDirRecursively').mockReturnValue([
    path.join(exampleDir, 'controllers', 'users.ts'),
    path.join(exampleDir, 'skip-this.d.ts'),
    path.join(exampleDir, 'actions', 'generate-demo-token.ts'),
    path.join(exampleDir, 'services', 'presidents.ts'),
    path.join(exampleDir, 'controllers', 'private.ts'),
    path.join(exampleDir, 'skip-this-too.d.mts'),
  ])
  const app = ODApp.create()
  const controllerSpy = jest.spyOn(app, 'useController')
  const actionSpy = jest.spyOn(app, 'useAction')
  const warnSpy = jest.spyOn(app.logger, 'warn').mockImplementation(() => {})

  const result = await app.use(exampleDir)

  expect(result).toBe(app)
  expect(readSpy).toHaveBeenCalledWith(exampleDir, true, ['.ts', '.js', '.mts', '.mjs'], false)
  expect(controllerSpy.mock.calls.map(([Controller]) => Controller.name)).toEqual([
    'PrivateController',
    'UsersController',
  ])
  expect(actionSpy.mock.calls.map(([Action]) => Action.name)).toEqual(['GenerateDemoToken'])
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('presidents.ts'))

  const callOrder = [
    ...controllerSpy.mock.calls.map(([Controller], i) => ({
      order: controllerSpy.mock.invocationCallOrder[i],
      label: `controller:${Controller.name}`,
    })),
    ...actionSpy.mock.calls.map(([Action], i) => ({
      order: actionSpy.mock.invocationCallOrder[i],
      label: `action:${Action.name}`,
    })),
  ]
    .sort((a, b) => a.order - b.order)
    .map(entry => entry.label)

  expect(callOrder).toEqual([
    'action:GenerateDemoToken',
    'controller:PrivateController',
    'controller:UsersController',
  ])

  expect(Object.keys((app as unknown as { _actions: Record<string, typeof ODAction> })._actions)).toContain('generate-demo-token')
})

// --- Middleware ---

test('useMiddleware adds beforeware by default', () => {
  const app = ODApp.create()
  const mw = async () => undefined
  app.useMiddleware(mw)
  expect(app.beforewares).toContain(mw)
  expect(app.afterwares).not.toContain(mw)
})

test('useMiddleware adds afterware when runAfter is true', () => {
  const app = ODApp.create()
  const mw = async () => undefined
  app.useMiddleware(mw, true)
  expect(app.afterwares).toContain(mw)
  expect(app.beforewares).not.toContain(mw)
})

test('useMiddleware is chainable', () => {
  const app = ODApp.create()
  expect(app.useMiddleware(async () => undefined)).toBe(app)
})

// --- Lifecycle callbacks ---

test('onInit callback is called during init', async () => {
  let called = false
  const app = ODApp.create().onInit(async () => { called = true })
  await app.init()
  expect(called).toBe(true)
})

test('onInit receives app instance', async () => {
  let receivedApp: ODApp | null = null
  const app = ODApp.create().onInit(async (a) => { receivedApp = a })
  await app.init()
  expect(receivedApp).toBe(app)
})

test('onUnload callback is called during unload', async () => {
  let called = false
  const app = ODApp.create().onUnload(async () => { called = true })
  await app.unload()
  expect(called).toBe(true)
})

test('onRequestStarted receives context', async () => {
  let receivedContext: ODContext | undefined
  class TestController extends ODController {
    async doGet() { return 'ok' }
  }
  const app = ODApp.create()
    .useController(TestController)
    .onRequestStarted(async (ctx) => { receivedContext = ctx })
  await app.init()
  await app.processRequest(app.createRequest({ method: 'GET', url: '/test' }))
  expect(receivedContext).toBeDefined()
  expect(receivedContext!.request.path).toBe('/test')
})

test('onRequestCompleted receives context', async () => {
  let receivedContext: ODContext | undefined
  class TestController extends ODController {
    async doGet() { return 'ok' }
  }
  const app = ODApp.create()
    .useController(TestController)
    .onRequestCompleted(async (ctx) => { receivedContext = ctx })
  await app.init()
  await app.processRequest(app.createRequest({ method: 'GET', url: '/test' }))
  expect(receivedContext).toBeDefined()
})

test('onRequestCompleted is called even when action throws', async () => {
  let completed = false
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
  class TestController extends ODController {
    async doGet() { throw new Error('boom') }
  }
  const app = ODApp.create({ logger: { error: console.error, warn: console.warn, info: console.info } })
    .useController(TestController)
    .onRequestCompleted(async () => { completed = true })
  await app.init()
  await app.processRequest(app.createRequest({ method: 'GET', url: '/test' }))
  expect(completed).toBe(true)
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    'Controller invocation failed',
    expect.objectContaining({ message: 'boom' }),
  )
  consoleErrorSpy.mockRestore()
})

test('lifecycle setters are chainable', () => {
  const app = ODApp.create()
  const cb = async () => {}
  expect(app.onInit(cb)).toBe(app)
  expect(app.onUnload(cb)).toBe(app)
  expect(app.onRequestStarted(cb)).toBe(app)
  expect(app.onRequestCompleted(cb)).toBe(app)
})

// --- Routing ---

test('unmatched route returns 404', async () => {
  class TestController extends ODController {
    async doGet() { return 'hello' }
  }
  const app = ODApp.create().useController(TestController)
  await app.init()
  const res = await app.processRequest(app.createRequest({ method: 'GET', url: '/nonexistent' }))
  expect(res.code).toBe(404)
})

test('OPTIONS route is auto-registered', async () => {
  class TestController extends ODController {
    async doGet() { return 'hello' }
  }
  const app = ODApp.create().useController(TestController)
  await app.init()
  const res = await app.processRequest(app.createRequest({ method: 'OPTIONS', url: '/test' }))
  expect(res.code).toBe(204)
  const allow = res.headers.find(h => h.name === 'Allow')
  expect(allow).toBeDefined()
})

test('custom absolute route path supports greedy {+proxy} params for catch-all-style handlers', async () => {
  class StaticController extends ODController {
    static get pathGet() { return '/static/{+proxy}' }
    async doGet(params: { proxy: string }) {
      return { proxy: params.proxy }
    }
  }
  const app = ODApp.create().useController(StaticController)
  await app.init()
  const res = await app.processRequest(app.createRequest({ method: 'GET', url: '/static/assets/css/app.css' }))
  expect(res.code).toBe(200)
  expect(res.content).toEqual({ proxy: 'assets/css/app.css' })
})

test('init() throws when two controllers register the same path, even for different methods', async () => {
  class UsersGetController extends ODController {
    static get path() { return '/users' }
    async doGet() { return 'get' }
  }
  class UsersPostController extends ODController {
    static get path() { return '/users' }
    async doPost() { return 'post' }
  }
  const app = ODApp.create()
    .useController(UsersGetController)
    .useController(UsersPostController)
  await expect(app.init()).rejects.toThrow('Route registration error: path "/users" is already owned by')
})

test('non-proxy routes can coexist with a covering {+proxy} route in another controller', async () => {
  class StaticController extends ODController {
    static get pathGet() { return '/static/{+proxy}' }
    async doGet(params: { proxy: string }) {
      return { proxy: params.proxy }
    }
  }
  class AppCssController extends ODController {
    static get path() { return '/static/app.css' }
    async doGet() { return 'asset' }
  }
  const app = ODApp.create()
    .useController(StaticController)
    .useController(AppCssController)
  await app.init()

  const exactRes = await app.processRequest(app.createRequest({ method: 'GET', url: '/static/app.css' }))
  expect(exactRes.content).toBe('asset')

  const proxyRes = await app.processRequest(app.createRequest({ method: 'GET', url: '/static/assets/css/app.css' }))
  expect(proxyRes.content).toEqual({ proxy: 'assets/css/app.css' })
})

// --- Error handling ---

test('processRequest catches controller errors and returns 500', async () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
  class TestController extends ODController {
    async doGet() { return 'ok' }
  }
  const invokeSpy = jest.spyOn(TestController.prototype, 'invoke').mockRejectedValue(new Error('fatal'))
  const app = ODApp.create({ logger: { error: console.error, warn: console.warn, info: console.info } })
    .useController(TestController)
  await app.init()
  const res = await app.processRequest(app.createRequest({ method: 'GET', url: '/test' }))
  expect(res.code).toBe(500)
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    'Controller invocation failed',
    expect.objectContaining({ message: 'fatal' }),
  )
  invokeSpy.mockRestore()
  consoleErrorSpy.mockRestore()
})

// --- _assertAction ---

test('_assertAction throws for missing action', async () => {
  class TestController extends ODController {
    async doGet() { return '' }
  }
  // Manually try to register a route with a non-existent action
  // We test this indirectly by checking buildRoutes produces valid routes
  const routes = TestController.buildRoutes()
  for (const route of routes) {
    expect(typeof TestController.prototype[route.action as keyof typeof TestController.prototype]).toBe('function')
  }
})

// --- router getter ---

test('router is accessible', () => {
  const app = ODApp.create()
  expect(app.router).toBeDefined()
})

test('responseOptions getter is accessible', () => {
  const app = ODApp.create({ responseOptions: { compactJsonResponse: true } })
  expect(app.responseOptions.compactJsonResponse).toBe(true)
})

test('cache getter exposes default or custom cache', () => {
  const app = ODApp.create()
  expect(app.cache).toBeDefined()

  const custom: ODCache = {
    get: async() => null,
    set: async() => undefined,
    delete: async() => undefined,
    increment: async() => 1,
  }
  const withCustom = ODApp.create({ cache: custom })
  expect(withCustom.cache).toBe(custom)
})

// --- Beforeware/afterware ordering ---

test('app-level beforewares run before controller beforewares', async () => {
  const order: string[] = []
  class TestController extends ODController {
    get beforewares() {
      return [async () => { order.push('controller-before'); return undefined }]
    }
    async doGet() { order.push('action'); return '' }
  }
  const app = ODApp.create()
    .useController(TestController)
    .useMiddleware(async () => { order.push('app-before'); return undefined })
  await app.init()
  await app.processRequest(app.createRequest({ method: 'GET', url: '/test' }))
  expect(order).toEqual(['app-before', 'controller-before', 'action'])
})

test('controller afterwares run before app-level afterwares', async () => {
  const order: string[] = []
  class TestController extends ODController {
    get afterwares() {
      return [async () => { order.push('controller-after'); return undefined }]
    }
    async doGet() { order.push('action'); return '' }
  }
  const app = ODApp.create()
    .useController(TestController)
    .useMiddleware(async () => { order.push('app-after'); return undefined }, true)
  await app.init()
  await app.processRequest(app.createRequest({ method: 'GET', url: '/test' }))
  expect(order).toEqual(['action', 'controller-after', 'app-after'])
})

test('route params are coerced to numbers when numeric', async () => {
  class TestController extends ODController {
    async doGetId(params: { id: number }) {
      return { id: params.id, kind: typeof params.id }
    }
  }
  const app = ODApp.create().useController(TestController)
  await app.init()
  const res = await app.processRequest(app.createRequest({ method: 'GET', url: '/test/42' }))
  expect(res.code).toBe(200)
  expect(res.content).toEqual({ id: 42, kind: 'number' })
})

test('route params stay strings when not numeric', async () => {
  class SlugController extends ODController {
    static get idParameterName() { return 'slug' }
    async doGetId(params: { slug: string }) {
      return { slug: params.slug, kind: typeof params.slug }
    }
  }
  const app = ODApp.create().useController(SlugController)
  await app.init()
  const res = await app.processRequest(app.createRequest({ method: 'GET', url: '/slug/abc' }))
  expect(res.code).toBe(200)
  expect(res.content).toEqual({ slug: 'abc', kind: 'string' })
})

// --- Invalid JSON -> 400 ---

test('invalid JSON body returns 400', async () => {
  class TestController extends ODController {
    async doPost() {
      return this.context.request.body
    }
  }
  const app = ODApp.create().useController(TestController)
  await app.init()
  const req = app.createRequest({ method: 'POST', url: '/test', headers: { 'content-type': 'application/json' }, body: 'not json' })
  const res = await app.processRequest(req)
  expect(res.code).toBe(400)
})

// --- Custom ODErrorHandler ---

test('custom errorHandler is used for 404', async () => {
  class CustomNotFound extends ODController {
    async e404() {
      return this.setError(404, 'Custom not found')
    }
  }
  const app = ODApp.create({ notFoundController: CustomNotFound })
  await app.init()
  const res = await app.processRequest(app.createRequest({ method: 'GET', url: '/nonexistent' }))
  expect(res.code).toBe(404)
  expect((res.content as Record<string, unknown>).error).toBe('Custom not found')
})

test('invalid JSON body error message is descriptive', async () => {
  class TestController extends ODController {
    async doPost() {
      return this.context.request.body
    }
  }
  const app = ODApp.create().useController(TestController)
  await app.init()
  const req = app.createRequest({ method: 'POST', url: '/test', headers: { 'content-type': 'application/json' }, body: '{bad' })
  const res = await app.processRequest(req)
  expect(res.code).toBe(400)
  expect((res.content as Record<string, unknown>).error).toBe('Invalid JSON body')
})

test('app-level beforewares run before routing, so they can block 404 requests too', async () => {
  // App-level beforewares run before routing resolves.
  // A blocking middleware returns its response even for routes that don't exist.
  const blockingMiddleware = async () => { return { code: 401, content: 'blocked', headers: [] } as any }
  class TestController extends ODController {
    async doGet() { return 'ok' }
  }
  const app = ODApp.create()
    .useController(TestController)
    .useMiddleware(blockingMiddleware)
  await app.init()
  // Nonexistent route - beforeware runs first and short-circuits with 401
  const res = await app.processRequest(app.createRequest({ method: 'GET', url: '/nonexistent' }))
  expect(res.code).toBe(401)
})

test('app-level afterwares run even when a 404 occurs', async () => {
  let afterwareRan = false
  class TestController extends ODController {
    async doGet() { return 'ok' }
  }
  const app = ODApp.create()
    .useController(TestController)
    .useMiddleware(async () => { afterwareRan = true; return undefined }, true)
  await app.init()
  const res = await app.processRequest(app.createRequest({ method: 'GET', url: '/nonexistent' }))
  expect(res.code).toBe(404)
  expect(afterwareRan).toBe(true)
})

test('app-level afterwares don\'t run when controller throws', async () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
  let afterwareRan = false
  class TestController extends ODController {
    async doGet() { throw new Error('boom') }
  }
  const app = ODApp.create({ logger: { error: console.error, warn: console.warn, info: console.info } })
    .useController(TestController)
    .useMiddleware(async () => { afterwareRan = true; return undefined }, true)
  await app.init()
  await app.processRequest(app.createRequest({ method: 'GET', url: '/test' }))
  expect(afterwareRan).toBe(false)
  consoleErrorSpy.mockRestore()
})

// --- Trusted proxy ---

test('trustedProxy uses X-Forwarded-For when connecting IP matches', async () => {
  class IpController extends ODController {
    async doGet() { return { ip: this.context.request.ip } }
  }
  const app = ODApp.create({ trustedProxy: ['10.0.0.1'] }).useController(IpController)
  await app.init()
  const req = app.createRequest({
    method: 'GET', url: '/ip',
    headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    ip: '10.0.0.1',
  })
  const res = await app.processRequest(req)
  expect((res.content as Record<string, unknown>).ip).toBe('203.0.113.5')
})

test('trustedProxy handles IPv4-mapped IPv6 connecting address (::ffff:x.x.x.x)', async () => {
  class IpController extends ODController {
    async doGet() { return { ip: this.context.request.ip } }
  }
  const app = ODApp.create({ trustedProxy: ['127.0.0.1'] }).useController(IpController)
  await app.init()
  const req = app.createRequest({
    method: 'GET', url: '/ip',
    headers: { 'x-forwarded-for': '203.0.113.7' },
    ip: '::ffff:127.0.0.1',
  })
  const res = await app.processRequest(req)
  expect((res.content as Record<string, unknown>).ip).toBe('203.0.113.7')
})

test('trustedProxy does not use X-Forwarded-For when IP is not trusted', async () => {
  class IpController extends ODController {
    async doGet() { return { ip: this.context.request.ip } }
  }
  const app = ODApp.create({ trustedProxy: ['10.0.0.1'] }).useController(IpController)
  await app.init()
  const req = app.createRequest({
    method: 'GET', url: '/ip',
    headers: { 'x-forwarded-for': '203.0.113.5' },
    ip: '192.168.1.100',
  })
  const res = await app.processRequest(req)
  expect((res.content as Record<string, unknown>).ip).toBe('192.168.1.100')
})

// --- Lifecycle null-setters ---

test('onInit(null) clears all init callbacks', async () => {
  let called = false
  const app = ODApp.create().onInit(async () => { called = true })
  app.onInit(null)
  await app.init()
  expect(called).toBe(false)
})

test('onRequestStarted(null) clears all requestStarted callbacks', async () => {
  let called = false
  class TestController extends ODController { async doGet() { return 'ok' } }
  const app = ODApp.create().useController(TestController)
    .onRequestStarted(async () => { called = true })
  app.onRequestStarted(null)
  await app.init()
  await app.processRequest(app.createRequest({ method: 'GET', url: '/test' }))
  expect(called).toBe(false)
})

test('onRequestCompleted(null) clears all requestCompleted callbacks', async () => {
  let called = false
  class TestController extends ODController { async doGet() { return 'ok' } }
  const app = ODApp.create().useController(TestController)
    .onRequestCompleted(async () => { called = true })
  app.onRequestCompleted(null)
  await app.init()
  await app.processRequest(app.createRequest({ method: 'GET', url: '/test' }))
  expect(called).toBe(false)
})

test('onUnload(null) clears all unload callbacks', async () => {
  let called = false
  const app = ODApp.create().onUnload(async () => { called = true })
  app.onUnload(null)
  await app.unload()
  expect(called).toBe(false)
})

// --- Explicit OPTIONS route (prevents auto-registration) ---

test('explicit doOptions handler overrides auto-generated corsOptions', async () => {
  class TestController extends ODController {
    async doGet() { return 'hello' }
    async doOptions() { return 'explicit-options-response' }
  }
  const app = ODApp.create().useController(TestController)
  await app.init()
  const res = await app.processRequest(app.createRequest({ method: 'OPTIONS', url: '/test' }))
  expect(res.content).toBe('explicit-options-response')
})

// --- _assertAction throws ---

test('init() throws when a registered route references a non-existent action', async () => {
  class BadController extends ODController {
    async doGet() { return 'ok' }
    static buildRoutes() {
      return [{ method: 'get', path: '/bad', action: 'nonExistentMethod' }]
    }
  }
  const app = ODApp.create().useController(BadController)
  await expect(app.init()).rejects.toThrow('Route registration error: action "nonExistentMethod" not found')
})

// --- processErrorRequest ---

function createErrorContext(app: ODApp, req: ODRequest): ODContext {
  return new ODContext(app, req, app.createResponse(), {
    controller: ODController,
    action: 'e500',
    method: 'GET',
    path: req.path,
  })
}

test('processErrorRequest returns the provided 5xx status code', async () => {
  const app = ODApp.create()
  const req = app.createRequest({ method: 'GET', url: '/test' })
  const ctx = createErrorContext(app, req)
  // Access protected method via casting
  const res = await (app as any).processErrorRequest(ctx, 503, 'Service Unavailable')
  expect(res.code).toBe(503)
  expect((res.content as Record<string, unknown>).error).toBe('Service Unavailable')
})

test('processErrorRequest returns generic error for 4xx without a specific handler', async () => {
  const app = ODApp.create()
  const req = app.createRequest({ method: 'GET', url: '/test' })
  const ctx = createErrorContext(app, req)
  const res = await (app as any).processErrorRequest(ctx, 402, 'Payment Required')
  expect(res.code).toBe(402)
  expect((res.content as Record<string, unknown>).error).toBe('Payment Required')
})

// --- onRequestCompleted callback that throws ---

test('onRequestCompleted callback throwing is caught and logged', async () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
  class TestController extends ODController { async doGet() { return 'ok' } }
  const app = ODApp.create({ logger: { error: console.error, warn: console.warn, info: console.info } })
    .useController(TestController)
    .onRequestCompleted(async () => { throw new Error('callback failed') })
  await app.init()
  // Should NOT throw - the error is logged and swallowed
  const res = await app.processRequest(app.createRequest({ method: 'GET', url: '/test' }))
  expect(res.code).toBe(200)
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    'Request completion callback failed',
    expect.any(Error),
  )
  consoleErrorSpy.mockRestore()
})

// --- queryParser getter ---

test('queryParser getter returns the configured MagicQueryParser instance', () => {
  const app = ODApp.create({ queryParser: { integerParameters: ['id'] } })
  expect(app.queryParser).not.toBeNull()
})

test('queryParser getter returns null when no queryParser option is set', () => {
  const app = ODApp.create()
  expect(app.queryParser).toBeNull()
})

// --- normalizeIp: ::ffff: prefix with non-IPv4 suffix ---

test('normalizeIp leaves ::ffff:abc unchanged (non-IPv4 after ::ffff:)', async () => {
  class IpController extends ODController {
    async doGet() { return { ip: this.context.request.ip } }
  }
  // The connecting IP has ::ffff: prefix but the suffix is NOT a valid IPv4 address.
  // normalizeIp should return it unchanged (the else-fall-through path).
  const app = ODApp.create({ trustedProxy: ['::ffff:abc'] }).useController(IpController)
  await app.init()
  const req = app.createRequest({
    method: 'GET', url: '/ip',
    headers: { 'x-forwarded-for': '10.0.0.1' },
    ip: '::ffff:abc',
  })
  const res = await app.processRequest(req)
  // normalizeIp('::ffff:abc') returns '::ffff:abc' (non-IPv4), which matches the trustedProxy entry
  expect((res.content as Record<string, unknown>).ip).toBe('10.0.0.1')
})

// --- processErrorRequest with no message (triggers message ?? 'Error' fallback) ---

test('processErrorRequest uses "Error" fallback when no message is provided', async () => {
  const app = ODApp.create()
  const req = app.createRequest({ method: 'GET', url: '/test' })
  const ctx = createErrorContext(app, req)
  const res = await (app as any).processErrorRequest(ctx, 418)  // no message -> 'Error' fallback
  expect(res.code).toBe(418)
  expect((res.content as Record<string, unknown>).error).toBe('Error')
})

// --- trustedProxy: matching IP but no x-forwarded-for header ---

test('trustedProxy: matching IP with no x-forwarded-for header leaves ip unchanged', async () => {
  class IpController extends ODController {
    async doGet() { return { ip: this.context.request.ip } }
  }
  const app = ODApp.create({ trustedProxy: ['10.0.0.1'] }).useController(IpController)
  await app.init()
  // No x-forwarded-for header, so forwarded is undefined -> if (forwarded) false branch
  const req = app.createRequest({ method: 'GET', url: '/ip', ip: '10.0.0.1' })
  const res = await app.processRequest(req)
  expect((res.content as Record<string, unknown>).ip).toBe('10.0.0.1')
})

// --- trustedProxy: x-forwarded-for present but realIp is empty ---

test('trustedProxy: empty realIp in x-forwarded-for does not change ip', async () => {
  class IpController extends ODController {
    async doGet() { return { ip: this.context.request.ip } }
  }
  const app = ODApp.create({ trustedProxy: ['10.0.0.1'] }).useController(IpController)
  await app.init()
  // x-forwarded-for header is present but the first entry is blank
  const req = app.createRequest({
    method: 'GET', url: '/ip',
    headers: { 'x-forwarded-for': '   ' },  // trim -> empty string -> if (realIp) is false
    ip: '10.0.0.1',
  })
  const res = await app.processRequest(req)
  expect((res.content as Record<string, unknown>).ip).toBe('10.0.0.1')
})

// --- queryParser passed to request ---

test('queryParser from app options is applied to requests', async () => {
  class TestController extends ODController {
    async doGet() { return { id: this.context.request.getQueryParam('id') } }
  }
  const app = ODApp.create({ queryParser: { integerParameters: ['id'] } })
    .useController(TestController)
  await app.init()
  const res = await app.processRequest(app.createRequest({ method: 'GET', url: '/test?id=42' }))
  expect((res.content as Record<string, unknown>).id).toBe(42)
})
