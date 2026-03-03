import http2 from 'http2'
import { EventEmitter } from 'events'
import net from 'net'
import { Readable } from 'stream'
import ODHttp2WebServer from '../src/transport/http2-web-server'
import ODResponse from '../src/core/response'
import ODApp from '../src/core/app'
import ODController from '../src/core/controller'
import type { ODLogger } from '../src/core/logger'

class FakeHttp2SecureServer extends EventEmitter {
  listen = jest.fn((_port: number, _host: string, cb?: () => void) => {
    cb?.()
    return this
  })

  close = jest.fn((cb?: (err?: Error) => void) => {
    cb?.()
    return this
  })
}

function makeFakeSocket(): net.Socket {
  const socket = new EventEmitter() as EventEmitter & {
    destroyed: boolean
    end: jest.Mock
    destroy: jest.Mock
  }
  socket.destroyed = false
  socket.end = jest.fn(() => {
    socket.emit('close')
    return socket
  })
  socket.destroy = jest.fn(() => {
    socket.destroyed = true
    socket.emit('close')
    return socket
  })
  return socket as unknown as net.Socket
}

function makeSocketProxy(socket: net.Socket): net.Socket {
  return new Proxy(new EventEmitter(), {
    get(_target, key) {
      return (socket as unknown as Record<PropertyKey, unknown>)[key]
    },
    set(_target, key, value) {
      ;(socket as unknown as Record<PropertyKey, unknown>)[key] = value
      return true
    },
  }) as unknown as net.Socket
}

// --- Unit tests (no server required) ---

test('constructs with default options', () => {
  const server = new ODHttp2WebServer({})
  expect(server.getOption('port')).toBe(8888)
  expect(server.getOption('host')).toBe('0.0.0.0')
  expect(server.getOption('maxBodySize')).toBe(1_048_576)
  expect(server.getOption('gracefulShutdownTimeout')).toBe(10_000)
  expect(server.getOption('handleProcessSignals')).toBe(true)
  expect(server.getOption('errorHandler')).toBeNull()
})

test('constructs with custom options', () => {
  const server = new ODHttp2WebServer({ port: 3000, host: '127.0.0.1' })
  expect(server.getOption('port')).toBe(3000)
  expect(server.getOption('host')).toBe('127.0.0.1')
})

test('setOption updates a single option', () => {
  const server = new ODHttp2WebServer({})
  server.setOption('port', 9999)
  expect(server.getOption('port')).toBe(9999)
})

test('validates port must be positive integer', () => {
  expect(() => new ODHttp2WebServer({ port: -1 })).toThrow('port must be an integer between 1 and 65535')
  expect(() => new ODHttp2WebServer({ port: 0 })).toThrow('port must be an integer between 1 and 65535')
  expect(() => new ODHttp2WebServer({ port: 'abc' as any })).toThrow('port must be an integer between 1 and 65535')
})

test('validates host must be non-empty string', () => {
  expect(() => new ODHttp2WebServer({ host: '' })).toThrow('host must be a non-empty string')
  expect(() => new ODHttp2WebServer({ host: 123 as any })).toThrow('host must be a non-empty string')
})

test('validates maxBodySize must be positive number or null', () => {
  expect(() => new ODHttp2WebServer({ maxBodySize: -1 })).toThrow('maxBodySize must be a positive number or null')
  const server = new ODHttp2WebServer({ maxBodySize: null })
  expect(server.getOption('maxBodySize')).toBeNull()
})

test('validates gracefulShutdownTimeout must be positive number or null', () => {
  expect(() => new ODHttp2WebServer({ gracefulShutdownTimeout: 0 })).toThrow()
  const server = new ODHttp2WebServer({ gracefulShutdownTimeout: null })
  expect(server.getOption('gracefulShutdownTimeout')).toBeNull()
})

test('validates handleProcessSignals must be boolean', () => {
  expect(() => new ODHttp2WebServer({ handleProcessSignals: 1 as any })).toThrow('handleProcessSignals must be a boolean')
})

test('validates logger must expose error, warn, and info methods', () => {
  const invalidLogger = { error: jest.fn(), warn: jest.fn() } as any
  expect(() => new ODHttp2WebServer({ logger: invalidLogger })).toThrow('logger must be an object with error, warn, and info methods')

  const server = new ODHttp2WebServer({})
  expect(() => server.setOption('logger', invalidLogger)).toThrow('logger must be an object with error, warn, and info methods')
})

test('validates errorHandler must be a function or null', () => {
  expect(() => new ODHttp2WebServer({ errorHandler: 'bad-handler' as any })).toThrow('errorHandler must be a function or null')

  const server = new ODHttp2WebServer({})
  expect(() => server.setOption('errorHandler', 'bad-handler' as any)).toThrow('errorHandler must be a function or null')
})

test('setOption validates', () => {
  const server = new ODHttp2WebServer({})
  expect(() => server.setOption('port', -5)).toThrow('port must be an integer between 1 and 65535')
})

test('inFlightRequests is 0 when no requests are active', () => {
  const server = new ODHttp2WebServer({})
  expect(server.inFlightRequests).toBe(0)
})

test('stop() rejects when server has not started', async () => {
  const server = new ODHttp2WebServer({})
  await expect(server.stop()).rejects.toThrow('Server is not started')
})

test('TLS: start() rejects with invalid TLS credentials (covers http2.createSecureServer branch)', async () => {
  const port = 28000 + Math.floor(Math.random() * 500)
  const server = new ODHttp2WebServer({
    port, host: '127.0.0.1',
    tls: { key: 'not-a-key', cert: 'not-a-cert', ca: 'not-a-ca' },
  })
  await expect(server.start(async () => new ODResponse(200, 'ok'))).rejects.toThrow()
})

test('TLS: start() without ca covers the tls.ca false-branch', async () => {
  const port = 28500 + Math.floor(Math.random() * 500)
  const server = new ODHttp2WebServer({
    port, host: '127.0.0.1',
    tls: { key: 'not-a-key', cert: 'not-a-cert' },
  })
  await expect(server.start(async () => new ODResponse(200, 'ok'))).rejects.toThrow()
})

test('TLS: stop() closes idle HTTP/1.1 fallback sockets before waiting for server.close()', async () => {
  const fakeServer = new FakeHttp2SecureServer()
  const createSecureServerSpy = jest.spyOn(http2, 'createSecureServer')
    .mockImplementation(((_options: http2.SecureServerOptions, _handler?: unknown) => fakeServer as unknown as http2.Http2SecureServer) as typeof http2.createSecureServer)

  try {
    const server = new ODHttp2WebServer({
      port: 28600 + Math.floor(Math.random() * 500),
      host: '127.0.0.1',
      tls: { key: 'fake-key', cert: 'fake-cert' },
      gracefulShutdownTimeout: null,
    })
    await server.start(async () => new ODResponse(200, 'ok'))

    const socket = makeFakeSocket()
    fakeServer.emit('secureConnection', socket)

    await server.stop()

    expect(socket.end).toHaveBeenCalledTimes(1)
  } finally {
    createSecureServerSpy.mockRestore()
  }
})

test('stop() does not close a connection socket while its HTTP/2 session is still draining', async () => {
  const fakeServer = new FakeHttp2SecureServer()
  const createServerSpy = jest.spyOn(http2, 'createServer')
    .mockImplementation(((_handler?: unknown) => fakeServer as unknown as http2.Http2Server) as typeof http2.createServer)

  try {
    const server = new ODHttp2WebServer({
      port: 28650 + Math.floor(Math.random() * 500),
      host: '127.0.0.1',
      gracefulShutdownTimeout: null,
    })
    await server.start(async () => new ODResponse(200, 'ok'))

    const socket = makeFakeSocket()
    const session = new EventEmitter() as EventEmitter & {
      closed: boolean
      destroyed: boolean
      socket: net.Socket
      close: jest.Mock
      destroy: jest.Mock
    }
    session.closed = false
    session.destroyed = false
    session.socket = makeSocketProxy(socket)
    session.close = jest.fn()
    session.destroy = jest.fn()

    fakeServer.emit('session', session)
    fakeServer.emit('connection', socket)

    await server.stop()

    expect(session.close).toHaveBeenCalledTimes(1)
    expect(socket.end).not.toHaveBeenCalled()
    expect(socket.destroy).not.toHaveBeenCalled()
  } finally {
    createServerSpy.mockRestore()
  }
})

test('TLS: allowHTTP1=false destroys unknownProtocol sockets immediately', async () => {
  const fakeServer = new FakeHttp2SecureServer()
  const createSecureServerSpy = jest.spyOn(http2, 'createSecureServer')
    .mockImplementation(((_options: http2.SecureServerOptions, _handler?: unknown) => fakeServer as unknown as http2.Http2SecureServer) as typeof http2.createSecureServer)

  try {
    const server = new ODHttp2WebServer({
      port: 28700 + Math.floor(Math.random() * 500),
      host: '127.0.0.1',
      tls: { key: 'fake-key', cert: 'fake-cert', allowHTTP1: false },
      gracefulShutdownTimeout: null,
    })
    await server.start(async () => new ODResponse(200, 'ok'))

    const socket = makeFakeSocket()
    fakeServer.emit('unknownProtocol', socket)

    expect(socket.destroy).toHaveBeenCalledTimes(1)
    expect(socket.end).not.toHaveBeenCalled()

    await server.stop()
  } finally {
    createSecureServerSpy.mockRestore()
  }
})

test('start() rejects when already started', async () => {
  const port = 29000 + Math.floor(Math.random() * 500)
  const server = new ODHttp2WebServer({ port, host: '127.0.0.1' })
  const handler = async () => new ODResponse(200, 'ok')
  await server.start(handler)
  await expect(server.start(handler)).rejects.toThrow('Server has already started')
  await server.stop()
})

test('start() rejects when port is already in use', async () => {
  const port = 29500 + Math.floor(Math.random() * 500)
  const s1 = new ODHttp2WebServer({ port, host: '127.0.0.1' })
  const s2 = new ODHttp2WebServer({ port, host: '127.0.0.1' })
  const handler = async () => new ODResponse(200, 'ok')
  await s1.start(handler)
  await expect(s2.start(handler)).rejects.toThrow(/EADDRINUSE/)
  await s1.stop()
})

test('ODHttp2WebServer.run() unloads the app when startup fails', async () => {
  const startSpy = jest.spyOn(ODHttp2WebServer.prototype, 'start').mockRejectedValue(new Error('startup failed'))
  let unloaded = false
  const app = ODApp.create().onUnload(async () => { unloaded = true })

  try {
    await expect(ODHttp2WebServer.run(app, { handleProcessSignals: false })).rejects.toThrow('startup failed')
    expect(unloaded).toBe(true)
  } finally {
    startSpy.mockRestore()
  }
})

test('server error after startup is logged', async () => {
  const port = 29700 + Math.floor(Math.random() * 300)
  const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  const server = new ODHttp2WebServer({ port, host: '127.0.0.1', logger })
  await server.start(async () => new ODResponse(200, 'ok'))
  const rawServer = (server as any)._server as net.Server
  rawServer.emit('error', new Error('server error after start'))
  expect(logger.error).toHaveBeenCalledWith('Server error', expect.any(Error))
  await server.stop()
})

test('stop() rejects when server.close() calls back with an error', async () => {
  const port = 30000 + Math.floor(Math.random() * 300)
  const server = new ODHttp2WebServer({ port, host: '127.0.0.1', gracefulShutdownTimeout: null })
  await server.start(async () => new ODResponse(200, 'ok'))

  const rawServer = (server as any)._server as net.Server
  const originalClose = rawServer.close.bind(rawServer)
  rawServer.close = function(cb?: (err?: Error) => void) {
    cb?.(new Error('close failure'))
    return this
  }

  await expect(server.stop()).rejects.toThrow('close failure')

  rawServer.close = originalClose
  await new Promise<void>((res) => rawServer.close(() => res()))
})

test('stop() gracefully closes existing HTTP/2 sessions before waiting for server close', async () => {
  const port = 30100 + Math.floor(Math.random() * 300)
  const server = new ODHttp2WebServer({ port, host: '127.0.0.1', gracefulShutdownTimeout: null })
  await server.start(async () => new ODResponse(200, 'ok'))

  const client = http2.connect(`http://127.0.0.1:${port}`)
  const req = client.request({
    ':method': 'GET',
    ':path': '/',
    ':scheme': 'http',
    ':authority': `127.0.0.1:${port}`,
  })

  await new Promise<void>((resolve, reject) => {
    req.on('error', reject)
    req.on('response', () => {})
    req.on('data', () => {})
    req.on('end', resolve)
    req.end()
  })

  let stopTimeout: NodeJS.Timeout | null = null
  const stopResult = await Promise.race([
    server.stop().then(() => 'stopped'),
    new Promise<'timed-out'>((resolve) => {
      stopTimeout = setTimeout(() => {
        stopTimeout = null
        resolve('timed-out')
      }, 1_000)
      stopTimeout.unref()
    }),
  ])
  if (stopTimeout) {
    clearTimeout(stopTimeout)
  }

  expect(stopResult).toBe('stopped')
  client.close()
})

test('stop() lets an active streaming HTTP/2 response finish before shutting down', async () => {
  const port = 30200 + Math.floor(Math.random() * 300)
  const server = new ODHttp2WebServer({ port, host: '127.0.0.1', gracefulShutdownTimeout: null })
  await server.start(async () => {
    const stream = new Readable({ read() {} })
    setTimeout(() => stream.push('hello '), 10)
    setTimeout(() => {
      stream.push('world')
      stream.push(null)
    }, 60)
    return new ODResponse().stream(stream, 'text/plain; charset=utf-8')
  })

  const client = http2.connect(`http://127.0.0.1:${port}`)
  const req = client.request({
    ':method': 'GET',
    ':path': '/',
    ':scheme': 'http',
    ':authority': `127.0.0.1:${port}`,
  })
  const chunks: Buffer[] = []
  let firstChunkResolve: (() => void) | null = null
  const firstChunk = new Promise<void>((resolve) => { firstChunkResolve = resolve })
  const responseComplete = new Promise<void>((resolve, reject) => {
    req.on('error', reject)
    req.on('data', (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk))
      firstChunkResolve?.()
      firstChunkResolve = null
    })
    req.on('end', resolve)
  })

  req.end()
  await firstChunk

  const stopPromise = server.stop()

  await responseComplete
  await expect(stopPromise).resolves.toBe(true)
  expect(Buffer.concat(chunks).toString('utf-8')).toBe('hello world')

  if (!client.closed && !client.destroyed) {
    client.close()
  }
})

// --- h2c (cleartext HTTP/2) integration tests ---

interface H2Response {
  statusCode: number
  headers: Record<string, string>
  body: string
}

function h2cRequest(
  port: number,
  method: string,
  path: string,
  body?: string,
  extraHeaders: Record<string, string> = {},
): Promise<H2Response> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`http://127.0.0.1:${port}`)
    client.on('error', reject)

    const reqHeaders: Record<string, string | undefined> = {
      ':method': method,
      ':path': path,
      ':scheme': 'http',
      ':authority': `127.0.0.1:${port}`,
      ...extraHeaders,
    }
    if (body !== undefined) {
      reqHeaders['content-length'] = Buffer.byteLength(body).toString()
    }

    const req = client.request(reqHeaders)
    const chunks: Buffer[] = []
    let statusCode = 200
    const respHeaders: Record<string, string> = {}

    req.on('response', (headers) => {
      statusCode = Number(headers[':status'] ?? 200)
      for (const [k, v] of Object.entries(headers)) {
        if (!k.startsWith(':') && typeof v === 'string') {
          respHeaders[k] = v
        }
      }
    })
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      client.close()
      resolve({ statusCode, headers: respHeaders, body: Buffer.concat(chunks).toString('utf-8') })
    })
    req.on('error', (e) => { client.close(); reject(e) })

    if (body !== undefined) {
      req.write(body)
    }
    req.end()
  })
}

class H2TestController extends ODController {
  async doGet() {
    return { message: 'hello from http2' }
  }
  async doGetHost() {
    return { host: this.context.request.host }
  }
  async doPost() {
    return this.context.request.body
  }
  async doDeleteId(params: { id: number }) {
    this.context.response.code = 204
    return ''
  }
}

describe('HTTP/2 integration (h2c)', () => {
  let stopFn: (() => Promise<void>) | undefined
  const port = 30300 + Math.floor(Math.random() * 300)

  beforeAll(async () => {
    const app = await ODApp.create().useController(H2TestController).init()
    stopFn = await ODHttp2WebServer.run(app, { port, host: '127.0.0.1' })
  })

  afterAll(async () => { await stopFn?.() })

  test('GET returns JSON response', async () => {
    const res = await h2cRequest(port, 'GET', '/h2-test')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ message: 'hello from http2' })
  })

  test('GET exposes HTTP/2 :authority as req.host', async () => {
    const res = await h2cRequest(port, 'GET', '/h2-test/host')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ host: `127.0.0.1:${port}` })
  })

  test('POST with JSON body is echoed back', async () => {
    const payload = JSON.stringify({ key: 'value', num: 42 })
    const res = await h2cRequest(port, 'POST', '/h2-test', payload, { 'content-type': 'application/json' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ key: 'value', num: 42 })
  })

  test('404 for unknown routes', async () => {
    const res = await h2cRequest(port, 'GET', '/nonexistent')
    expect(res.statusCode).toBe(404)
  })

  test('DELETE returns 204', async () => {
    const res = await h2cRequest(port, 'DELETE', '/h2-test/1')
    expect(res.statusCode).toBe(204)
  })

  test('OPTIONS returns 204 with Allow header', async () => {
    const res = await h2cRequest(port, 'OPTIONS', '/h2-test')
    expect(res.statusCode).toBe(204)
    expect(res.headers['allow']).toBeDefined()
    expect(res.headers['allow']).toContain('GET')
    expect(res.headers['allow']).toContain('POST')
  })
})

describe('HTTP/2 integration - maxBodySize', () => {
  let stopFn: (() => Promise<void>) | undefined
  const port = 30600 + Math.floor(Math.random() * 300)

  beforeAll(async () => {
    const app = await ODApp.create().useController(H2TestController).init()
    stopFn = await ODHttp2WebServer.run(app, { port, host: '127.0.0.1', maxBodySize: 64 })
  })

  afterAll(async () => { await stopFn?.() })

  test('413 Payload Too Large when body exceeds maxBodySize', async () => {
    const largeBody = 'x'.repeat(128)
    const res = await h2cRequest(port, 'POST', '/h2-test', largeBody, { 'content-type': 'application/json' })
    expect(res.statusCode).toBe(413)
  })
})

describe('HTTP/2 integration - runtime maxBodySize updates', () => {
  let app: ODApp
  let server: ODHttp2WebServer
  const port = 30700 + Math.floor(Math.random() * 300)

  beforeAll(async () => {
    app = await ODApp.create().useController(H2TestController).init()
    server = new ODHttp2WebServer({ port, host: '127.0.0.1', maxBodySize: 64, logger: app.logger })
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

    const before = await h2cRequest(port, 'POST', '/h2-test', payload, { 'content-type': 'application/json' })
    expect(before.statusCode).toBe(200)

    server.setOption('maxBodySize', 8)

    const after = await h2cRequest(port, 'POST', '/h2-test', payload, { 'content-type': 'application/json' })
    expect(after.statusCode).toBe(413)
  })
})

describe('HTTP/2 integration - handler throwing', () => {
  let stopFn: (() => Promise<void>) | undefined
  const port = 30900 + Math.floor(Math.random() * 300)
  const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }

  beforeAll(async () => {
    const server = new ODHttp2WebServer({ port, host: '127.0.0.1', logger })
    await server.start(async () => { throw new Error('handler blew up') })
    stopFn = async () => { server.detachSignalHandlers(); await server.stop() }
  })

  afterAll(async () => { await stopFn?.() })

  test('returns 500 when handler throws', async () => {
    const res = await h2cRequest(port, 'GET', '/')
    expect(res.statusCode).toBe(500)
  })
})

describe('HTTP/2 integration - custom errorHandler succeeds (covers if(!res) false branch)', () => {
  let stopFn: (() => Promise<void>) | undefined
  const port = 31500 + Math.floor(Math.random() * 300)
  const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }

  beforeAll(async () => {
    const server = new ODHttp2WebServer({
      port,
      host: '127.0.0.1',
      logger,
      errorHandler: (_req, _err) => {
        const res = new ODResponse()
        res.setError(503, 'Handled by custom errorHandler')
        return res
      },
    })
    await server.start(async () => { throw new Error('handler failed') })
    stopFn = async () => { server.detachSignalHandlers(); await server.stop() }
  })

  afterAll(async () => { await stopFn?.() })

  test('custom errorHandler response is used when handler throws', async () => {
    const res = await h2cRequest(port, 'GET', '/')
    expect(res.statusCode).toBe(503)
  })
})

describe('HTTP/2 integration - handleProcessSignals: false', () => {
  test('ODHttp2WebServer.run() with handleProcessSignals: false works', async () => {
    const port = 31200 + Math.floor(Math.random() * 300)
    const app = await ODApp.create().useController(H2TestController).init()
    const stop = await ODHttp2WebServer.run(app, { port, host: '127.0.0.1', handleProcessSignals: false })
    const res = await h2cRequest(port, 'GET', '/h2-test')
    expect(res.statusCode).toBe(200)
    await stop()
  })
})
