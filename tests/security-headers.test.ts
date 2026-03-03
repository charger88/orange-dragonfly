import ODSecurityHeadersMiddleware from '../src/middlewares/security-headers-middleware'
import ODContext from '../src/core/context'
import ODRequest from '../src/core/request'
import ODResponse from '../src/core/response'
import ODApp from '../src/core/app'
import ODRoute from '../src/core/route'

const dummyRoute: ODRoute = { controller: {} as any, action: 'doGet', method: 'GET', path: '/' }

function createContext(): ODContext {
  const app = new ODApp()
  const request = new ODRequest({ method: 'GET', url: '/' })
  const response = new ODResponse()
  return new ODContext(app, request, response, dummyRoute)
}

function getHeader(ctx: ODContext, name: string): string | undefined {
  return ctx.response.headers.find(h => h.name === name)?.value
}

// ---------------------------------------------------------------------------

test('adds X-Content-Type-Options: nosniff by default', async () => {
  const mw = ODSecurityHeadersMiddleware()
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'X-Content-Type-Options')).toBe('nosniff')
})

test('adds X-Content-Type-Options when explicitly set to "nosniff"', async () => {
  const mw = ODSecurityHeadersMiddleware({ contentTypeOptions: 'nosniff' })
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'X-Content-Type-Options')).toBe('nosniff')
})

test('omits X-Content-Type-Options when set to false', async () => {
  const mw = ODSecurityHeadersMiddleware({ contentTypeOptions: false })
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'X-Content-Type-Options')).toBeUndefined()
})

test('adds X-Frame-Options when configured', async () => {
  const mw = ODSecurityHeadersMiddleware({ frameOptions: 'DENY' })
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'X-Frame-Options')).toBe('DENY')
})

test('omits X-Frame-Options by default', async () => {
  const mw = ODSecurityHeadersMiddleware()
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'X-Frame-Options')).toBeUndefined()
})

test('adds Content-Security-Policy when configured', async () => {
  const policy = "default-src 'self'"
  const mw = ODSecurityHeadersMiddleware({ contentSecurityPolicy: policy })
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'Content-Security-Policy')).toBe(policy)
})

test('omits Content-Security-Policy by default', async () => {
  const mw = ODSecurityHeadersMiddleware()
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'Content-Security-Policy')).toBeUndefined()
})

test('adds Referrer-Policy when configured', async () => {
  const mw = ODSecurityHeadersMiddleware({ referrerPolicy: 'strict-origin-when-cross-origin' })
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin')
})

test('adds Permissions-Policy when configured', async () => {
  const mw = ODSecurityHeadersMiddleware({ permissionsPolicy: 'camera=(), microphone=()' })
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'Permissions-Policy')).toBe('camera=(), microphone=()')
})

test('adds Cross-Origin-Opener-Policy when configured', async () => {
  const mw = ODSecurityHeadersMiddleware({ crossOriginOpenerPolicy: 'same-origin' })
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'Cross-Origin-Opener-Policy')).toBe('same-origin')
})

test('adds Cross-Origin-Embedder-Policy when configured', async () => {
  const mw = ODSecurityHeadersMiddleware({ crossOriginEmbedderPolicy: 'require-corp' })
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'Cross-Origin-Embedder-Policy')).toBe('require-corp')
})

test('adds Cross-Origin-Resource-Policy when configured', async () => {
  const mw = ODSecurityHeadersMiddleware({ crossOriginResourcePolicy: 'same-origin' })
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'Cross-Origin-Resource-Policy')).toBe('same-origin')
})

// ---------------------------------------------------------------------------

describe('Strict-Transport-Security', () => {
  test('omits HSTS by default', async () => {
    const mw = ODSecurityHeadersMiddleware()
    const ctx = createContext()
    await mw(ctx)
    expect(getHeader(ctx, 'Strict-Transport-Security')).toBeUndefined()
  })

  test('omits HSTS when set to false', async () => {
    const mw = ODSecurityHeadersMiddleware({ hsts: false })
    const ctx = createContext()
    await mw(ctx)
    expect(getHeader(ctx, 'Strict-Transport-Security')).toBeUndefined()
  })

  test('uses default maxAge of 31536000 when hsts is an empty object', async () => {
    const mw = ODSecurityHeadersMiddleware({ hsts: {} })
    const ctx = createContext()
    await mw(ctx)
    expect(getHeader(ctx, 'Strict-Transport-Security')).toBe('max-age=31536000')
  })

  test('uses provided maxAge', async () => {
    const mw = ODSecurityHeadersMiddleware({ hsts: { maxAge: 63072000 } })
    const ctx = createContext()
    await mw(ctx)
    expect(getHeader(ctx, 'Strict-Transport-Security')).toBe('max-age=63072000')
  })

  test('appends includeSubDomains directive', async () => {
    const mw = ODSecurityHeadersMiddleware({ hsts: { maxAge: 31536000, includeSubDomains: true } })
    const ctx = createContext()
    await mw(ctx)
    expect(getHeader(ctx, 'Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains')
  })

  test('preload setup includes includeSubDomains and preload (proper preload setup)', async () => {
    const mw = ODSecurityHeadersMiddleware({ hsts: { maxAge: 31536000, includeSubDomains: true, preload: true } })
    const ctx = createContext()
    await mw(ctx)
    expect(getHeader(ctx, 'Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains; preload')
  })
})

// ---------------------------------------------------------------------------

test('applies multiple headers in one call', async () => {
  const mw = ODSecurityHeadersMiddleware({
    frameOptions: 'SAMEORIGIN',
    contentSecurityPolicy: "default-src 'self'",
    referrerPolicy: 'no-referrer',
  })
  const ctx = createContext()
  await mw(ctx)
  expect(getHeader(ctx, 'X-Content-Type-Options')).toBe('nosniff')
  expect(getHeader(ctx, 'X-Frame-Options')).toBe('SAMEORIGIN')
  expect(getHeader(ctx, 'Content-Security-Policy')).toBe("default-src 'self'")
  expect(getHeader(ctx, 'Referrer-Policy')).toBe('no-referrer')
})

test('replaces existing security headers instead of appending duplicates', async () => {
  const mw = ODSecurityHeadersMiddleware({
    frameOptions: 'SAMEORIGIN',
    contentSecurityPolicy: "default-src 'self'",
    hsts: {},
  })
  const ctx = createContext()

  ctx.response.addHeader('X-Frame-Options', 'DENY')
  ctx.response.addHeader('Content-Security-Policy', "default-src 'none'")
  ctx.response.addHeader('Strict-Transport-Security', 'max-age=10')

  await mw(ctx)
  await mw(ctx)

  const frameHeaders = ctx.response.headers.filter(h => h.name === 'X-Frame-Options')
  const cspHeaders = ctx.response.headers.filter(h => h.name === 'Content-Security-Policy')
  const hstsHeaders = ctx.response.headers.filter(h => h.name === 'Strict-Transport-Security')

  expect(frameHeaders).toEqual([{ name: 'X-Frame-Options', value: 'SAMEORIGIN' }])
  expect(cspHeaders).toEqual([{ name: 'Content-Security-Policy', value: "default-src 'self'" }])
  expect(hstsHeaders).toEqual([{ name: 'Strict-Transport-Security', value: 'max-age=31536000' }])
})

test('throws when hsts.maxAge is negative', () => {
  expect(() => ODSecurityHeadersMiddleware({ hsts: { maxAge: -1 } }))
    .toThrow('ODSecurityHeadersMiddleware: hsts.maxAge must be a non-negative integer')
})

test('throws when hsts.maxAge is not an integer', () => {
  expect(() => ODSecurityHeadersMiddleware({ hsts: { maxAge: 1.5 } }))
    .toThrow('ODSecurityHeadersMiddleware: hsts.maxAge must be a non-negative integer')
})

test('throws when hsts.preload is enabled without includeSubDomains', () => {
  expect(() => ODSecurityHeadersMiddleware({ hsts: { preload: true } }))
    .toThrow('ODSecurityHeadersMiddleware: hsts.preload requires includeSubDomains:true')
})

test('throws when hsts.preload is enabled with maxAge below one year', () => {
  expect(() => ODSecurityHeadersMiddleware({
    hsts: { maxAge: 31_536_000 - 1, includeSubDomains: true, preload: true },
  })).toThrow('ODSecurityHeadersMiddleware: hsts.preload requires maxAge >= 31536000')
})
