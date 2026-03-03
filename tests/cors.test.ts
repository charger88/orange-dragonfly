import ODCORS from '../src/middlewares/cors-middleware'
import ODContext from '../src/core/context'
import ODRequest from '../src/core/request'
import ODResponse from '../src/core/response'
import ODApp from '../src/core/app'
import ODRoute from '../src/core/route'

const dummyRoute: ODRoute = { controller: {} as any, action: 'doGet', method: 'GET', path: '/' }

function createContext(method: string, headers: Record<string, string> = {}): ODContext {
  const app = new ODApp()
  const request = new ODRequest({ method, url: '/', headers })
  const response = new ODResponse()
  return new ODContext(app, request, response, { ...dummyRoute, method })
}

function getHeader(ctx: ODContext, name: string): string | undefined {
  const header = ctx.response.headers.find(h => h.name === name)
  return header?.value
}

function getHeaders(ctx: ODContext, name: string): string[] {
  return ctx.response.headers.filter(h => h.name === name).map(h => h.value)
}

// --- No Origin header (not a CORS request) ---

test('no Origin header: no CORS headers added', async () => {
  const cors = ODCORS({ origins: ['*'] })
  const ctx = createContext('GET')
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBeUndefined()
})

test('no Origin header with specific origins: no CORS headers', async () => {
  const cors = ODCORS({ origins: ['https://example.com'] })
  const ctx = createContext('GET')
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBeUndefined()
})

// --- Wildcard origin ---

test('wildcard origin: sets Access-Control-Allow-Origin to *', async () => {
  const cors = ODCORS({ origins: ['*'] })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBe('*')
})

test('wildcard origin: no Vary header', async () => {
  const cors = ODCORS({ origins: ['*'] })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Vary')).toBeUndefined()
})

// --- Default options (shorthand array) ---

test('default options: wildcard origin when no options provided', async () => {
  const cors = ODCORS()
  const ctx = createContext('GET', { origin: 'https://any-site.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBe('*')
})

// --- Specific origin ---

test('allowed origin: echoes origin and adds Vary', async () => {
  const cors = ODCORS({ origins: ['https://example.com'] })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBe('https://example.com')
  expect(getHeader(ctx, 'Vary')).toBe('Origin')
})

test('disallowed origin: no Access-Control-Allow-Origin, adds Vary, returns undefined', async () => {
  const cors = ODCORS({ origins: ['https://example.com'] })
  const ctx = createContext('GET', { origin: 'https://evil.com' })
  const result = await cors(ctx)
  expect(result).toBeUndefined()
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBeUndefined()
  expect(getHeader(ctx, 'Vary')).toBe('Origin')
})

test('multiple allowed origins: matches correctly', async () => {
  const cors = ODCORS({ origins: ['https://a.com', 'https://b.com'] })

  const ctx1 = createContext('GET', { origin: 'https://a.com' })
  await cors(ctx1)
  expect(getHeader(ctx1, 'Access-Control-Allow-Origin')).toBe('https://a.com')

  const ctx2 = createContext('GET', { origin: 'https://b.com' })
  await cors(ctx2)
  expect(getHeader(ctx2, 'Access-Control-Allow-Origin')).toBe('https://b.com')

  const ctx3 = createContext('GET', { origin: 'https://c.com' })
  await cors(ctx3)
  expect(getHeader(ctx3, 'Access-Control-Allow-Origin')).toBeUndefined()
})

// --- Wildcard subdomain matching ---

test('wildcard subdomain: *.example.com matches sub.example.com', async () => {
  const cors = ODCORS({ origins: ['https://*.example.com'] })

  const ctx1 = createContext('GET', { origin: 'https://sub.example.com' })
  await cors(ctx1)
  expect(getHeader(ctx1, 'Access-Control-Allow-Origin')).toBe('https://sub.example.com')
})

test('wildcard subdomain: does not match bare domain', async () => {
  const cors = ODCORS({ origins: ['https://*.example.com'] })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBeUndefined()
})

// --- Credentials ---

test('credentials: sets Access-Control-Allow-Credentials', async () => {
  const cors = ODCORS({ origins: ['https://example.com'], credentials: true })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Credentials')).toBe('true')
  // Must echo origin, not wildcard
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBe('https://example.com')
})

test('credentials with wildcard: throws at configuration time', () => {
  expect(() => ODCORS({ origins: ['*'], credentials: true })).toThrow(
    'credentials:true cannot be combined with origins:[\'*\']',
  )
})

test('no credentials by default', async () => {
  const cors = ODCORS({ origins: ['*'] })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Credentials')).toBeUndefined()
})

// --- Expose headers ---

test('exposeHeaders: sets Access-Control-Expose-Headers', async () => {
  const cors = ODCORS({ origins: ['*'], exposeHeaders: ['X-Request-Id', 'X-Total-Count'] })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Expose-Headers')).toBe('X-Request-Id, X-Total-Count')
})

test('no expose headers by default', async () => {
  const cors = ODCORS({ origins: ['*'] })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Expose-Headers')).toBeUndefined()
})

// --- Preflight (OPTIONS) ---

test('preflight: sets allow-headers on OPTIONS requests', async () => {
  const cors = ODCORS({ origins: ['*'], allowHeaders: ['Content-Type'] })
  const ctx = createContext('OPTIONS', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Headers')).toBe('Content-Type')
})

test('preflight: reflects requested headers when none configured', async () => {
  const cors = ODCORS({ origins: ['*'] })
  const ctx = createContext('OPTIONS', {
    origin: 'https://example.com',
    'access-control-request-headers': 'Content-Type, Authorization',
  })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Headers')).toBe('Content-Type, Authorization')
  expect(getHeader(ctx, 'Vary')).toContain('Access-Control-Request-Headers')
})

test('preflight: uses configured allowHeaders instead of reflecting', async () => {
  const cors = ODCORS({ origins: ['*'], allowHeaders: ['Content-Type', 'X-Custom'] })
  const ctx = createContext('OPTIONS', {
    origin: 'https://example.com',
    'access-control-request-headers': 'Authorization',
  })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Headers')).toBe('Content-Type, X-Custom')
})

test('preflight: maxAge sets Access-Control-Max-Age', async () => {
  const cors = ODCORS({ origins: ['*'], maxAge: 86400 })
  const ctx = createContext('OPTIONS', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Max-Age')).toBe('86400')
})

test('preflight: no maxAge by default', async () => {
  const cors = ODCORS({ origins: ['*'] })
  const ctx = createContext('OPTIONS', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Max-Age')).toBeUndefined()
})

// --- Non-preflight checks ---

test('GET request: no preflight headers and returns undefined', async () => {
  const cors = ODCORS({ origins: ['*'] })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  const result = await cors(ctx)
  expect(result).toBeUndefined()
  expect(getHeader(ctx, 'Access-Control-Allow-Headers')).toBeUndefined()
  expect(getHeader(ctx, 'Access-Control-Max-Age')).toBeUndefined()
})

// --- Full options object ---

test('full configuration: all options work together', async () => {
  const cors = ODCORS({
    origins: ['https://app.example.com'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['X-Request-Id'],
    credentials: true,
    maxAge: 3600,
  })

  const ctx = createContext('OPTIONS', {
    origin: 'https://app.example.com',
    'access-control-request-headers': 'Content-Type',
  })
  await cors(ctx)

  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBe('https://app.example.com')
  expect(getHeader(ctx, 'Access-Control-Allow-Credentials')).toBe('true')
  expect(getHeader(ctx, 'Access-Control-Allow-Headers')).toBe('Content-Type, Authorization')
  expect(getHeader(ctx, 'Access-Control-Expose-Headers')).toBe('X-Request-Id')
  expect(getHeader(ctx, 'Access-Control-Max-Age')).toBe('3600')
  expect(getHeader(ctx, 'Vary')).toBe('Origin')
})

// --- Disallowed origin on preflight ---

test('preflight with disallowed origin: no CORS headers, no 204', async () => {
  const cors = ODCORS({ origins: ['https://example.com'] })
  const ctx = createContext('OPTIONS', { origin: 'https://evil.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBeUndefined()
  expect(getHeader(ctx, 'Access-Control-Allow-Headers')).toBeUndefined()
  // Code should remain default (200)
  expect(ctx.response.code).toBe(200)
})

// --- rejectUnallowed ---

test('rejectUnallowed off: disallowed origin passes through with 200', async () => {
  const cors = ODCORS({ origins: ['https://example.com'] })
  const ctx = createContext('GET', { origin: 'https://evil.com' })
  await cors(ctx)
  expect(ctx.response.code).toBe(200)
  expect(ctx.response.content).toBe('')
})

test('rejectUnallowed on: disallowed origin gets 403 and returns response', async () => {
  const cors = ODCORS({ origins: ['https://example.com'], rejectUnallowed: true })
  const ctx = createContext('GET', { origin: 'https://evil.com' })
  const result = await cors(ctx)
  expect(result).toBe(ctx.response)
  expect(ctx.response.code).toBe(403)
  expect(ctx.response.content).toEqual({ error: 'Origin not allowed' })
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBeUndefined()
})

test('rejectUnallowed on: allowed origin proceeds normally', async () => {
  const cors = ODCORS({ origins: ['https://example.com'], rejectUnallowed: true })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  await cors(ctx)
  expect(ctx.response.code).toBe(200)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBe('https://example.com')
})

test('rejectUnallowed on: no Origin header still passes through', async () => {
  const cors = ODCORS({ origins: ['https://example.com'], rejectUnallowed: true })
  const ctx = createContext('GET')
  await cors(ctx)
  expect(ctx.response.code).toBe(200)
})

// --- appendVary deduplication ---

test('appendVary does not duplicate existing Vary values', async () => {
  const cors = ODCORS({ origins: ['https://example.com'] })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  // Pre-set a Vary header with the same value the middleware would add
  ctx.response.addHeader('Vary', 'Origin')
  await cors(ctx)
  // After the middleware, Vary should still be 'Origin' (no duplicate)
  const varyHeaders = ctx.response.headers.filter(h => h.name.toLowerCase() === 'vary')
  expect(varyHeaders).toHaveLength(1)
  expect(varyHeaders[0].value).toBe('Origin')
})

test('appendVary merges new values with existing ones', async () => {
  const cors = ODCORS({ origins: ['https://example.com'] })
  const ctx = createContext('OPTIONS', {
    origin: 'https://example.com',
    'access-control-request-headers': 'Authorization',
  })
  // Pre-set a Vary header with a different value
  ctx.response.addHeader('Vary', 'Accept')
  await cors(ctx)
  // After the middleware, Vary should contain both Accept and Origin (and possibly Access-Control-Request-Headers)
  const varyHeaders = ctx.response.headers.filter(h => h.name.toLowerCase() === 'vary')
  expect(varyHeaders).toHaveLength(1)
  expect(varyHeaders[0].value).toContain('Accept')
  expect(varyHeaders[0].value).toContain('Origin')
})

// --- Wildcard: ** (any subdomain depth) ---

test('double wildcard **.example.com matches single subdomain', async () => {
  const cors = ODCORS({ origins: ['https://**.example.com'] })
  const ctx = createContext('GET', { origin: 'https://sub.example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBe('https://sub.example.com')
})

test('double wildcard **.example.com matches multiple subdomain levels', async () => {
  const cors = ODCORS({ origins: ['https://**.example.com'] })
  const ctx = createContext('GET', { origin: 'https://a.b.example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBe('https://a.b.example.com')
})

test('double wildcard **.example.com does not match the bare domain', async () => {
  const cors = ODCORS({ origins: ['https://**.example.com'] })
  const ctx = createContext('GET', { origin: 'https://example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBeUndefined()
})

test('double wildcard **.example.com does not match a different domain', async () => {
  const cors = ODCORS({ origins: ['https://**.example.com'] })
  const ctx = createContext('GET', { origin: 'https://sub.other.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBeUndefined()
})

// --- Wildcard: *.* (exactly two subdomain levels) ---

test('double-star pattern *.*.example.com matches two subdomain levels', async () => {
  const cors = ODCORS({ origins: ['https://*.*.example.com'] })
  const ctx = createContext('GET', { origin: 'https://a.b.example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBe('https://a.b.example.com')
})

test('single * does not match two subdomain levels', async () => {
  const cors = ODCORS({ origins: ['https://*.example.com'] })
  const ctx = createContext('GET', { origin: 'https://a.b.example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBeUndefined()
})

test('*.*.example.com does not match single subdomain level', async () => {
  const cors = ODCORS({ origins: ['https://*.*.example.com'] })
  const ctx = createContext('GET', { origin: 'https://sub.example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBeUndefined()
})

test('*.*.example.com does not match wrong scheme', async () => {
  const cors = ODCORS({ origins: ['https://*.*.example.com'] })
  const ctx = createContext('GET', { origin: 'http://a.b.example.com' })
  await cors(ctx)
  expect(getHeader(ctx, 'Access-Control-Allow-Origin')).toBeUndefined()
})
