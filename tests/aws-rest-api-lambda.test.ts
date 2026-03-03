import { Readable } from 'stream'
import ODApp from '../src/core/app'
import ODController from '../src/core/controller'
import ODResponse from '../src/core/response'
import ODAwsRestApiHandlerFactory, {
  type ODAwsRestApiEvent,
} from '../src/transport/aws-rest-api-lambda'

function makeEvent(overrides: Partial<ODAwsRestApiEvent> = {}): ODAwsRestApiEvent {
  return { httpMethod: 'GET', path: '/test', ...overrides }
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

  test('sets method uppercased', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({ httpMethod: 'post' }))
    expect(req.method).toBe('POST')
  })

  test('sets path as URL pathname', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({ path: '/hello/world' }))
    expect(req.path).toBe('/hello/world')
  })

  test('lowercases header names from headers map', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'abc' },
    }))
    expect(req.getHeader('content-type')).toBe('application/json')
    expect(req.getHeader('x-custom')).toBe('abc')
  })

  test('prefers multiValueHeaders values while preserving plain headers', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({
      headers: { Cookie: 'ignored', 'X-Single': 'abc' },
      multiValueHeaders: { Cookie: ['a=1', 'b=2'] },
    }))
    expect(req.getHeader('cookie')).toBe('a=1; b=2')
    expect(req.getHeader('x-single')).toBe('abc')
  })

  test('falls back to headers when multiValueHeaders is empty', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({
      headers: { 'X-Test': 'value' },
      multiValueHeaders: {},
    }))
    expect(req.getHeader('x-test')).toBe('value')
  })

  test('joins multiple values from multiValueHeaders with a comma separator', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({
      multiValueHeaders: { Accept: ['text/html', 'application/json'] },
    }))
    expect(req.getHeader('accept')).toBe('text/html, application/json')
  })

  test('skips empty-array entries in multiValueHeaders', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({
      multiValueHeaders: { 'x-empty': [] },
    }))
    expect(req.getHeader('x-empty')).toBeUndefined()
  })

  test('omits headers when the event does not provide any', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent())
    expect(req.getHeader('content-type')).toBeUndefined()
  })

  test('adds queryStringParameters to the request URL', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({
      queryStringParameters: { foo: 'bar', baz: '1' },
    }))
    expect(req.querySearchParams.get('foo')).toBe('bar')
    expect(req.querySearchParams.get('baz')).toBe('1')
  })

  test('prefers multiValueQueryStringParameters over queryStringParameters', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({
      queryStringParameters: { a: '1' },
      multiValueQueryStringParameters: { a: ['1', '2'] },
    }))
    expect(req.querySearchParams.getAll('a')).toEqual(['1', '2'])
  })

  test('leaves the path unchanged when no query params are present', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({ path: '/hello' }))
    expect(req.url).toBe('/hello')
  })

  test('ignores null queryStringParameters', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({
      path: '/hello',
      queryStringParameters: null,
    }))
    expect(req.url).toBe('/hello')
  })

  test('forwards rawBody to the request', () => {
    const rawBody = Buffer.from('hello body')
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent(), rawBody)
    expect(req.rawBody).toEqual(rawBody)
  })

  test('uses an empty buffer when rawBody is omitted', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent())
    expect(req.rawBody.length).toBe(0)
  })

  test('uses requestContext.identity.sourceIp when available', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({
      requestContext: { identity: { sourceIp: '1.2.3.4' } },
    }))
    expect(req.ip).toBe('1.2.3.4')
  })

  test('falls back to 0.0.0.0 when sourceIp is null', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent({
      requestContext: { identity: { sourceIp: null } },
    }))
    expect(req.ip).toBe('0.0.0.0')
  })

  test('falls back to 0.0.0.0 when requestContext is missing', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent())
    expect(req.ip).toBe('0.0.0.0')
  })

  test('always uses https as the request protocol', () => {
    const req = ODAwsRestApiHandlerFactory.convertRequest(app, makeEvent())
    expect(req.protocol).toBe('https')
  })
})

describe('convertResponse', () => {
  test('forwards the status code', async () => {
    const result = await ODAwsRestApiHandlerFactory.convertResponse(new ODResponse(404, 'not found'))
    expect(result.statusCode).toBe(404)
  })

  test('converts string content without base64 encoding', async () => {
    const result = await ODAwsRestApiHandlerFactory.convertResponse(new ODResponse(200, 'hello'))
    expect(result.body).toBe('hello')
    expect(result.isBase64Encoded).toBe(false)
    expect(result.headers['content-type']).toMatch('text/plain')
  })

  test('stringifies JSON content and injects content-type', async () => {
    const result = await ODAwsRestApiHandlerFactory.convertResponse(new ODResponse(200, { foo: 'bar' }))
    expect(JSON.parse(result.body)).toEqual({ foo: 'bar' })
    expect(result.isBase64Encoded).toBe(false)
    expect(result.headers['content-type']).toMatch('application/json')
    expect(result.multiValueHeaders['content-type']).toEqual([expect.stringContaining('application/json')])
  })

  test('base64-encodes Buffer content', async () => {
    const buf = Buffer.from('binary data')
    const result = await ODAwsRestApiHandlerFactory.convertResponse(new ODResponse(200, buf))
    expect(result.isBase64Encoded).toBe(true)
    expect(Buffer.from(result.body, 'base64').toString()).toBe('binary data')
  })

  test('base64-encodes Blob content and keeps its content-type', async () => {
    const blob = new Blob(['blob data'], { type: 'application/octet-stream' })
    const result = await ODAwsRestApiHandlerFactory.convertResponse(new ODResponse(200, blob))
    expect(result.isBase64Encoded).toBe(true)
    expect(Buffer.from(result.body, 'base64').toString()).toBe('blob data')
    expect(result.headers['content-type']).toBe('application/octet-stream')
  })

  test('buffers Readable streams and base64-encodes the result', async () => {
    const readable = new Readable({
      read() {
        this.push(Buffer.from('stream data'))
        this.push(null)
      },
    })
    const result = await ODAwsRestApiHandlerFactory.convertResponse(new ODResponse(200, readable))
    expect(result.isBase64Encoded).toBe(true)
    expect(Buffer.from(result.body, 'base64').toString()).toBe('stream data')
  })

  test('rejects when a buffered Readable stream exceeds maxResponseSize', async () => {
    const readable = new Readable({
      read() {
        this.push(Buffer.from('stream data'))
        this.push(null)
      },
    })
    await expect(
      ODAwsRestApiHandlerFactory.convertResponse(new ODResponse(200, readable), 8),
    ).rejects.toThrow('Lambda response exceeds maxResponseSize')
  })

  test('accepts Readable streams that emit string chunks', async () => {
    const readable = new Readable({
      read() {
        this.push('text chunk')
        this.push(null)
      },
    })
    const result = await ODAwsRestApiHandlerFactory.convertResponse(new ODResponse(200, readable))
    expect(result.isBase64Encoded).toBe(true)
    expect(Buffer.from(result.body, 'base64').toString()).toBe('text chunk')
  })

  test('rejects when a Readable stream emits an error', async () => {
    const readable = new Readable({
      read() {
        this.destroy(new Error('stream error'))
      },
    })
    await expect(
      ODAwsRestApiHandlerFactory.convertResponse(new ODResponse(200, readable)),
    ).rejects.toThrow('stream error')
  })

  test('writes a single header to both header maps', async () => {
    const res = new ODResponse(200, 'ok', [{ name: 'X-Custom', value: 'val' }])
    const result = await ODAwsRestApiHandlerFactory.convertResponse(res)
    expect(result.headers['x-custom']).toBe('val')
    expect(result.multiValueHeaders['x-custom']).toEqual(['val'])
  })

  test('keeps all duplicate headers in multiValueHeaders and the last one in headers', async () => {
    const res = new ODResponse(200, 'ok', [
      { name: 'Set-Cookie', value: 'a=1' },
      { name: 'Set-Cookie', value: 'b=2' },
    ])
    const result = await ODAwsRestApiHandlerFactory.convertResponse(res)
    expect(result.multiValueHeaders['set-cookie']).toEqual(['a=1', 'b=2'])
    expect(result.headers['set-cookie']).toBe('b=2')
  })

  test('does not override an existing Content-Type header', async () => {
    const res = new ODResponse(200, { foo: 'bar' }, [{ name: 'Content-Type', value: 'text/plain' }])
    const result = await ODAwsRestApiHandlerFactory.convertResponse(res)
    expect(result.multiValueHeaders['content-type']).toEqual(['text/plain'])
    expect(result.headers['content-type']).toBe('text/plain')
  })

  test('returns an empty body for 204 responses', async () => {
    const result = await ODAwsRestApiHandlerFactory.convertResponse(new ODResponse(204))
    expect(result.statusCode).toBe(204)
    expect(result.body).toBe('')
    expect(result.isBase64Encoded).toBe(false)
    expect(result.headers['content-type']).toBeUndefined()
  })

  test('lowercases output header names', async () => {
    const res = new ODResponse(200, 'ok', [{ name: 'X-Request-ID', value: 'abc123' }])
    const result = await ODAwsRestApiHandlerFactory.convertResponse(res)
    expect(Object.keys(result.headers)).toContain('x-request-id')
    expect(Object.keys(result.multiValueHeaders)).toContain('x-request-id')
  })
})

describe('build', () => {
  test('returns a function', async () => {
    const handler = await ODAwsRestApiHandlerFactory.build(new ODApp())
    expect(typeof handler).toBe('function')
  })

  test('routes GET requests and returns JSON', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    const result = await handler(makeEvent({ path: '/test', httpMethod: 'GET' }))
    expect(result.statusCode).toBe(200)
    expect(result.isBase64Encoded).toBe(false)
    expect(JSON.parse(result.body)).toMatchObject({ method: 'GET', path: '/test' })
  })

  test('routes POST requests with a JSON body', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    const result = await handler(makeEvent({
      path: '/test',
      httpMethod: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    }))
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ key: 'value' })
  })

  test('returns 404 for an unknown route', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    const result = await handler(makeEvent({ path: '/no-such-path' }))
    expect(result.statusCode).toBe(404)
  })

  test('returns 400 for malformed JSON request bodies', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    const result = await handler(makeEvent({
      httpMethod: 'POST',
      path: '/test',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken":',
    }))
    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body)).toEqual({ error: 'Invalid JSON body' })
  })

  test('returns 413 when the body exceeds maxBodySize', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app, { maxBodySize: 10 })
    const result = await handler(makeEvent({
      httpMethod: 'POST',
      path: '/test',
      body: 'x'.repeat(11),
    }))
    expect(result.statusCode).toBe(413)
  })

  test('accepts a body exactly at the maxBodySize limit', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app, { maxBodySize: 5 })
    const result = await handler(makeEvent({
      httpMethod: 'POST',
      path: '/test',
      body: 'hello',
    }))
    expect(result.statusCode).toBe(200)
  })

  test('applies maxBodySize to the decoded base64 payload', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app, { maxBodySize: 5 })
    const result = await handler(makeEvent({
      httpMethod: 'POST',
      path: '/test',
      body: Buffer.from('hello').toString('base64'),
      isBase64Encoded: true,
    }))
    expect(result.statusCode).toBe(200)
  })

  test('disables body limits when maxBodySize is null', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app, { maxBodySize: null })
    const result = await handler(makeEvent({
      httpMethod: 'POST',
      path: '/test',
      body: 'x'.repeat(2_000_000),
    }))
    expect(result.statusCode).toBe(200)
  })

  test('decodes base64 request bodies before controller processing', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    const payload = JSON.stringify({ decoded: true })
    const result = await handler(makeEvent({
      httpMethod: 'POST',
      path: '/test',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(payload).toString('base64'),
      isBase64Encoded: true,
    }))
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ decoded: true })
  })

  test('treats a null body as an empty request body', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    const result = await handler(makeEvent({ httpMethod: 'GET', path: '/test', body: null }))
    expect(result.statusCode).toBe(200)
  })

  test('forwards the source IP from requestContext.identity.sourceIp', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    const result = await handler(makeEvent({
      path: '/test',
      requestContext: { identity: { sourceIp: '5.6.7.8' } },
    }))
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body).ip).toBe('5.6.7.8')
  })

  test('returns framework response headers in the Lambda result', async () => {
    class HeaderController extends ODController {
      async doGet() {
        this.context.response.addHeader('X-Custom', 'test-value')
        return 'ok'
      }
    }

    const app = await ODApp.create().useController(HeaderController).init()
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    const result = await handler(makeEvent({ path: '/header', httpMethod: 'GET' }))
    expect(result.headers['x-custom']).toBe('test-value')
    expect(result.multiValueHeaders['x-custom']).toEqual(['test-value'])
  })

  test('base64-encodes binary controller responses', async () => {
    class BinaryController extends ODController {
      async doGet() {
        return Buffer.from('binary data')
      }
    }

    const app = await ODApp.create().useController(BinaryController).init()
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    const result = await handler(makeEvent({ path: '/binary', httpMethod: 'GET' }))
    expect(result.statusCode).toBe(200)
    expect(result.isBase64Encoded).toBe(true)
    expect(Buffer.from(result.body, 'base64').toString()).toBe('binary data')
  })

  test('uses the provided logger for malformed request warnings', async () => {
    const logger = makeLogger()
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app, { logger })
    jest.spyOn(ODAwsRestApiHandlerFactory, 'convertRequest').mockImplementationOnce(() => {
      throw new Error('bad')
    })

    await handler(makeEvent())

    expect(logger.warn).toHaveBeenCalledWith('Malformed Lambda request', expect.any(Error))
  })

  test('returns 400 when convertRequest throws', async () => {
    const logger = makeLogger()
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app, { logger })
    jest.spyOn(ODAwsRestApiHandlerFactory, 'convertRequest').mockImplementationOnce(() => {
      throw new Error('bad')
    })

    const result = await handler(makeEvent())

    expect(result.statusCode).toBe(400)
    expect(logger.warn).toHaveBeenCalledWith('Malformed Lambda request', expect.any(Error))
  })

  test('invokes the custom errorHandler when processRequest throws', async () => {
    const logger = makeLogger()
    const app = await makeApp()
    jest.spyOn(app, 'processRequest').mockRejectedValueOnce(new Error('crash'))
    const errorHandler = jest.fn().mockReturnValue(new ODResponse(503, { error: 'Service Unavailable' }))
    const handler = await ODAwsRestApiHandlerFactory.build(app, { errorHandler, logger })

    const result = await handler(makeEvent())

    expect(errorHandler).toHaveBeenCalled()
    expect(result.statusCode).toBe(503)
    expect(logger.error).toHaveBeenCalledWith(
      'Request handling failed',
      expect.objectContaining({ error: expect.any(Error), requestId: expect.any(String) }),
    )
  })

  test('falls back to 500 when errorHandler returns null', async () => {
    const logger = makeLogger()
    const app = await makeApp()
    jest.spyOn(app, 'processRequest').mockRejectedValueOnce(new Error('crash'))
    const errorHandler = jest.fn().mockReturnValue(null)
    const handler = await ODAwsRestApiHandlerFactory.build(app, { errorHandler, logger })

    const result = await handler(makeEvent())

    expect(result.statusCode).toBe(500)
  })

  test('falls back to 500 when errorHandler throws', async () => {
    const logger = makeLogger()
    const app = await makeApp()
    jest.spyOn(app, 'processRequest').mockRejectedValueOnce(new Error('crash'))
    const errorHandler = jest.fn().mockImplementation(() => {
      throw new Error('handler crash')
    })
    const handler = await ODAwsRestApiHandlerFactory.build(app, { errorHandler, logger })

    const result = await handler(makeEvent())

    expect(result.statusCode).toBe(500)
    expect(logger.error).toHaveBeenCalledWith(
      'Custom error handler failed',
      expect.objectContaining({ error: expect.any(Error), requestId: expect.any(String) }),
    )
  })

  test('uses app.logger by default', async () => {
    const app = await makeApp()
    const warnSpy = jest.spyOn(app.logger, 'warn').mockImplementation(() => {})
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    jest.spyOn(ODAwsRestApiHandlerFactory, 'convertRequest').mockImplementationOnce(() => {
      throw new Error('bad')
    })

    await handler(makeEvent())

    expect(warnSpy).toHaveBeenCalledWith('Malformed Lambda request', expect.any(Error))
  })

  test('forwards multiValueHeaders through the request conversion', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    const result = await handler(makeEvent({
      httpMethod: 'GET',
      path: '/test',
      headers: { Cookie: 'ignored' },
      multiValueHeaders: { Cookie: ['a=1', 'b=2'], Host: ['test.example.com'] },
    }))
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body).cookie).toBe('a=1; b=2')
  })

  test('forwards repeated query params from multiValueQueryStringParameters', async () => {
    const app = await makeApp()
    const handler = await ODAwsRestApiHandlerFactory.build(app)
    const result = await handler(makeEvent({
      httpMethod: 'GET',
      path: '/test',
      multiValueQueryStringParameters: { tag: ['a', 'b'] },
    }))
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body).tags).toEqual(['a', 'b'])
  })

  test('returns 500 when response serialization fails', async () => {
    const app = await makeApp()
    const logger = makeLogger()
    const handler = await ODAwsRestApiHandlerFactory.build(app, { maxResponseSize: 8, logger })

    jest.spyOn(app, 'processRequest').mockResolvedValueOnce(new ODResponse(200, 'too large'))

    const result = await handler(makeEvent())

    expect(result.statusCode).toBe(500)
    expect(result.body).toBe('')
    expect(logger.error).toHaveBeenCalledWith(
      'Response serialization failed',
      expect.objectContaining({ error: expect.any(Error), requestId: expect.any(String) }),
    )
  })
})
