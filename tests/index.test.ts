import {
  ODApp,
  ODAction,
  ODController,
  ODContext,
  ODRequest,
  ODResponse,
  ODRequestError,
  ODWebServer,
  ODHttp2WebServer,
  ODCommandLineInterface,
  defaultLogger,
  ODMemoryCache,
  ODHealthController,
  ODPrintRoutes,
  ODCORSMiddleware,
  ODJWTMiddleware,
  ODWithUser,
  ODObjectResolverMiddleware,
  ODRateLimitMiddleware,
  ODGlobalRateLimitMiddleware,
  ODSecurityHeadersMiddleware,
  ODEnvConfigProvider,
  sanitizeInput,
  isDangerousKey,
  serveStaticFiles,
  ODNotFoundController,
} from '../src/index'

describe('index exports', () => {
  // Core
  test('ODApp is exported as a class', () => expect(typeof ODApp).toBe('function'))
  test('ODAction is exported as a class', () => expect(typeof ODAction).toBe('function'))
  test('ODController is exported as a class', () => expect(typeof ODController).toBe('function'))
  test('ODContext is exported as a class', () => expect(typeof ODContext).toBe('function'))
  test('ODRequest is exported as a class', () => expect(typeof ODRequest).toBe('function'))
  test('ODResponse is exported as a class', () => expect(typeof ODResponse).toBe('function'))
  test('ODRequestError is exported as a class', () => expect(typeof ODRequestError).toBe('function'))
  test('ODNotFoundController is exported as a class', () => expect(typeof ODNotFoundController).toBe('function'))

  // Transport
  test('ODWebServer is exported as a class', () => expect(typeof ODWebServer).toBe('function'))
  test('ODHttp2WebServer is exported as a class', () => expect(typeof ODHttp2WebServer).toBe('function'))
  test('ODCommandLineInterface is exported as a class', () => expect(typeof ODCommandLineInterface).toBe('function'))

  // Logger
  test('defaultLogger is exported as an object', () => {
    expect(defaultLogger).toBeDefined()
    expect(typeof defaultLogger).toBe('object')
    expect(defaultLogger).not.toBeNull()
  })

  // Cache
  test('ODMemoryCache is exported as a class', () => expect(typeof ODMemoryCache).toBe('function'))

  // Built-in controllers
  test('ODHealthController is exported as a class', () => expect(typeof ODHealthController).toBe('function'))

  // Built-in actions
  test('ODPrintRoutes is exported as a class', () => expect(typeof ODPrintRoutes).toBe('function'))

  // Built-in middlewares
  test('ODCORSMiddleware is exported as a function', () => expect(typeof ODCORSMiddleware).toBe('function'))
  test('ODJWTMiddleware is exported as a function', () => expect(typeof ODJWTMiddleware).toBe('function'))
  test('ODWithUser is exported as a function', () => expect(typeof ODWithUser).toBe('function'))
  test('ODObjectResolverMiddleware is exported as a function', () => expect(typeof ODObjectResolverMiddleware).toBe('function'))
  test('ODRateLimitMiddleware is exported as a function', () => expect(typeof ODRateLimitMiddleware).toBe('function'))
  test('ODGlobalRateLimitMiddleware is exported as a function', () => expect(typeof ODGlobalRateLimitMiddleware).toBe('function'))
  test('ODSecurityHeadersMiddleware is exported as a function', () => expect(typeof ODSecurityHeadersMiddleware).toBe('function'))

  // Built-in providers
  test('ODEnvConfigProvider is exported as a class', () => expect(typeof ODEnvConfigProvider).toBe('function'))

  // Utils
  test('sanitizeInput is exported as a function', () => expect(typeof sanitizeInput).toBe('function'))
  test('isDangerousKey is exported as a function', () => expect(typeof isDangerousKey).toBe('function'))
  test('serveStaticFiles is exported as a function', () => expect(typeof serveStaticFiles).toBe('function'))
})
