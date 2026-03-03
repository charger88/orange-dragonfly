import { Readable } from 'stream'
import ODResponse from '../src/core/response'
import {
  BodyTooLargeError,
  headersToObject,
  collectRequestBody,
  writeResponse,
  writeFallbackResponse,
  attachSignalHandlers,
  detachSignalHandlers,
  validatePort,
  validateHost,
  validateTls,
  validateMaxBodySize,
  validateRequestTimeout,
  validateGracefulShutdownTimeout,
  validateHandleProcessSignals,
  processServerRequest,
  type IServerResponse,
  type IServerRequest,
} from '../src/transport/utils/http'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServerResponse(overrides: Partial<{
  writableEnded: boolean
  headersSent: boolean
  statusCode: number
  setHeader: jest.Mock
  writeHead: jest.Mock
  write: jest.Mock
  once: jest.Mock
  end: jest.Mock
  destroy: jest.Mock
}> = {}): IServerResponse {
  return {
    writableEnded: false,
    headersSent: false,
    statusCode: 200,
    setHeader: jest.fn(),
    writeHead: jest.fn(),
    write: jest.fn().mockReturnValue(true),
    once: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
    ...overrides,
  } as unknown as IServerResponse
}

// ---------------------------------------------------------------------------

describe('BodyTooLargeError', () => {
  test('is an instance of Error', () => {
    expect(new BodyTooLargeError()).toBeInstanceOf(Error)
  })

  test('has correct name and message', () => {
    const e = new BodyTooLargeError()
    expect(e.name).toBe('BodyTooLargeError')
    expect(e.message).toBe('Payload Too Large')
  })
})

// ---------------------------------------------------------------------------

describe('headersToObject', () => {
  test('returns plain string values unchanged', () => {
    expect(headersToObject({ 'content-type': 'text/plain', 'x-custom': 'val' }))
      .toEqual({ 'content-type': 'text/plain', 'x-custom': 'val' })
  })

  test('joins array values with ", "', () => {
    expect(headersToObject({ accept: ['application/json', 'text/html'] }))
      .toEqual({ accept: 'application/json, text/html' })
  })

  test('filters out undefined values', () => {
    expect(headersToObject({ 'x-forwarded-for': undefined })).toEqual({})
  })

  test('filters out HTTP/2 pseudo-headers starting with ":"', () => {
    expect(headersToObject({ ':method': 'GET', ':path': '/', host: 'example.com' }))
      .toEqual({ host: 'example.com' })
  })

  test('maps HTTP/2 :authority to host and prefers it over host', () => {
    expect(headersToObject({
      ':method': 'GET',
      ':authority': 'example.com:8443',
      host: 'ignored.example.com',
    })).toEqual({ host: 'example.com:8443' })
  })

  test('returns empty object for empty headers', () => {
    expect(headersToObject({})).toEqual({})
  })
})

// ---------------------------------------------------------------------------

describe('collectRequestBody', () => {
  test('collects stream chunks into a Buffer', async () => {
    const readable = new Readable({
      read() { this.push(Buffer.from('hello ')); this.push(Buffer.from('world')); this.push(null) },
    })
    const result = await collectRequestBody(readable, null)
    expect(result.toString()).toBe('hello world')
  })

  test('resolves with empty Buffer for empty stream', async () => {
    const readable = new Readable({ read() { this.push(null) } })
    const result = await collectRequestBody(readable, null)
    expect(result.length).toBe(0)
  })

  test('rejects with BodyTooLargeError when body exceeds maxBodySize', async () => {
    const readable = new Readable({
      read() { this.push(Buffer.from('hello world')); this.push(null) },
    })
    await expect(collectRequestBody(readable, 5)).rejects.toBeInstanceOf(BodyTooLargeError)
  })

  test('resolves when body is exactly at the limit', async () => {
    const readable = new Readable({
      read() { this.push(Buffer.from('hello')); this.push(null) },
    })
    const result = await collectRequestBody(readable, 5)
    expect(result.toString()).toBe('hello')
  })

  test('accepts unlimited body when maxBodySize is null', async () => {
    const big = Buffer.alloc(10_000, 'x')
    const readable = new Readable({
      read() { this.push(big); this.push(null) },
    })
    const result = await collectRequestBody(readable, null)
    expect(result.length).toBe(10_000)
  })

  test('rejects with the stream error when an error event is emitted', async () => {
    const readable = new Readable({
      read() { this.destroy(new Error('read error')) },
    })
    await expect(collectRequestBody(readable, null)).rejects.toThrow('read error')
  })

  test('data event after finished (guard line): second chunk after limit exceeded is ignored', async () => {
    // Push two chunks: first exceeds the limit, second should hit the finished guard
    const readable = new Readable({
      read() {
        this.push(Buffer.from('12345678'))  // 8 bytes - exceeds limit of 4
        this.push(Buffer.from('ABCDEFGH'))  // 8 more bytes - should be ignored by guard
        this.push(null)
      },
    })
    await expect(collectRequestBody(readable, 4)).rejects.toBeInstanceOf(BodyTooLargeError)
    // If the guard was not present, we'd get double-rejection; no assertion needed beyond rejects
  })

  test('error event after finished (guard line): error after stream end is swallowed', async () => {
    let capturedStream: Readable | null = null
    const readable = new Readable({
      read() {
        capturedStream = this
        this.push(Buffer.from('hello'))
        this.push(null)
      },
    })
    await collectRequestBody(readable, null)
    // Stream has ended -> finished = true. Emitting an error now should be swallowed by the guard.
    // If the guard were absent this would cause an unhandled double-rejection.
    capturedStream!.emit('error', new Error('late error'))
    // No assertion - the test passes if no uncaught error is thrown
  })

  test('rejects when the request is aborted after end but before body collection settles', async () => {
    const readable = new Readable({
      autoDestroy: false,
      read() {
        this.push(Buffer.from('hello'))
        this.push(null)
        process.nextTick(() => this.emit('aborted'))
      },
    })

    await expect(collectRequestBody(readable, null)).rejects.toThrow('Request aborted')
  })
})

// ---------------------------------------------------------------------------

describe('writeResponse', () => {
  test('returns early without writing if odResponse.sent is true', async () => {
    const serverRes = makeServerResponse()
    const odRes = new ODResponse(200, 'hello')
    odRes.markSent()
    await writeResponse(serverRes, odRes)
    expect(serverRes.writeHead).not.toHaveBeenCalled()
  })

  test('returns early without writing if serverResponse.writableEnded is true', async () => {
    const serverRes = makeServerResponse({ writableEnded: true })
    const odRes = new ODResponse(200, 'hello')
    await writeResponse(serverRes, odRes)
    expect(serverRes.writeHead).not.toHaveBeenCalled()
  })

  test('marks the response as sent', async () => {
    const serverRes = makeServerResponse()
    const odRes = new ODResponse(200, 'hello')
    await writeResponse(serverRes, odRes)
    expect(odRes.sent).toBe(true)
  })

  test('sets a single-value header', async () => {
    const serverRes = makeServerResponse()
    const odRes = new ODResponse(200, 'hello', [{ name: 'X-Custom', value: 'v1' }])
    await writeResponse(serverRes, odRes)
    expect(serverRes.setHeader).toHaveBeenCalledWith('X-Custom', 'v1')
  })

  test('groups duplicate Set-Cookie headers into an array', async () => {
    const serverRes = makeServerResponse()
    const odRes = new ODResponse(200, 'hello', [
      { name: 'Set-Cookie', value: 'a=1' },
      { name: 'Set-Cookie', value: 'b=2' },
    ])
    await writeResponse(serverRes, odRes)
    expect(serverRes.setHeader).toHaveBeenCalledWith('Set-Cookie', ['a=1', 'b=2'])
  })

  test('sets Content-Type from convert() when not present in headers', async () => {
    const serverRes = makeServerResponse()
    const odRes = new ODResponse(200, { foo: 'bar' })
    await writeResponse(serverRes, odRes)
    expect(serverRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8')
  })

  test('sets Content-Length for non-streaming responses', async () => {
    const serverRes = makeServerResponse()
    const odRes = new ODResponse(200, { foo: 'bar' })
    await writeResponse(serverRes, odRes)
    const expectedLength = Buffer.byteLength(JSON.stringify({ foo: 'bar' }), 'utf-8')
    expect(serverRes.setHeader).toHaveBeenCalledWith('Content-Length', String(expectedLength))
  })

  test('does not set Content-Length for 204 responses', async () => {
    const serverRes = makeServerResponse()
    const odRes = new ODResponse(204)
    await writeResponse(serverRes, odRes)
    const calls = (serverRes.setHeader as jest.Mock).mock.calls
    expect(calls.some(([name]: [string]) => name === 'Content-Length')).toBe(false)
  })

  test('does not set Content-Length for 304 responses', async () => {
    const serverRes = makeServerResponse()
    const odRes = new ODResponse(304)
    await writeResponse(serverRes, odRes)
    const calls = (serverRes.setHeader as jest.Mock).mock.calls
    expect(calls.some(([name]: [string]) => name === 'Content-Length')).toBe(false)
  })

  test('Content-Length uses byte length for multibyte strings', async () => {
    const serverRes = makeServerResponse()
    const odRes = new ODResponse(200, 'héllo')
    await writeResponse(serverRes, odRes)
    const expected = Buffer.byteLength('héllo', 'utf-8')
    expect(serverRes.setHeader).toHaveBeenCalledWith('Content-Length', String(expected))
  })

  test('does not override Content-Type already present in headers', async () => {
    const serverRes = makeServerResponse()
    const odRes = new ODResponse(200, { foo: 'bar' }, [
      { name: 'Content-Type', value: 'text/plain' },
    ])
    await writeResponse(serverRes, odRes)
    const ctCalls = (serverRes.setHeader as jest.Mock).mock.calls
      .filter(([name]: [string]) => name.toLowerCase() === 'content-type')
    expect(ctCalls).toHaveLength(1)
    expect(ctCalls[0][1]).toBe('text/plain')
  })

  test('writes status code via writeHead', async () => {
    const serverRes = makeServerResponse()
    const odRes = new ODResponse(201, 'created')
    await writeResponse(serverRes, odRes)
    expect(serverRes.writeHead).toHaveBeenCalledWith(201)
  })

  test('streams Readable content and ends the response', async () => {
    const serverRes = makeServerResponse()
    const readable = Readable.from(['chunk1', 'chunk2'])
    const odRes = new ODResponse(200, readable)
    await writeResponse(serverRes, odRes)
    expect(serverRes.writeHead).toHaveBeenCalledWith(200)
    expect(serverRes.write).toHaveBeenCalled()
    expect(serverRes.end).toHaveBeenCalled()
  })

  test('rejects when the stream emits an error', async () => {
    const serverRes = makeServerResponse()
    const readable = new Readable({
      read() { this.destroy(new Error('stream broken')) },
    })
    const odRes = new ODResponse(200, readable)
    await expect(writeResponse(serverRes, odRes)).rejects.toThrow('stream broken')
  })

  test('destroys a non-auto-destroying source stream when it emits an error', async () => {
    const serverRes = makeServerResponse()
    const readable = new Readable({
      autoDestroy: false,
      read() {},
    })
    const destroySpy = jest.spyOn(readable, 'destroy')

    const writePromise = writeResponse(serverRes, new ODResponse(200, readable))
    readable.emit('error', new Error('stream broken'))

    await expect(writePromise).rejects.toThrow('stream broken')
    expect(destroySpy).toHaveBeenCalled()
  })

  test('pauses stream on back-pressure and resumes after drain', async () => {
    let drainCallback: (() => void) | null = null
    const serverRes: IServerResponse = {
      writableEnded: false,
      headersSent: false,
      statusCode: 200,
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      write: jest.fn().mockReturnValueOnce(false).mockReturnValue(true),
      once: jest.fn((event: string, cb: () => void) => {
        if (event === 'drain') drainCallback = cb
      }),
      end: jest.fn(),
      destroy: jest.fn(),
    }

    const readable = new Readable({ read() {} })
    const pauseSpy = jest.spyOn(readable, 'pause')

    const writePromise = writeResponse(serverRes, new ODResponse(200, readable))

    // Push one chunk - 'data' may fire synchronously or on the next tick
    readable.push(Buffer.from('chunk'))
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(pauseSpy).toHaveBeenCalled()
    expect(drainCallback).not.toBeNull()

    // Spy on resume only now so we capture only the drain-triggered call
    const resumeSpy = jest.spyOn(readable, 'resume')
    drainCallback!()
    expect(resumeSpy).toHaveBeenCalled()

    // End the stream so writePromise resolves
    readable.push(null)
    await writePromise
  })

  test('destroys the source stream when the response closes before the stream ends', async () => {
    let closeCallback: (() => void) | null = null
    const serverRes: IServerResponse = {
      writableEnded: false,
      headersSent: false,
      statusCode: 200,
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      write: jest.fn().mockReturnValue(true),
      once: jest.fn((event: string, cb: () => void) => {
        if (event === 'close') closeCallback = cb
      }),
      end: jest.fn(),
      destroy: jest.fn(),
    }

    const readable = new Readable({ read() {} })
    const destroySpy = jest.spyOn(readable, 'destroy')
    const writePromise = writeResponse(serverRes, new ODResponse(200, readable))

    expect(closeCallback).not.toBeNull()
    closeCallback!()

    await writePromise

    expect(destroySpy).toHaveBeenCalled()
    expect(serverRes.end).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------

describe('writeFallbackResponse', () => {
  test('does nothing when writableEnded is true', () => {
    const serverRes = makeServerResponse({ writableEnded: true })
    writeFallbackResponse(serverRes)
    expect(serverRes.end).not.toHaveBeenCalled()
  })

  test('sends 500 JSON when headers have not been sent', () => {
    const serverRes = makeServerResponse({ headersSent: false })
    writeFallbackResponse(serverRes)
    const raw = serverRes as unknown as { statusCode: number }
    expect(raw.statusCode).toBe(500)
    expect(serverRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
    expect(serverRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Internal Server Error' }))
  })

  test('calls end() when headers are already sent', () => {
    const serverRes = makeServerResponse({ headersSent: true })
    writeFallbackResponse(serverRes)
    expect(serverRes.end).toHaveBeenCalled()
  })

  test('calls destroy() when end() throws and headers are already sent', () => {
    const serverRes = makeServerResponse({
      headersSent: true,
      end: jest.fn(() => { throw new Error('end failed') }),
    })
    writeFallbackResponse(serverRes)
    expect(serverRes.destroy).toHaveBeenCalled()
  })

  test('calls destroy() when setHeader throws and headers have not been sent', () => {
    const serverRes = makeServerResponse({
      headersSent: false,
      setHeader: jest.fn(() => { throw new Error('setHeader failed') }),
    })
    writeFallbackResponse(serverRes)
    expect(serverRes.destroy).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------

describe('attachSignalHandlers / detachSignalHandlers', () => {
  test('registers handlers for SIGINT and SIGTERM', () => {
    const handlers = new Map<'SIGINT' | 'SIGTERM', () => void>()
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const stop = jest.fn().mockResolvedValue(undefined)

    const beforeSigint = process.listenerCount('SIGINT')
    const beforeSigterm = process.listenerCount('SIGTERM')

    attachSignalHandlers(handlers, logger, stop)

    expect(handlers.size).toBe(2)
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint + 1)
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm + 1)

    detachSignalHandlers(handlers)
  })

  test('skips signals that already have a handler in the map', () => {
    const handlers = new Map<'SIGINT' | 'SIGTERM', () => void>()
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const stop = jest.fn().mockResolvedValue(undefined)

    attachSignalHandlers(handlers, logger, stop)
    const countAfterFirst = process.listenerCount('SIGINT')
    attachSignalHandlers(handlers, logger, stop) // second call is a no-op

    expect(process.listenerCount('SIGINT')).toBe(countAfterFirst)

    detachSignalHandlers(handlers)
  })

  test('detachSignalHandlers removes all handlers and clears the map', () => {
    const handlers = new Map<'SIGINT' | 'SIGTERM', () => void>()
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const stop = jest.fn().mockResolvedValue(undefined)

    attachSignalHandlers(handlers, logger, stop)
    const sigintAfterAttach = process.listenerCount('SIGINT')
    const sigtermAfterAttach = process.listenerCount('SIGTERM')

    detachSignalHandlers(handlers)

    expect(handlers.size).toBe(0)
    expect(process.listenerCount('SIGINT')).toBe(sigintAfterAttach - 1)
    expect(process.listenerCount('SIGTERM')).toBe(sigtermAfterAttach - 1)
  })

  test('handler invokes stop() when called', async () => {
    const handlers = new Map<'SIGINT' | 'SIGTERM', () => void>()
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const stop = jest.fn().mockResolvedValue(undefined)

    attachSignalHandlers(handlers, logger, stop)
    handlers.get('SIGINT')!()
    expect(stop).toHaveBeenCalledTimes(1)

    detachSignalHandlers(handlers)
  })

  test('handler logs error when stop() rejects', async () => {
    const handlers = new Map<'SIGINT' | 'SIGTERM', () => void>()
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const stop = jest.fn().mockRejectedValue(new Error('shutdown failed'))

    attachSignalHandlers(handlers, logger, stop)
    handlers.get('SIGTERM')!()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('SIGTERM'),
      expect.any(Error),
    )

    detachSignalHandlers(handlers)
  })
})

// ---------------------------------------------------------------------------

describe('validatePort', () => {
  test('accepts positive integers', () => {
    expect(() => validatePort(1)).not.toThrow()
    expect(() => validatePort(8080)).not.toThrow()
    expect(() => validatePort(65535)).not.toThrow()
  })

  test('rejects zero, negatives, floats, out-of-range, and non-numbers', () => {
    expect(() => validatePort(0)).toThrow('port must be an integer between 1 and 65535')
    expect(() => validatePort(-1)).toThrow('port must be an integer between 1 and 65535')
    expect(() => validatePort(1.5)).toThrow('port must be an integer between 1 and 65535')
    expect(() => validatePort('80')).toThrow('port must be an integer between 1 and 65535')
    expect(() => validatePort(65536)).toThrow('port must be an integer between 1 and 65535')
    expect(() => validatePort(99999)).toThrow('port must be an integer between 1 and 65535')
  })
})

describe('validateHost', () => {
  test('accepts non-empty strings', () => {
    expect(() => validateHost('0.0.0.0')).not.toThrow()
    expect(() => validateHost('localhost')).not.toThrow()
  })

  test('rejects empty string and non-strings', () => {
    expect(() => validateHost('')).toThrow('host must be a non-empty string')
    expect(() => validateHost(123)).toThrow('host must be a non-empty string')
  })
})

describe('validateTls', () => {
  test('accepts null and undefined (no TLS)', () => {
    expect(() => validateTls(null)).not.toThrow()
    expect(() => validateTls(undefined)).not.toThrow()
  })

  test('accepts an object with both key and cert', () => {
    expect(() => validateTls({ key: 'k', cert: 'c' })).not.toThrow()
  })

  test('rejects a non-object value', () => {
    expect(() => validateTls('tls-string')).toThrow('tls must be an object with key and cert')
    expect(() => validateTls(42)).toThrow('tls must be an object with key and cert')
  })

  test('rejects an object missing key or cert', () => {
    expect(() => validateTls({ key: 'k' })).toThrow('tls.key and tls.cert are required')
    expect(() => validateTls({ cert: 'c' })).toThrow('tls.key and tls.cert are required')
    expect(() => validateTls({})).toThrow('tls.key and tls.cert are required')
  })
})

describe('validateMaxBodySize', () => {
  test('accepts positive numbers', () => {
    expect(() => validateMaxBodySize(1)).not.toThrow()
    expect(() => validateMaxBodySize(1_048_576)).not.toThrow()
  })

  test('accepts null (unlimited)', () => {
    expect(() => validateMaxBodySize(null)).not.toThrow()
  })

  test('rejects zero, negatives, and non-numbers', () => {
    expect(() => validateMaxBodySize(0)).toThrow('maxBodySize must be a positive number or null')
    expect(() => validateMaxBodySize(-1)).toThrow('maxBodySize must be a positive number or null')
    expect(() => validateMaxBodySize('1024')).toThrow('maxBodySize must be a positive number or null')
  })

  test('rejects NaN and Infinity', () => {
    expect(() => validateMaxBodySize(NaN)).toThrow('maxBodySize must be a positive number or null')
    expect(() => validateMaxBodySize(Infinity)).toThrow('maxBodySize must be a positive number or null')
  })
})

describe('validateRequestTimeout', () => {
  test('accepts positive numbers', () => {
    expect(() => validateRequestTimeout(5000)).not.toThrow()
  })

  test('accepts null', () => {
    expect(() => validateRequestTimeout(null)).not.toThrow()
  })

  test('rejects zero and negatives', () => {
    expect(() => validateRequestTimeout(0)).toThrow('requestTimeout must be a positive number (ms) or null')
    expect(() => validateRequestTimeout(-1)).toThrow('requestTimeout must be a positive number (ms) or null')
  })

  test('rejects NaN and Infinity', () => {
    expect(() => validateRequestTimeout(NaN)).toThrow('requestTimeout must be a positive number (ms) or null')
    expect(() => validateRequestTimeout(Infinity)).toThrow('requestTimeout must be a positive number (ms) or null')
  })
})

describe('validateGracefulShutdownTimeout', () => {
  test('accepts positive numbers', () => {
    expect(() => validateGracefulShutdownTimeout(10_000)).not.toThrow()
  })

  test('accepts null', () => {
    expect(() => validateGracefulShutdownTimeout(null)).not.toThrow()
  })

  test('rejects zero and negatives', () => {
    expect(() => validateGracefulShutdownTimeout(0)).toThrow('gracefulShutdownTimeout must be a positive number (ms) or null')
    expect(() => validateGracefulShutdownTimeout(-1)).toThrow('gracefulShutdownTimeout must be a positive number (ms) or null')
  })

  test('rejects NaN and Infinity', () => {
    expect(() => validateGracefulShutdownTimeout(NaN)).toThrow('gracefulShutdownTimeout must be a positive number (ms) or null')
    expect(() => validateGracefulShutdownTimeout(Infinity)).toThrow('gracefulShutdownTimeout must be a positive number (ms) or null')
  })
})

describe('validateHandleProcessSignals', () => {
  test('accepts booleans', () => {
    expect(() => validateHandleProcessSignals(true)).not.toThrow()
    expect(() => validateHandleProcessSignals(false)).not.toThrow()
  })

  test('rejects non-booleans', () => {
    expect(() => validateHandleProcessSignals(1)).toThrow('handleProcessSignals must be a boolean')
    expect(() => validateHandleProcessSignals('true')).toThrow('handleProcessSignals must be a boolean')
  })
})

// ---------------------------------------------------------------------------

describe('processServerRequest', () => {
  test('uses custom sendFn for malformed request responses (400)', async () => {
    const request = Readable.from([]) as unknown as IServerRequest
    ;(request as unknown as Record<string, unknown>).method = 'GET'
    ;(request as unknown as Record<string, unknown>).url = '/'
    ;(request as unknown as Record<string, unknown>).headers = { host: 'example.com' }
    ;(request as unknown as Record<string, unknown>).socket = { remoteAddress: '127.0.0.1' }

    const serverRes = makeServerResponse()
    const handler = jest.fn(async () => new ODResponse(200, 'ok'))
    const makeRequest = jest.fn(() => { throw new Error('bad request object') })
    const makeResponse = () => new ODResponse()
    const onComplete = jest.fn()
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const sendFn = jest.fn(async () => undefined)

    await processServerRequest(
      request,
      serverRes,
      handler,
      makeRequest,
      makeResponse,
      null,
      onComplete,
      logger,
      () => null,
      'http',
      sendFn,
    )

    expect(sendFn).toHaveBeenCalledTimes(1)
    const sentResponse = sendFn.mock.calls[0][1] as unknown as ODResponse
    expect(sentResponse.code).toBe(400)
    expect(sentResponse.content).toEqual({ error: 'Bad request' })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  test('hard-closes the response after flushing a 413 for oversized bodies', async () => {
    const request = Readable.from([Buffer.from('12345678')]) as unknown as IServerRequest
    ;(request as unknown as Record<string, unknown>).method = 'POST'
    ;(request as unknown as Record<string, unknown>).url = '/'
    ;(request as unknown as Record<string, unknown>).headers = { host: 'example.com' }
    ;(request as unknown as Record<string, unknown>).socket = { remoteAddress: '127.0.0.1' }

    let finishCallback: (() => void) | null = null
    const serverRes: IServerResponse = {
      writableEnded: false,
      headersSent: false,
      statusCode: 200,
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      write: jest.fn().mockReturnValue(true),
      once: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishCallback = cb
      }),
      end: jest.fn(),
      destroy: jest.fn(),
    }
    const handler = jest.fn(async () => new ODResponse(200, 'ok'))
    const makeRequest = jest.fn()
    const makeResponse = () => new ODResponse()
    const onComplete = jest.fn()
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
    const sendFn = jest.fn(async (_response: IServerResponse, odResponse: ODResponse) => {
      expect(odResponse.code).toBe(413)
      finishCallback?.()
    })

    await processServerRequest(
      request,
      serverRes,
      handler,
      makeRequest,
      makeResponse,
      4,
      onComplete,
      logger,
      () => null,
      'http',
      sendFn,
    )

    expect(handler).not.toHaveBeenCalled()
    expect(makeRequest).not.toHaveBeenCalled()
    expect(sendFn).toHaveBeenCalledTimes(1)
    expect(serverRes.destroy).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
