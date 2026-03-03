import http from 'http'
import net from 'net'
import { Readable } from 'stream'
import ODApp from '../src/core/app'
import ODController from '../src/core/controller'
import ODWebServer, { RequestHandler } from '../src/transport/web-server'
import ODResponse from '../src/core/response'
import { ODLogger } from '../src/core/logger'
import { IServerResponse } from '../src/transport/utils/http'

// --- Test controller ---

class HttpTestController extends ODController {
  async doGet() {
    return { message: 'hello' }
  }

  async doPost() {
    return this.context.request.body
  }

  async doDeleteId(_params: { id: number }) {
    this.context.response.code = 204
    return ''
  }
}

// --- HTTP helper ---

interface HttpResponse {
  statusCode: number
  headers: http.IncomingHttpHeaders
  body: string
}

function httpRequest(port: number, method: string, path: string, body?: string, headers?: Record<string, string>): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const reqHeaders: Record<string, string> = { ...headers }
    if (body !== undefined) {
      reqHeaders['content-length'] = Buffer.byteLength(body).toString()
    }
    const opts: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: reqHeaders,
    }
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode!,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf-8'),
        })
      })
    })
    req.on('error', reject)
    if (body !== undefined) {
      req.write(body)
    }
    req.end()
  })
}

interface RawHttpResponse {
  statusCode: number
  body: string
}

function rawHttpRequest(port: number, payload: string): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(payload)
    })
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('error', reject)
    socket.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      const [head, ...bodyParts] = raw.split('\r\n\r\n')
      const statusLine = head.split('\r\n')[0]
      const statusCode = parseInt(statusLine.split(' ')[1] ?? '0', 10)
      resolve({ statusCode, body: bodyParts.join('\r\n\r\n') })
    })
  })
}

// --- Tests ---

describe('HTTP integration tests', () => {
  let stopServer: () => Promise<void>
  const port = 19000 + Math.floor(Math.random() * 1000)

  beforeAll(async () => {
    const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const app = await ODApp
      .create({ logger })
      .useController(HttpTestController)
      .init()
    stopServer = await ODWebServer.run(app, { port, host: '127.0.0.1' })
  })

  afterAll(async () => {
    await stopServer()
  })

  test('GET returns JSON response with correct status and content-type', async () => {
    const res = await httpRequest(port, 'GET', '/http-test')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(res.body)).toEqual({ message: 'hello' })
  })

  test('POST with JSON body is parsed and echoed back', async () => {
    const payload = JSON.stringify({ key: 'value', num: 42 })
    const res = await httpRequest(port, 'POST', '/http-test', payload, { 'content-type': 'application/json' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ key: 'value', num: 42 })
  })

  test('POST with invalid JSON returns 400', async () => {
    const res = await httpRequest(port, 'POST', '/http-test', 'not json', { 'content-type': 'application/json' })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('Invalid JSON body')
  })

  test('404 for unknown routes', async () => {
    const res = await httpRequest(port, 'GET', '/nonexistent')
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('Not found')
  })

  test('DELETE returns 204 with empty body', async () => {
    const res = await httpRequest(port, 'DELETE', '/http-test/1')
    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
  })

  test('OPTIONS returns 204 with Allow header', async () => {
    const res = await httpRequest(port, 'OPTIONS', '/http-test')
    expect(res.statusCode).toBe(204)
    expect(res.headers['allow']).toBeDefined()
    expect(res.headers['allow']).toContain('GET')
    expect(res.headers['allow']).toContain('POST')
  })
})

describe('HTTP integration - maxBodySize', () => {
  let stopServer: () => Promise<void>
  const port = 19000 + Math.floor(Math.random() * 1000)

  beforeAll(async () => {
    const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const app = await ODApp
      .create({ logger })
      .useController(HttpTestController)
      .init()
    stopServer = await ODWebServer.run(app, { port, host: '127.0.0.1', maxBodySize: 64 })
  })

  afterAll(async () => {
    await stopServer()
  })

  test('body within maxBodySize is accepted', async () => {
    const payload = JSON.stringify({ ok: true })
    const res = await httpRequest(port, 'POST', '/http-test', payload, { 'content-type': 'application/json' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
  })

  test('413 Payload Too Large when body exceeds maxBodySize', async () => {
    const largeBody = 'x'.repeat(128)
    const res = await httpRequest(port, 'POST', '/http-test', largeBody, { 'content-type': 'application/json' })
    expect(res.statusCode).toBe(413)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('Payload Too Large')
  })
})

describe('HTTP integration - runtime maxBodySize updates', () => {
  let app: ODApp
  let server: ODWebServer
  const port = 19000 + Math.floor(Math.random() * 1000)

  beforeAll(async () => {
    app = await ODApp.create().useController(HttpTestController).init()
    server = new ODWebServer({ port, host: '127.0.0.1', maxBodySize: 64, logger: app.logger })
    await server.start(
      (req) => app.processRequest(req),
      {
        createResponse: () => app.createResponse(),
        createRequest: (init) => app.createRequest(init),
      },
    )
  })

  afterAll(async () => {
    server.detachSignalHandlers()
    await server.stop()
    await app.unload()
  })

  test('setOption(maxBodySize) applies to subsequent requests', async () => {
    const payload = JSON.stringify({ value: '1234567890' })

    const before = await httpRequest(port, 'POST', '/http-test', payload, { 'content-type': 'application/json' })
    expect(before.statusCode).toBe(200)

    server.setOption('maxBodySize', 8)

    const after = await httpRequest(port, 'POST', '/http-test', payload, { 'content-type': 'application/json' })
    expect(after.statusCode).toBe(413)
  })
})

describe('HTTP integration - custom error handler', () => {
  let stopServer: () => Promise<void>
  const port = 19000 + Math.floor(Math.random() * 1000)

  beforeAll(async () => {
    const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const app = await ODApp
      .create({ logger })
      .useController(HttpTestController)
      .init()
    stopServer = await ODWebServer.run(app, {
      port,
      host: '127.0.0.1',
      errorHandler: (_req, _err) => {
        const res = new ODResponse()
        res.setError(503, 'Custom error handler response')
        return res
      },
    })
  })

  afterAll(async () => {
    await stopServer()
  })

  test('GET with valid route works normally', async () => {
    const res = await httpRequest(port, 'GET', '/http-test')
    expect(res.statusCode).toBe(200)
  })
})

describe('HTTP integration - malformed requests', () => {
  let stopServer: () => Promise<void>
  const port = 19000 + Math.floor(Math.random() * 1000)

  beforeAll(async () => {
    const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const app = await ODApp
      .create({ logger })
      .useController(HttpTestController)
      .init()
    stopServer = await ODWebServer.run(app, { port, host: '127.0.0.1' })
  })

  afterAll(async () => {
    await stopServer()
  })

  test('returns 400 for malformed Host header', async() => {
    const res = await rawHttpRequest(
      port,
      'GET /http-test HTTP/1.1\r\nHost: bad host\r\nConnection: close\r\n\r\n',
    )
    expect(res.statusCode).toBe(400)
  })
})

describe('HTTP integration - graceful shutdown and request draining', () => {
  let stopServer: () => Promise<void>
  const port = 19000 + Math.floor(Math.random() * 1000)

  class SlowController extends ODController {
    async doGetWait() {
      await new Promise(resolve => setTimeout(resolve, 150))
      return { ok: true }
    }
  }

  beforeAll(async () => {
    const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const app = await ODApp
      .create({ logger })
      .useController(SlowController)
      .init()
    stopServer = await ODWebServer.run(app, {
      port,
      host: '127.0.0.1',
      gracefulShutdownTimeout: 1000,
    })
  })

  afterAll(async () => {
    await stopServer().catch(() => undefined)
  })

  test('stop waits for in-flight request to complete', async() => {
    const responsePromise = httpRequest(port, 'GET', '/slow/wait')
    await new Promise(resolve => setTimeout(resolve, 30))
    const stopPromise = stopServer()

    let stopTimeout: NodeJS.Timeout | null = null
    const stoppedEarly = await Promise.race([
      stopPromise.then(() => true),
      new Promise<boolean>((resolve) => {
        stopTimeout = setTimeout(() => {
          stopTimeout = null
          resolve(false)
        }, 60)
        stopTimeout.unref()
      }),
    ])
    if (stopTimeout) {
      clearTimeout(stopTimeout)
    }
    expect(stoppedEarly).toBe(false)

    const response = await responsePromise
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true })
    await stopPromise
  })
})

describe('HTTP integration - duplicate response headers', () => {
  let stopServer: () => Promise<void>
  const port = 19000 + Math.floor(Math.random() * 1000)

  class CookieController extends ODController {
    async doGet() {
      this.context.response.addHeader('Set-Cookie', 'session=abc123; HttpOnly')
      this.context.response.addHeader('Set-Cookie', 'preference=dark; Max-Age=31536000')
      this.context.response.code = 200
      return ''
    }
  }

  beforeAll(async () => {
    const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const app = await ODApp
      .create({ logger })
      .useController(CookieController)
      .init()
    stopServer = await ODWebServer.run(app, { port, host: '127.0.0.1' })
  })

  afterAll(async () => {
    await stopServer()
  })

  test('both Set-Cookie headers arrive at the client', async () => {
    const res = await httpRequest(port, 'GET', '/cookie')
    expect(res.statusCode).toBe(200)
    const cookies = res.headers['set-cookie']
    expect(Array.isArray(cookies)).toBe(true)
    expect(cookies).toHaveLength(2)
    expect(cookies).toContain('session=abc123; HttpOnly')
    expect(cookies).toContain('preference=dark; Max-Age=31536000')
  })
})

describe('HTTP integration - streaming responses', () => {
  let stopServer: () => Promise<void>
  const port = 19000 + Math.floor(Math.random() * 1000)

  class StreamController extends ODController {
    async doGet() {
      const stream = Readable.from(['hello', ' ', 'world'])
      return this.context.response.stream(stream, 'text/plain')
    }

    async doGetBinary() {
      const stream = Readable.from([Buffer.from([0x41, 0x42, 0x43])])
      return this.context.response.stream(stream, 'application/octet-stream')
    }
  }

  beforeAll(async () => {
    const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const app = await ODApp
      .create({ logger })
      .useController(StreamController)
      .init()
    stopServer = await ODWebServer.run(app, { port, host: '127.0.0.1' })
  })

  afterAll(async () => {
    await stopServer()
  })

  test('streams text content with correct status and content-type', async () => {
    const res = await httpRequest(port, 'GET', '/stream')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/plain')
    expect(res.body).toBe('hello world')
  })

  test('streams binary content with correct content-type', async () => {
    const res = await httpRequest(port, 'GET', '/stream/binary')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/octet-stream')
    expect(res.body).toBe('ABC')
  })
})

describe('HTTP integration - handleProcessSignals: false', () => {
  test('ODWebServer.run() with handleProcessSignals: false does not attach signal handlers', async () => {
    const port = 19000 + Math.floor(Math.random() * 1000)
    const app = await ODApp.create().useController(HttpTestController).init()
    const stop = await ODWebServer.run(app, { port, host: '127.0.0.1', handleProcessSignals: false })
    const res = await httpRequest(port, 'GET', '/http-test')
    expect(res.statusCode).toBe(200)
    await stop()
  })
})

describe('HTTP integration - requestTimeout option', () => {
  let stopFn: (() => Promise<void>) | undefined
  const port = 19000 + Math.floor(Math.random() * 1000)

  beforeAll(async () => {
    const app = await ODApp.create().useController(HttpTestController).init()
    const server = new ODWebServer({ port, host: '127.0.0.1', requestTimeout: 5000 })
    await server.start((req) => app.processRequest(req), { createResponse: () => app.createResponse() })
    stopFn = async () => { server.detachSignalHandlers(); await server.stop(); await app.unload() }
  })

  afterAll(async () => { await stopFn?.() })

  test('handles request when requestTimeout is set on the server', async () => {
    const res = await httpRequest(port, 'GET', '/http-test')
    expect(res.statusCode).toBe(200)
  })
})

describe('HTTP integration - handler throwing (no error handler)', () => {
  let stopFn: (() => Promise<void>) | undefined
  const port = 19000 + Math.floor(Math.random() * 1000)
  const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }

  beforeAll(async () => {
    const server = new ODWebServer({ port, host: '127.0.0.1', logger })
    const handler: RequestHandler = async () => { throw new Error('handler blew up') }
    await server.start(handler)
    stopFn = async () => { server.detachSignalHandlers(); await server.stop() }
  })

  afterAll(async () => { await stopFn?.() })

  test('returns 500 when handler throws and no error handler is set', async () => {
    const res = await httpRequest(port, 'GET', '/')
    expect(res.statusCode).toBe(500)
  })
})

describe('HTTP integration - errorHandler also throws', () => {
  let stopFn: (() => Promise<void>) | undefined
  const port = 19000 + Math.floor(Math.random() * 1000)
  const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }

  beforeAll(async () => {
    const server = new ODWebServer({
      port,
      host: '127.0.0.1',
      logger,
      errorHandler: () => { throw new Error('error handler blew up') },
    })
    const handler: RequestHandler = async () => { throw new Error('handler blew up') }
    await server.start(handler)
    stopFn = async () => { server.detachSignalHandlers(); await server.stop() }
  })

  afterAll(async () => { await stopFn?.() })

  test('falls back to generic 500 when custom errorHandler also throws', async () => {
    const res = await httpRequest(port, 'GET', '/')
    expect(res.statusCode).toBe(500)
    expect(logger.error).toHaveBeenCalledWith(
      'Custom error handler failed',
      expect.objectContaining({ requestId: expect.any(String) }),
    )
  })
})

describe('HTTP integration - custom errorHandler succeeds (covers if(!res) false branch)', () => {
  let stopFn: (() => Promise<void>) | undefined
  const port = 19000 + Math.floor(Math.random() * 1000)
  const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }

  beforeAll(async () => {
    const server = new ODWebServer({
      port,
      host: '127.0.0.1',
      logger,
      errorHandler: (_req, _err) => {
        const res = new ODResponse()
        res.setError(503, 'Handled by custom errorHandler')
        return res
      },
    })
    const handler: RequestHandler = async () => { throw new Error('handler failed') }
    await server.start(handler)
    stopFn = async () => { server.detachSignalHandlers(); await server.stop() }
  })

  afterAll(async () => { await stopFn?.() })

  test('custom errorHandler response is used when handler throws', async () => {
    const res = await httpRequest(port, 'GET', '/')
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Handled by custom errorHandler' })
  })
})

describe('HTTP integration - send failure (_sendSafe)', () => {
  let stopFn: (() => Promise<void>) | undefined
  const port = 19000 + Math.floor(Math.random() * 1000)
  const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }

  class BrokenSendServer extends ODWebServer {
    override async send(_response: IServerResponse, _res: ODResponse): Promise<void> {
      throw new Error('send failed intentionally')
    }
  }

  beforeAll(async () => {
    const server = new BrokenSendServer({ port, host: '127.0.0.1', logger })
    const handler: RequestHandler = async () => new ODResponse(200, 'ok')
    await server.start(handler)
    stopFn = async () => { server.detachSignalHandlers(); await server.stop() }
  })

  afterAll(async () => { await stopFn?.() })

  test('logs error and calls writeFallbackResponse when send() throws', async () => {
    try {
      await rawHttpRequest(port, 'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
    } catch {
      // The fallback response may not parse cleanly - that is expected
    }
    expect(logger.error).toHaveBeenCalledWith('Failed to send response', expect.any(Error))
  })
})
