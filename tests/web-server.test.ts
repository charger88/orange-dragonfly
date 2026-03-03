import http from 'http'
import net from 'net'
import ODApp from '../src/core/app'
import ODWebServer from '../src/transport/web-server'
import ODResponse from '../src/core/response'
import type { ODLogger } from '../src/core/logger'

test('constructs with default options', () => {
  const server = new ODWebServer({})
  expect(server.getOption('port')).toBe(8888)
  expect(server.getOption('host')).toBe('0.0.0.0')
  expect(server.getOption('maxBodySize')).toBe(1_048_576)
  expect(server.getOption('requestTimeout')).toBe(300_000)
  expect(server.getOption('gracefulShutdownTimeout')).toBe(10_000)
  expect(server.getOption('handleProcessSignals')).toBe(true)
  expect(server.getOption('errorHandler')).toBeNull()
})

test('constructs with custom options', () => {
  const server = new ODWebServer({ port: 3000, host: '127.0.0.1' })
  expect(server.getOption('port')).toBe(3000)
  expect(server.getOption('host')).toBe('127.0.0.1')
})

test('setOption updates a single option', () => {
  const server = new ODWebServer({})
  server.setOption('port', 9999)
  expect(server.getOption('port')).toBe(9999)
})

test('validates port must be positive integer', () => {
  expect(() => new ODWebServer({ port: -1 })).toThrow('port must be an integer between 1 and 65535')
  expect(() => new ODWebServer({ port: 0 })).toThrow('port must be an integer between 1 and 65535')
  expect(() => new ODWebServer({ port: 1.5 })).toThrow('port must be an integer between 1 and 65535')
  expect(() => new ODWebServer({ port: 'abc' as any })).toThrow('port must be an integer between 1 and 65535')
})

test('validates host must be non-empty string', () => {
  expect(() => new ODWebServer({ host: '' })).toThrow('host must be a non-empty string')
  expect(() => new ODWebServer({ host: 123 as any })).toThrow('host must be a non-empty string')
})

test('validates maxBodySize must be positive number or null', () => {
  expect(() => new ODWebServer({ maxBodySize: -1 })).toThrow('maxBodySize must be a positive number or null')
  expect(() => new ODWebServer({ maxBodySize: 0 })).toThrow('maxBodySize must be a positive number or null')
  // null is valid
  const server = new ODWebServer({ maxBodySize: null })
  expect(server.getOption('maxBodySize')).toBeNull()
  // Positive number is valid
  const server2 = new ODWebServer({ maxBodySize: 1024 })
  expect(server2.getOption('maxBodySize')).toBe(1024)
})

test('validates requestTimeout must be positive number or null', () => {
  expect(() => new ODWebServer({ requestTimeout: -1 })).toThrow('requestTimeout must be a positive number (ms) or null')
  expect(() => new ODWebServer({ requestTimeout: 0 })).toThrow('requestTimeout must be a positive number (ms) or null')
  // null is valid
  const server = new ODWebServer({ requestTimeout: null })
  expect(server.getOption('requestTimeout')).toBeNull()
  // Positive number is valid
  const server2 = new ODWebServer({ requestTimeout: 5000 })
  expect(server2.getOption('requestTimeout')).toBe(5000)
})

test('validates gracefulShutdownTimeout must be positive number or null', () => {
  expect(() => new ODWebServer({ gracefulShutdownTimeout: -1 })).toThrow('gracefulShutdownTimeout must be a positive number (ms) or null')
  expect(() => new ODWebServer({ gracefulShutdownTimeout: 0 })).toThrow('gracefulShutdownTimeout must be a positive number (ms) or null')
  const server = new ODWebServer({ gracefulShutdownTimeout: null })
  expect(server.getOption('gracefulShutdownTimeout')).toBeNull()
})

test('validates handleProcessSignals must be boolean', () => {
  expect(() => new ODWebServer({ handleProcessSignals: 1 as any })).toThrow('handleProcessSignals must be a boolean')
})

test('validates logger must expose error, warn, and info methods', () => {
  const invalidLogger = { error: jest.fn(), warn: jest.fn() } as any
  expect(() => new ODWebServer({ logger: invalidLogger })).toThrow('logger must be an object with error, warn, and info methods')

  const server = new ODWebServer({})
  expect(() => server.setOption('logger', invalidLogger)).toThrow('logger must be an object with error, warn, and info methods')
})

test('validates errorHandler must be a function or null', () => {
  expect(() => new ODWebServer({ errorHandler: 'bad-handler' as any })).toThrow('errorHandler must be a function or null')

  const server = new ODWebServer({})
  expect(() => server.setOption('errorHandler', 'bad-handler' as any)).toThrow('errorHandler must be a function or null')
})

test('setOption validates', () => {
  const server = new ODWebServer({})
  expect(() => server.setOption('port', -5)).toThrow('port must be an integer between 1 and 65535')
})

test('stop throws when server is not started', async () => {
  const server = new ODWebServer({})
  await expect(server.stop()).rejects.toThrow('Server is not started')
})

test('start throws when already started', async () => {
  const server = new ODWebServer({ port: 19876 })
  const handler = async () => { throw new Error('unused') }
  await server.start(handler)
  await expect(server.start(handler)).rejects.toThrow('Server has already started')
  await server.stop()
})

test('start rejects when port is already in use', async() => {
  const port = 20000 + Math.floor(Math.random() * 1000)
  const s1 = new ODWebServer({ port, host: '127.0.0.1' })
  const s2 = new ODWebServer({ port, host: '127.0.0.1' })
  const handler = async() => new ODResponse(200, 'ok')

  await s1.start(handler)
  await expect(s2.start(handler)).rejects.toThrow(/EADDRINUSE/)
  await s1.stop()
})

test('run() unloads the app when startup fails', async() => {
  const port = 20500 + Math.floor(Math.random() * 500)
  const occupied = new ODWebServer({ port, host: '127.0.0.1' })
  await occupied.start(async () => new ODResponse(200, 'ok'))

  let unloaded = false
  const app = await ODApp
    .create()
    .onUnload(async () => {
      unloaded = true
    })
    .init()

  await expect(ODWebServer.run(app, { port, host: '127.0.0.1' })).rejects.toThrow(/EADDRINUSE/)
  expect(unloaded).toBe(true)

  await occupied.stop()
})

test('inFlightRequests is 0 when no requests are active', () => {
  const server = new ODWebServer({})
  expect(server.inFlightRequests).toBe(0)
})

test('server error emitted after startup is logged', async () => {
  const port = 21000 + Math.floor(Math.random() * 500)
  const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  const server = new ODWebServer({ port, host: '127.0.0.1', logger })
  await server.start(async () => new ODResponse(200, 'ok'))

  const rawServer = (server as any)._server as net.Server
  rawServer.emit('error', new Error('server error after start'))

  expect(logger.error).toHaveBeenCalledWith('Server error', expect.any(Error))
  await server.stop()
})

test('requestTimeout: null disables the underlying Node request timeout', async () => {
  const port = 21250 + Math.floor(Math.random() * 500)
  const server = new ODWebServer({ port, host: '127.0.0.1', requestTimeout: null })
  await server.start(async () => new ODResponse(200, 'ok'))

  const rawServer = (server as any)._server as net.Server & { requestTimeout: number }
  expect(rawServer.requestTimeout).toBe(0)

  await server.stop()
})

test('stop() rejects when server.close() calls back with an error', async () => {
  const port = 21500 + Math.floor(Math.random() * 500)
  const server = new ODWebServer({ port, host: '127.0.0.1', gracefulShutdownTimeout: null })
  await server.start(async () => new ODResponse(200, 'ok'))

  const rawServer = (server as any)._server as net.Server
  const originalClose = rawServer.close.bind(rawServer)
  rawServer.close = function(cb?: (err?: Error) => void) {
    cb?.(new Error('deliberate close failure'))
    return this
  }

  await expect(server.stop()).rejects.toThrow('deliberate close failure')

  rawServer.close = originalClose
  await expect(server.stop()).resolves.toBe(true)
})

test('stop waits for handler completion after the client disconnects', async () => {
  const port = 21750 + Math.floor(Math.random() * 500)
  const server = new ODWebServer({ port, host: '127.0.0.1', gracefulShutdownTimeout: null })

  let releaseHandler: (() => void) | null = null
  let handlerStartedResolve: (() => void) | null = null
  const handlerStarted = new Promise<void>((resolve) => {
    handlerStartedResolve = resolve
  })

  await server.start(async () => {
    await new Promise<void>((resolve) => {
      releaseHandler = resolve
      handlerStartedResolve?.()
    })
    return new ODResponse(200, 'ok')
  })

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
    })
    socket.on('error', reject)
    socket.on('close', () => resolve())

    void handlerStarted.then(() => {
      socket.destroy()
    })
  })

  const stopPromise = server.stop()
  let stopTimeout: NodeJS.Timeout | null = null
  const stoppedEarly = await Promise.race([
    stopPromise.then(() => true),
    new Promise<boolean>((resolve) => {
      stopTimeout = setTimeout(() => {
        stopTimeout = null
        resolve(false)
      }, 50)
      stopTimeout.unref()
    }),
  ])
  if (stopTimeout) {
    clearTimeout(stopTimeout)
  }

  expect(stoppedEarly).toBe(false)

  releaseHandler?.()
  await stopPromise
})

test('stop() closes keep-alive sockets after in-flight requests become idle', async () => {
  const port = 21825 + Math.floor(Math.random() * 25)
  const server = new ODWebServer({ port, host: '127.0.0.1', gracefulShutdownTimeout: null })

  let releaseHandler: (() => void) | null = null
  let handlerStartedResolve: (() => void) | null = null
  const handlerStarted = new Promise<void>((resolve) => {
    handlerStartedResolve = resolve
  })

  await server.start(async () => {
    await new Promise<void>((resolve) => {
      releaseHandler = resolve
      handlerStartedResolve?.()
    })
    return new ODResponse(200, 'ok')
  })

  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
  const responseComplete = new Promise<void>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: '/', agent },
      (res) => {
        res.on('error', reject)
        res.resume()
        res.on('end', resolve)
      },
    )
    req.on('error', reject)
    req.end()
  })

  await handlerStarted
  const stopPromise = server.stop()
  releaseHandler?.()
  await responseComplete

  let closeTimer: NodeJS.Timeout | null = null
  try {
    const stoppedBeforeClientClosed = await Promise.race([
      stopPromise.then(() => true),
      new Promise<boolean>((resolve) => {
        closeTimer = setTimeout(() => {
          closeTimer = null
          agent.destroy()
          resolve(false)
        }, 200)
        closeTimer.unref()
      }),
    ])

    expect(stoppedBeforeClientClosed).toBe(true)
  } finally {
    if (closeTimer) {
      clearTimeout(closeTimer)
    }
    agent.destroy()
  }
})

test('stop() timeout resets stale request tracking before the next start', async () => {
  const port = 21850 + Math.floor(Math.random() * 500)
  const logger: ODLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  const server = new ODWebServer({ port, host: '127.0.0.1', gracefulShutdownTimeout: 20, logger })

  let handlerStartedResolve: (() => void) | null = null
  const handlerStarted = new Promise<void>((resolve) => {
    handlerStartedResolve = resolve
  })

  await server.start(async () => {
    await new Promise<void>(() => {
      handlerStartedResolve?.()
    })
    return new ODResponse(200, 'ok')
  })

  const clientClosed = new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
    })
    socket.on('error', reject)
    socket.on('close', () => resolve())
  })

  await handlerStarted
  expect(server.inFlightRequests).toBe(1)

  await server.stop()
  await clientClosed
  expect(server.inFlightRequests).toBe(0)

  await server.start(async () => new ODResponse(200, 'restarted'))

  let restartedStopTimeout: NodeJS.Timeout | null = null
  const restartedStopResolved = await Promise.race([
    server.stop(null).then(() => true),
    new Promise<boolean>((resolve) => {
      restartedStopTimeout = setTimeout(() => {
        restartedStopTimeout = null
        resolve(false)
      }, 50)
      restartedStopTimeout.unref()
    }),
  ])
  if (restartedStopTimeout) {
    clearTimeout(restartedStopTimeout)
  }

  expect(restartedStopResolved).toBe(true)
})

test('TLS: start() rejects when given invalid TLS credentials (covers https.createServer branch)', async () => {
  const port = 22000 + Math.floor(Math.random() * 500)
  // ca is included to cover the tls.ca ternary true-branch
  const server = new ODWebServer({
    port, host: '127.0.0.1',
    tls: { key: 'not-a-key', cert: 'not-a-cert', ca: 'not-a-ca' },
  })
  await expect(server.start(async () => new ODResponse(200, 'ok'))).rejects.toThrow()
  // Server never started so no stop() needed
})

test('TLS: start() without ca option covers the tls.ca ternary false-branch', async () => {
  const port = 22500 + Math.floor(Math.random() * 500)
  const server = new ODWebServer({
    port, host: '127.0.0.1',
    tls: { key: 'not-a-key', cert: 'not-a-cert' },  // no ca
  })
  await expect(server.start(async () => new ODResponse(200, 'ok'))).rejects.toThrow()
})
