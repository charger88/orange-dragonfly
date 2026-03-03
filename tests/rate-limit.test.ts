import ODApp from '../src/core/app'
import ODContext from '../src/core/context'
import ODController from '../src/core/controller'
import ODRequest from '../src/core/request'
import ODResponse from '../src/core/response'
import { ODCache } from '../src/core/cache'
import ODRateLimitMiddleware, { ODGlobalRateLimitMiddleware } from '../src/middlewares/rate-limit'

class UsersController extends ODController {}

function createContext(app: ODApp, action: string, ip: string = '127.0.0.1'): ODContext {
  const request = new ODRequest({ method: 'GET', url: '/users', ip })
  const response = new ODResponse()
  return new ODContext(app, request, response, {
    controller: UsersController,
    action,
    method: 'GET',
    path: '/users',
  })
}

test('global rate limit blocks requests after limit', async() => {
  const app = new ODApp()
  const middleware = ODGlobalRateLimitMiddleware(2, 60)

  const ctx1 = createContext(app, 'doGet')
  const ctx2 = createContext(app, 'doGet')
  const ctx3 = createContext(app, 'doGet')

  expect(await middleware(ctx1)).toBeUndefined()
  expect(await middleware(ctx2)).toBeUndefined()

  const blocked = await middleware(ctx3)
  expect(blocked).toBe(ctx3.response)
  expect(ctx3.response.code).toBe(429)
  expect((ctx3.response.content as Record<string, unknown>).method).toBe('GET')
  expect((ctx3.response.content as Record<string, unknown>).path).toBe('/users')
})

test('controller and action limits are evaluated independently', async() => {
  const app = new ODApp()
  const middleware = ODRateLimitMiddleware({
    controllers: { UsersController: { limit: 1, windowSeconds: 60 } },
    actions: { 'UsersController.doGet': { limit: 2, windowSeconds: 60 } },
  })

  const first = createContext(app, 'doGet')
  expect(await middleware(first)).toBeUndefined()

  const second = createContext(app, 'doGet')
  const blocked = await middleware(second)
  expect(blocked).toBe(second.response)
  expect(second.response.code).toBe(429)
  expect((second.response.content as Record<string, unknown>).method).toBe('GET')
  expect((second.response.content as Record<string, unknown>).path).toBe('/users')
})

test('rules are tracked per IP', async() => {
  const app = new ODApp()
  const middleware = ODGlobalRateLimitMiddleware(1, 60)

  const a = createContext(app, 'doGet', '10.0.0.1')
  const b = createContext(app, 'doGet', '10.0.0.2')
  const a2 = createContext(app, 'doGet', '10.0.0.1')

  expect(await middleware(a)).toBeUndefined()
  expect(await middleware(b)).toBeUndefined()
  expect((await middleware(a2))?.code).toBe(429)
})

test('throws for non-positive limit', () => {
  expect(() => ODRateLimitMiddleware({ global: { limit: 0, windowSeconds: 60 } }))
    .toThrow('global.limit must be a positive integer')
})

test('throws for non-integer limit', () => {
  expect(() => ODRateLimitMiddleware({ global: { limit: 1.5, windowSeconds: 60 } }))
    .toThrow('global.limit must be a positive integer')
})

test('throws for non-positive windowSeconds', () => {
  expect(() => ODRateLimitMiddleware({ global: { limit: 10, windowSeconds: 0 } }))
    .toThrow('global.windowSeconds must be a positive finite number')
})

test('throws for non-finite windowSeconds', () => {
  expect(() => ODRateLimitMiddleware({ global: { limit: 10, windowSeconds: Number.NaN } }))
    .toThrow('global.windowSeconds must be a positive finite number')
  expect(() => ODRateLimitMiddleware({ global: { limit: 10, windowSeconds: Number.POSITIVE_INFINITY } }))
    .toThrow('global.windowSeconds must be a positive finite number')
})

test('throws for windowSeconds shorter than one millisecond', () => {
  expect(() => ODRateLimitMiddleware({ global: { limit: 10, windowSeconds: 0.0001 } }))
    .toThrow('global.windowSeconds must be at least 0.001 seconds')
})

test('throws for invalid controller rule', () => {
  expect(() => ODRateLimitMiddleware({ controllers: { UsersController: { limit: -1, windowSeconds: 60 } } }))
    .toThrow('controllers.UsersController.limit must be a positive integer')
})

test('middleware uses app cache implementation', async() => {
  const fakeCache: ODCache = {
    get: jest.fn(async() => null),
    set: jest.fn(async() => undefined),
    delete: jest.fn(async() => undefined),
    increment: jest.fn(async() => 1),
  }
  const app = new ODApp({ cache: fakeCache })
  const middleware = ODGlobalRateLimitMiddleware(10, 60)
  const ctx = createContext(app, 'doGet')
  await middleware(ctx)
  expect(fakeCache.increment).toHaveBeenCalled()
})

test('skips rate limiting when cache.increment returns null (cache full)', async() => {
  const fakeCache: ODCache = {
    get: jest.fn(async() => null),
    set: jest.fn(async() => undefined),
    delete: jest.fn(async() => undefined),
    increment: jest.fn(async() => null),
  }
  const app = new ODApp({ cache: fakeCache })
  // limit=1 but increment returns null -> request should pass through
  const middleware = ODGlobalRateLimitMiddleware(1, 60)
  const ctx = createContext(app, 'doGet')
  const result = await middleware(ctx)
  expect(result).toBeUndefined()
})

test('IPv6 address colons are replaced with dashes in the cache key', async() => {
  const fakeCache: ODCache = {
    get: jest.fn(async() => null),
    set: jest.fn(async() => undefined),
    delete: jest.fn(async() => undefined),
    increment: jest.fn(async() => 1),
  }
  const app = new ODApp({ cache: fakeCache })
  const middleware = ODGlobalRateLimitMiddleware(10, 60)
  const ctx = createContext(app, 'doGet', '2001:db8::1')
  await middleware(ctx)
  const [cacheKey] = (fakeCache.increment as jest.Mock).mock.calls[0]
  // The IP portion should have colons replaced by dashes
  expect(cacheKey).toContain('2001-db8--1')
  // The original IPv6 IP address should not appear verbatim in the key
  expect(cacheKey).not.toContain('2001:db8::1')
})

test('worst-case headers reflect the most restrictive rule across multiple rules', async() => {
  // Two rules: global (limit=10) and controller (limit=2). After 2 requests the controller
  // rule will have remaining=0 while global still has remaining=8. Headers must show remaining=0.
  const app = new ODApp()
  const middleware = ODRateLimitMiddleware({
    global: { limit: 10, windowSeconds: 60 },
    controllers: { UsersController: { limit: 2, windowSeconds: 60 } },
  })

  const ctx1 = createContext(app, 'doGet')
  await middleware(ctx1)
  const ctx2 = createContext(app, 'doGet')
  await middleware(ctx2)

  // Both limits applied; remaining for controller = max(0, 2-2) = 0
  const remaining = ctx2.response.headers.find(h => h.name === 'X-RateLimit-Remaining')
  expect(remaining?.value).toBe('0')
  // X-RateLimit-Limit should be the limit of the most restrictive rule (controller = 2)
  const limit = ctx2.response.headers.find(h => h.name === 'X-RateLimit-Limit')
  expect(limit?.value).toBe('2')
})

test('Retry-After reflects the longest blocking window across exceeded rules', async() => {
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0)
  try {
    const app = new ODApp()
    const middleware = ODRateLimitMiddleware({
      global: { limit: 1, windowSeconds: 3600 },
      actions: { 'UsersController.doGet': { limit: 1, windowSeconds: 60 } },
    })

    expect(await middleware(createContext(app, 'doGet'))).toBeUndefined()

    const blockedContext = createContext(app, 'doGet')
    const blocked = await middleware(blockedContext)
    expect(blocked).toBe(blockedContext.response)

    const retryAfterHeader = blockedContext.response.headers.find(h => h.name === 'Retry-After')
    expect(retryAfterHeader?.value).toBe('3600')
    expect(blockedContext.response.code).toBe(429)
    expect((blockedContext.response.content as Record<string, unknown>).retryAfter).toBe(3600)
    expect((blockedContext.response.content as Record<string, unknown>).windowSeconds).toBe(3600)
  } finally {
    nowSpy.mockRestore()
  }
})

test('X-RateLimit-Reset uses the later reset when remaining ties', async() => {
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0)
  try {
    const app = new ODApp()
    const middleware = ODRateLimitMiddleware({
      global: { limit: 1, windowSeconds: 60 },
      actions: { 'UsersController.doGet': { limit: 1, windowSeconds: 3600 } },
    })

    expect(await middleware(createContext(app, 'doGet'))).toBeUndefined()

    const blockedContext = createContext(app, 'doGet')
    const blocked = await middleware(blockedContext)
    expect(blocked).toBe(blockedContext.response)

    const resetHeader = blockedContext.response.headers.find(h => h.name === 'X-RateLimit-Reset')
    expect(resetHeader?.value).toBe('3600')

    const retryAfterHeader = blockedContext.response.headers.find(h => h.name === 'Retry-After')
    expect(retryAfterHeader?.value).toBe('3600')
  } finally {
    nowSpy.mockRestore()
  }
})
