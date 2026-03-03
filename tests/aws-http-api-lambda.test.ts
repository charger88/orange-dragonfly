import ODApp from '../src/core/app'
import ODController from '../src/core/controller'
import ODResponse from '../src/core/response'
import ODAwsHttpApiHandlerFactory, {
  type ODAwsHttpApiEvent,
} from '../src/transport/aws-http-api-lambda'

function makeEvent(overrides: Partial<ODAwsHttpApiEvent> = {}): ODAwsHttpApiEvent {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/test',
    requestContext: {
      http: {
        method: 'GET',
        path: '/test',
        protocol: 'HTTP/1.1',
        sourceIp: '1.2.3.4',
      },
    },
    ...overrides,
  }
}

function makeLogger() {
  return { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}

class TestController extends ODController {
  async doGet() {
    const { request } = this.context
    return {
      method: request.method,
      path: request.path,
      ip: request.ip,
      cookie: request.getHeader('cookie'),
      tags: request.querySearchParams.getAll('tag'),
    }
  }

  async doPost() {
    return this.context.request.body
  }
}

async function makeApp() {
  return ODApp.create().useController(TestController).init()
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('convertRequest', () => {
  const app = new ODApp()

  test('uses requestContext.http.method', () => {
    const req = ODAwsHttpApiHandlerFactory.convertRequest(app, makeEvent({
      requestContext: { http: { method: 'post' } },
    }))
    expect(req.method).toBe('POST')
  })

  test('uses rawPath and rawQueryString', () => {
    const req = ODAwsHttpApiHandlerFactory.convertRequest(app, makeEvent({
      rawPath: '/hello',
      rawQueryString: 'tag=a&tag=b',
    }))
    expect(req.url).toBe('/hello?tag=a&tag=b')
    expect(req.querySearchParams.getAll('tag')).toEqual(['a', 'b'])
  })

  test('falls back to queryStringParameters when rawQueryString is missing', () => {
    const req = ODAwsHttpApiHandlerFactory.convertRequest(app, makeEvent({
      rawQueryString: undefined,
      queryStringParameters: { foo: 'bar' },
    }))
    expect(req.querySearchParams.get('foo')).toBe('bar')
  })

  test('merges cookies into the cookie header', () => {
    const req = ODAwsHttpApiHandlerFactory.convertRequest(app, makeEvent({
      cookies: ['a=1', 'b=2'],
    }))
    expect(req.getHeader('cookie')).toBe('a=1; b=2')
  })

  test('uses 0.0.0.0 when sourceIp is missing', () => {
    const req = ODAwsHttpApiHandlerFactory.convertRequest(app, makeEvent({
      requestContext: { http: { method: 'GET' } },
    }))
    expect(req.ip).toBe('0.0.0.0')
  })
})

describe('convertResponse', () => {
  test('moves Set-Cookie headers into the cookies array', async () => {
    const res = new ODResponse(200, 'ok', [
      { name: 'Set-Cookie', value: 'a=1' },
      { name: 'Set-Cookie', value: 'b=2' },
      { name: 'X-Test', value: 'value' },
    ])

    const result = await ODAwsHttpApiHandlerFactory.convertResponse(res)

    expect(result.cookies).toEqual(['a=1', 'b=2'])
    expect(result.headers['set-cookie']).toBeUndefined()
    expect(result.headers['x-test']).toBe('value')
  })

  test('base64-encodes Buffer responses', async () => {
    const result = await ODAwsHttpApiHandlerFactory.convertResponse(
      new ODResponse(200, Buffer.from('binary')),
    )
    expect(result.isBase64Encoded).toBe(true)
    expect(Buffer.from(result.body, 'base64').toString()).toBe('binary')
  })
})

describe('build', () => {
  test('routes GET requests through the HTTP API adapter', async () => {
    const app = await makeApp()
    const handler = await ODAwsHttpApiHandlerFactory.build(app)

    const result = await handler(makeEvent())

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toMatchObject({ method: 'GET', path: '/test', ip: '1.2.3.4' })
  })

  test('decodes base64 POST bodies before controller processing', async () => {
    const app = await makeApp()
    const handler = await ODAwsHttpApiHandlerFactory.build(app)
    const payload = JSON.stringify({ decoded: true })

    const result = await handler(makeEvent({
      requestContext: { http: { method: 'POST', path: '/test', sourceIp: '1.2.3.4' } },
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(payload).toString('base64'),
      isBase64Encoded: true,
    }))

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ decoded: true })
  })

  test('returns 400 for malformed JSON bodies', async () => {
    const app = await makeApp()
    const handler = await ODAwsHttpApiHandlerFactory.build(app)

    const result = await handler(makeEvent({
      requestContext: { http: { method: 'POST', path: '/test', sourceIp: '1.2.3.4' } },
      headers: { 'content-type': 'application/json' },
      body: '{"broken":',
    }))

    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body)).toEqual({ error: 'Invalid JSON body' })
  })

  test('returns 413 when the decoded body exceeds maxBodySize', async () => {
    const app = await makeApp()
    const handler = await ODAwsHttpApiHandlerFactory.build(app, { maxBodySize: 5 })

    const result = await handler(makeEvent({
      requestContext: { http: { method: 'POST', path: '/test', sourceIp: '1.2.3.4' } },
      body: Buffer.from('too long').toString('base64'),
      isBase64Encoded: true,
    }))

    expect(result.statusCode).toBe(413)
  })

  test('forwards request cookies and repeated query params', async () => {
    const app = await makeApp()
    const handler = await ODAwsHttpApiHandlerFactory.build(app)

    const result = await handler(makeEvent({
      cookies: ['a=1', 'b=2'],
      rawQueryString: 'tag=a&tag=b',
    }))

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toMatchObject({
      cookie: 'a=1; b=2',
      tags: ['a', 'b'],
    })
  })

  test('maps Set-Cookie response headers to the HTTP API cookies field', async () => {
    class CookieController extends ODController {
      async doGet() {
        this.context.response.addHeader('Set-Cookie', 'a=1; Path=/')
        this.context.response.addHeader('Set-Cookie', 'b=2; Path=/')
        return 'ok'
      }
    }

    const app = await ODApp.create().useController(CookieController).init()
    const handler = await ODAwsHttpApiHandlerFactory.build(app)

    const result = await handler(makeEvent({
      rawPath: '/cookie',
      requestContext: { http: { method: 'GET', path: '/cookie', sourceIp: '1.2.3.4' } },
    }))

    expect(result.statusCode).toBe(200)
    expect(result.cookies).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    expect(result.headers['set-cookie']).toBeUndefined()
  })

  test('uses the provided logger for malformed request warnings', async () => {
    const logger = makeLogger()
    const app = await makeApp()
    const handler = await ODAwsHttpApiHandlerFactory.build(app, { logger })
    jest.spyOn(ODAwsHttpApiHandlerFactory, 'convertRequest').mockImplementationOnce(() => {
      throw new Error('bad')
    })

    const result = await handler(makeEvent())

    expect(result.statusCode).toBe(400)
    expect(logger.warn).toHaveBeenCalledWith('Malformed Lambda request', expect.any(Error))
  })

  test('uses the custom errorHandler when processRequest throws', async () => {
    const logger = makeLogger()
    const app = await makeApp()
    jest.spyOn(app, 'processRequest').mockRejectedValueOnce(new Error('crash'))
    const errorHandler = jest.fn().mockReturnValue(new ODResponse(503, { error: 'Service Unavailable' }))
    const handler = await ODAwsHttpApiHandlerFactory.build(app, { errorHandler, logger })

    const result = await handler(makeEvent())

    expect(errorHandler).toHaveBeenCalled()
    expect(result.statusCode).toBe(503)
    expect(logger.error).toHaveBeenCalledWith(
      'Request handling failed',
      expect.objectContaining({ error: expect.any(Error), requestId: expect.any(String) }),
    )
  })
})
