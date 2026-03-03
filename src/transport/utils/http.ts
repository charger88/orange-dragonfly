import http from 'http'
import { Readable } from 'stream'
import type ODRequest from '../../core/request'
import type { ODRequestInit } from '../../core/request'
import ODResponse from '../../core/response'
import { ODLogger } from '../../core/logger'

export type RequestHandler = (req: ODRequest) => Promise<ODResponse>
export type ErrorHandler = (req: ODRequest, error: unknown) => ODResponse | null

/**
 * Minimal response interface satisfied by both http.ServerResponse and
 * http2.Http2ServerResponse, covering only what the framework needs to send a response.
 */
export interface IServerResponse {
  readonly writableEnded: boolean
  readonly headersSent: boolean
  statusCode: number
  setHeader(name: string, value: string | string[]): void
  writeHead(statusCode: number): void
  write(chunk: Buffer | string): boolean
  once(event: 'drain' | 'close' | 'finish', listener: () => void): void
  end(chunk?: Buffer | string | (() => void), callback?: () => void): void
  destroy(error?: Error): void
}

/**
 * Error raised when an incoming request body exceeds the configured maximum size during body collection.
 */
export class BodyTooLargeError extends Error {
  /**
   * Initializes internal state for this body Too Large Error.
   */
  constructor() {
    super('Payload Too Large')
    this.name = 'BodyTooLargeError'
  }
}

/**
 * Error raised when the client closes the request stream before the full body has been accepted.
 */
class RequestAbortedError extends Error {
  /**
   * Initializes internal state for this request aborted error.
   */
  constructor() {
    super('Request aborted')
    this.name = 'RequestAbortedError'
  }
}

/**
 * Converts Node.js IncomingHttpHeaders to a plain lowercase-keyed string record.
 * Array values are joined with ', '. HTTP/2 pseudo-headers are filtered out,
 * except ':authority', which is remapped to 'host'.
 *
 * @param headers Header entries.
 * @returns Headers as a plain lowercase string map.
 */
export function headersToObject(headers: http.IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {}
  let authority: string | undefined

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const normalizedValue = Array.isArray(value) ? value.join(', ') : value
    if (key === ':authority') {
      authority = normalizedValue
      continue
    }
    if (key.startsWith(':')) continue
    result[key] = normalizedValue
  }

  if (authority !== undefined) result.host = authority
  return result
}

/**
 * Collects a readable stream into a Buffer, enforcing an optional size limit.
 * Rejects with BodyTooLargeError if the limit is exceeded, or with the raw stream error otherwise.
 *
 * @param request Incoming request object.
 * @param maxBodySize Maximum allowed request body size in bytes, or null to disable the limit.
 * @returns A promise that resolves to the operation result.
 */
export function collectRequestBody(
  request: Readable,
  maxBodySize: number | null,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bodyBytes = 0
    let ended = false
    let finished = false

    /**
     * Completes the body collection successfully once all chunks have been accepted.
     */
    const resolveBody = () => {
      if (finished) return
      finished = true
      resolve(Buffer.concat(chunks))
    }

    /**
     * Fails the body collection exactly once.
     *
     * @param error Error to reject with.
     */
    const rejectBody = (error: Error) => {
      if (finished) return
      finished = true
      reject(error)
    }

    request.on('data', (chunk: Buffer) => {
      if (finished) return
      if (maxBodySize !== null) {
        bodyBytes += chunk.length
        if (bodyBytes > maxBodySize) {
          request.pause()
          rejectBody(new BodyTooLargeError())
          return
        }
      }
      chunks.push(chunk)
    })

    request.on('error', (e: Error) => {
      rejectBody(e)
    })

    // http2 can emit 'aborted' after 'end' but before the stream fully settles.
    request.on('aborted', () => {
      rejectBody(new RequestAbortedError())
    })

    request.on('close', () => {
      if (finished) return
      if (ended) {
        resolveBody()
        return
      }
      rejectBody(new RequestAbortedError())
    })

    request.on('end', () => {
      if (finished) return
      ended = true
      // Some transports emit 'aborted' after 'end'; defer final resolution briefly.
      setImmediate(resolveBody)
    })
  })
}

/**
 * Writes an ODResponse to a server response object.
 * Works with both http.ServerResponse and http2.Http2ServerResponse.
 * For Readable content, applies back-pressure: pauses the source stream when the
 * destination write buffer is full and resumes on the 'drain' event.
 *
 * @param serverResponse Underlying Node.js server response object.
 * @param odResponse Framework response object to send.
 */
export async function writeResponse(serverResponse: IServerResponse, odResponse: ODResponse): Promise<void> {
  if (odResponse.sent || serverResponse.writableEnded) return
  odResponse.markSent()

  // Group headers by (lowercase) name so that duplicate header names - most
  // importantly multiple Set-Cookie directives - are sent as an array rather
  // than having each call to setHeader() silently overwrite the previous one.
  let hasContentType = false
  const headerMap = new Map<string, { name: string; values: string[] }>()
  for (const header of odResponse.headers) {
    const lowerName = header.name.toLowerCase()
    if (lowerName === 'content-type') hasContentType = true
    const existing = headerMap.get(lowerName)
    if (existing) {
      existing.values.push(header.value)
    } else {
      headerMap.set(lowerName, { name: header.name, values: [header.value] })
    }
  }
  for (const { name, values } of headerMap.values()) {
    serverResponse.setHeader(name, values.length === 1 ? values[0] : values)
  }

  if (odResponse.content instanceof Readable) {
    const stream = odResponse.content
    await new Promise<void>((resolve, reject) => {
      let finished = false

      /**
       * Stops the source stream so it cannot keep reading after the response is gone.
       */
      const destroyStream = () => {
        if (!stream.destroyed) stream.destroy()
      }

      /**
       * Rejects the streaming response once and tears down the source stream.
       *
       * @param error Error to reject with.
       */
      const rejectWrite = (error: unknown) => {
        if (finished) return
        finished = true
        destroyStream()
        reject(error)
      }

      serverResponse.once('close', () => {
        if (finished) return
        finished = true
        destroyStream()
        resolve()
      })

      stream.on('error', (e: Error) => {
        rejectWrite(e)
      })
      stream.on('data', (chunk: Buffer | string) => {
        if (finished) return
        try {
          const ok = serverResponse.write(chunk)
          if (!ok) {
            // Kernel send buffer is full - pause the source until the destination drains.
            stream.pause()
            serverResponse.once('drain', () => {
              if (!finished && !stream.destroyed) stream.resume()
            })
          }
        } catch (e) {
          rejectWrite(e)
        }
      })
      stream.on('end', () => {
        if (finished) return
        try {
          if (!serverResponse.writableEnded) serverResponse.end()
          finished = true
          resolve()
        } catch (e) {
          rejectWrite(e)
        }
      })

      try {
        serverResponse.writeHead(odResponse.code)
      } catch (e) {
        rejectWrite(e)
      }
    })
    return
  }

  const [contentType, content] = await odResponse.convert()
  if (!hasContentType && contentType) {
    serverResponse.setHeader('Content-Type', contentType)
  }

  // Content-Length must be byte-accurate; convert strings to Buffer first.
  // Omit for 204/304 and 1xx responses which must not carry a body.
  const body = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
  const code = odResponse.code
  if (code !== 204 && code !== 304 && !(code >= 100 && code < 200)) {
    serverResponse.setHeader('Content-Length', String(body.length))
  }

  serverResponse.writeHead(code)
  serverResponse.end(body)
}

/**
 * Last-resort response when normal response sending fails.
 *
 * @param serverResponse Underlying Node.js server response object.
 */
export function writeFallbackResponse(serverResponse: IServerResponse): void {
  if (serverResponse.writableEnded) return
  if (!serverResponse.headersSent) {
    try {
      serverResponse.statusCode = 500
      serverResponse.setHeader('Content-Type', 'application/json')
      serverResponse.end(JSON.stringify({ error: 'Internal Server Error' }))
    } catch {
      serverResponse.destroy()
    }
    return
  }
  try {
    serverResponse.end()
  } catch {
    serverResponse.destroy()
  }
}

/**
 * Attaches SIGINT/SIGTERM handlers that invoke the stop function.
 * Skips signals that already have a handler registered in the provided map.
 *
 * @param handlers Map of installed signal handlers.
 * @param logger Logger used for diagnostics.
 * @param stop Shutdown callback.
 */
export function attachSignalHandlers(
  handlers: Map<'SIGINT' | 'SIGTERM', () => void>,
  logger: ODLogger,
  stop: () => Promise<void>,
): void {
  const signals: Array<'SIGINT' | 'SIGTERM'> = ['SIGINT', 'SIGTERM']
  for (const signal of signals) {
    if (handlers.has(signal)) continue
    /**
     * Signal callback that triggers graceful shutdown and logs shutdown failures.
     */
    const handler = () => {
      void stop().catch((e) => logger.error(`Failed to shutdown on ${signal}`, e))
    }
    process.on(signal, handler)
    handlers.set(signal, handler)
  }
}

/**
 * Removes all signal handlers previously registered via attachSignalHandlers.
 *
 * @param handlers Map of installed signal handlers.
 */
export function detachSignalHandlers(
  handlers: Map<'SIGINT' | 'SIGTERM', () => void>,
): void {
  for (const [signal, handler] of handlers) {
    process.off(signal, handler)
  }
  handlers.clear()
}

// ---------------------------------------------------------------------------
// Shared option validators used by both ODWebServer and ODHttp2WebServer.
// ---------------------------------------------------------------------------

export function validatePort(v: unknown): void {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 65535) throw new Error('port must be an integer between 1 and 65535')
}

/**
 * Validates host and throws when the supplied value is invalid.
 *
 * @param v Input value.
 */
export function validateHost(v: unknown): void {
  if (typeof v !== 'string' || v.length === 0) throw new Error('host must be a non-empty string')
}

/**
 * Validates tls and throws when the supplied value is invalid.
 *
 * @param v Input value.
 */
export function validateTls(v: unknown): void {
  if (v === undefined || v === null) return
  if (typeof v !== 'object') throw new Error('tls must be an object with key and cert')
  const t = v as Record<string, unknown>
  if (!t['key'] || !t['cert']) throw new Error('tls.key and tls.cert are required')
}

/**
 * Validates max Body Size and throws when the supplied value is invalid.
 *
 * @param v Input value.
 */
export function validateMaxBodySize(v: unknown): void {
  if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) throw new Error('maxBodySize must be a positive number or null')
}

/**
 * Validates request Timeout and throws when the supplied value is invalid.
 *
 * @param v Input value.
 */
export function validateRequestTimeout(v: unknown): void {
  if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) throw new Error('requestTimeout must be a positive number (ms) or null')
}

/**
 * Validates graceful Shutdown Timeout and throws when the supplied value is invalid.
 *
 * @param v Input value.
 */
export function validateGracefulShutdownTimeout(v: unknown): void {
  if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) throw new Error('gracefulShutdownTimeout must be a positive number (ms) or null')
}

/**
 * Validates handle Process Signals and throws when the supplied value is invalid.
 *
 * @param v Input value.
 */
export function validateHandleProcessSignals(v: unknown): void {
  if (typeof v !== 'boolean') throw new Error('handleProcessSignals must be a boolean')
}

/**
 * Validates logger and throws when the supplied value is invalid.
 *
 * @param v Input value.
 */
export function validateLogger(v: unknown): void {
  if (typeof v !== 'object' || v === null) {
    throw new Error('logger must be an object with error, warn, and info methods')
  }
  const logger = v as Partial<ODLogger>
  if (
    typeof logger.error !== 'function'
    || typeof logger.warn !== 'function'
    || typeof logger.info !== 'function'
  ) {
    throw new Error('logger must be an object with error, warn, and info methods')
  }
}

/**
 * Validates errorHandler and throws when the supplied value is invalid.
 *
 * @param v Input value.
 */
export function validateErrorHandler(v: unknown): void {
  if (v === undefined || v === null) return
  if (typeof v !== 'function') throw new Error('errorHandler must be a function or null')
}

// ---------------------------------------------------------------------------
// Shared request-processing helpers used by ODWebServer and ODHttp2WebServer.
// ---------------------------------------------------------------------------

/**
 * Minimal request interface satisfied by both http.IncomingMessage and
 * http2.Http2ServerRequest, covering only what processServerRequest needs.
 */
export interface IServerRequest extends Readable {
  readonly method?: string
  readonly url?: string
  readonly headers: http.IncomingHttpHeaders
  readonly socket: { readonly remoteAddress?: string } | null | undefined
}

/**
 * Sends an ODResponse to the client, logging and sending a fallback on error.
 * Always calls onComplete() regardless of outcome.
 *
 * @param response Server response object.
 * @param odResponse Framework response object to send.
 * @param onComplete Completion callback that finalizes request bookkeeping.
 * @param logger Logger used for diagnostics.
 * @param sendFn Optional response writer override.
 */
export async function sendSafe(
  response: IServerResponse,
  odResponse: ODResponse,
  onComplete: () => void,
  logger: ODLogger,
  sendFn?: (response: IServerResponse, odResponse: ODResponse) => Promise<void>,
): Promise<void> {
  try {
    await (sendFn ?? writeResponse)(response, odResponse)
  } catch (e) {
    logger.error('Failed to send response', e)
    writeFallbackResponse(response)
  } finally {
    onComplete()
  }
}

/**
 * Full request lifecycle: collect body -> build ODRequest -> invoke handler -> send response.
 * Shared by ODWebServer and ODHttp2WebServer.
 *
 * @param request Incoming request object.
 * @param response Server response object.
 * @param handler Callback function.
 * @param makeRequest Factory that creates an ODRequest instance from transport request data.
 * @param makeResponse Factory that creates an ODResponse instance.
 * @param maxBodySize Maximum allowed request body size in bytes, or null to disable the limit.
 * @param onComplete Completion callback that finalizes request bookkeeping.
 * @param logger Logger used for diagnostics.
 * @param getErrorHandler Callback that returns the active error handler.
 * @param protocol Transport protocol used to construct request URLs.
 * @param sendFn Optional response writer override.
 */
export async function processServerRequest(
  request: IServerRequest,
  response: IServerResponse,
  handler: RequestHandler,
  makeRequest: (init: ODRequestInit) => ODRequest,
  makeResponse: () => ODResponse,
  maxBodySize: number | null,
  onComplete: () => void,
  logger: ODLogger,
  getErrorHandler: () => ErrorHandler | null,
  protocol: 'http' | 'https',
  sendFn?: (response: IServerResponse, odResponse: ODResponse) => Promise<void>,
): Promise<void> {
  request.on('error', (e: Error) => {
    logger.warn('Request stream failed', e)
  })

  let body: Buffer
  try {
    body = await collectRequestBody(request, maxBodySize)
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      response.once('finish', () => {
        try {
          response.destroy()
        } catch {
          // Ignore teardown failures while forcibly closing an oversized request.
        }
      })
      const res = makeResponse()
      res.setError(413, 'Payload Too Large')
      await sendSafe(response, res, onComplete, logger, sendFn)
    } else {
      // Stream errors are already logged above; client aborts are intentionally silent.
      onComplete()
    }
    return
  }

  let req: ODRequest
  try {
    req = makeRequest({
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      headers: headersToObject(request.headers),
      body,
      ip: request.socket?.remoteAddress,
      protocol,
    })
  } catch (e) {
    logger.warn('Malformed request', e)
    const badRequest = makeResponse()
    badRequest.setError(400, 'Bad request')
    await sendSafe(response, badRequest, onComplete, logger, sendFn)
    return
  }

  try {
    const res = await handler(req)
    await sendSafe(response, res, onComplete, logger, sendFn)
  } catch (e) {
    logger.error('Request handling failed', { requestId: req.id, error: e })
    const errorHandler = getErrorHandler()
    let res: ODResponse | null = null
    if (errorHandler) {
      try {
        res = errorHandler(req, e)
      } catch (eh) {
        logger.error('Custom error handler failed', { requestId: req.id, error: eh })
      }
    }
    if (!res) {
      res = makeResponse().setError(500, 'Internal Server Error')
    }
    await sendSafe(response, res, onComplete, logger, sendFn)
  }
}
