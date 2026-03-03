import http2 from 'http2'
import type { IncomingMessage, ServerResponse } from 'http'
import type { Socket } from 'net'
import ODRequest, { ODRequestInit } from '../core/request'
import ODResponse from '../core/response'
import ODApp from '../core/app'
import { ODLogger, defaultLogger } from '../core/logger'
import {
  RequestHandler,
  ErrorHandler,
  IServerResponse,
  writeResponse,
  attachSignalHandlers as _attachSignalHandlers,
  detachSignalHandlers as _detachSignalHandlers,
  validatePort,
  validateHost,
  validateTls,
  validateMaxBodySize,
  validateGracefulShutdownTimeout,
  validateHandleProcessSignals,
  validateLogger,
  validateErrorHandler,
  processServerRequest,
} from './utils/http'

export type { RequestHandler, ErrorHandler }

/**
 * TLS credentials for the HTTP/2 server.
 * Required for standard h2 (TLS). Omit to use h2c (cleartext, e.g. behind a TLS-terminating proxy).
 */
export interface Http2TlsOptions {
  key: Buffer | string
  cert: Buffer | string
  ca?: Buffer | string
  /** Allow HTTP/1.1 clients to connect via TLS fallback. Default: true. When false, non-HTTP/2 TLS clients are dropped immediately. */
  allowHTTP1?: boolean
}

export interface ODHttp2WebServerOptions {
  port?: number
  host?: string
  /** TLS credentials. Required for h2. Omit for h2c (cleartext HTTP/2). */
  tls?: Http2TlsOptions
  errorHandler?: ErrorHandler | null
  maxBodySize?: number | null
  gracefulShutdownTimeout?: number | null
  handleProcessSignals?: boolean
  logger?: ODLogger
}

interface ServerStartOptions {
  createResponse?: () => ODResponse
  createRequest?: (init: ODRequestInit) => ODRequest
}

type ResolvedODHttp2Options = {
  port: number
  host: string
  tls: Http2TlsOptions | undefined
  errorHandler: ErrorHandler | null
  maxBodySize: number | null
  gracefulShutdownTimeout: number | null
  handleProcessSignals: boolean
  logger: ODLogger
}

const SOCKET_ID = Symbol('odHttp2WebServerSocketId')

const DEFAULT_OPTIONS: ResolvedODHttp2Options = {
  port: 8888,
  host: '0.0.0.0',
  tls: undefined,
  errorHandler: null,
  maxBodySize: 1_048_576,
  gracefulShutdownTimeout: 10_000,
  handleProcessSignals: true,
  logger: defaultLogger,
}

const OPTION_VALIDATORS: Partial<Record<keyof ODHttp2WebServerOptions, (value: unknown) => void>> = {
  port: validatePort,
  host: validateHost,
  tls: validateTls,
  errorHandler: validateErrorHandler,
  maxBodySize: validateMaxBodySize,
  gracefulShutdownTimeout: validateGracefulShutdownTimeout,
  handleProcessSignals: validateHandleProcessSignals,
  logger: validateLogger,
}

/**
 * Node.js HTTP/2 transport adapter (with optional HTTP/1 fallback) that routes requests into an OD app and manages graceful shutdown.
 */
export default class ODHttp2WebServer {

  private _options: ResolvedODHttp2Options
  private _server: http2.Http2SecureServer | http2.Http2Server | null = null
  private _activeRequests: number = 0
  private _nextSocketId: number = 0
  /** HTTP/2 sessions (one per multiplexed connection). Used for graceful shutdown. */
  private _sessions: Set<http2.Http2Session> = new Set()
  /** Underlying TCP/TLS sockets kept for graceful and forced shutdown, keyed by a stable per-connection id. */
  private _sockets: Map<number, Socket> = new Map()
  /** Socket ids currently bound to active HTTP/2 sessions. */
  private _sessionSocketIds: Set<number> = new Set()
  /** Active HTTP/1.1 fallback request counts, keyed by socket id. */
  private _http1RequestCounts: Map<number, number> = new Map()
  private _isStopping: boolean = false
  private _signalHandlers: Map<'SIGINT' | 'SIGTERM', () => void> = new Map()

  /**
   * Starts an HTTP/2 server for the given app and returns a shutdown function that stops the server and unloads the app.
   *
   * @param app Application instance.
   * @param options Optional configuration values.
   */
  static async run(app: ODApp, options: ODHttp2WebServerOptions = {}) {
    const server = new this({ logger: app.logger, ...options })
    try {
      await server.start((req) => app.processRequest(req), { createResponse: () => app.createResponse(), createRequest: (init) => app.createRequest(init) })
    } catch (error) {
      try {
        await app.unload()
      } catch (unloadError) {
        app.logger.error('Failed to unload app after HTTP/2 server startup failure', unloadError)
      }
      throw error
    }
    /**
     * Local shutdown callback used to stop the current component and run required cleanup steps.
     */
    const stop = async() => {
      server.detachSignalHandlers()
      await server.stop()
      await app.unload()
    }
    if (server.getOption('handleProcessSignals')) {
      server.attachSignalHandlers(stop)
    }
    return stop
  }

  /**
   * Validates constructor options and initializes internal state for this OD Http2 Web Server.
   *
   * @param options Optional configuration values.
   */
  constructor(options: ODHttp2WebServerOptions) {
    this._validateOptions(options)
    this._options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Validates and stores a single resolved HTTP/2 server option.
   * Some options (for example errorHandler, logger, and maxBodySize) affect future requests immediately.
   * Listener-bound options such as port, host, and tls only take effect the next time start() runs.
   *
   * @param key Lookup key.
   * @param value Value to use.
   */
  setOption<K extends keyof ResolvedODHttp2Options>(key: K, value: ResolvedODHttp2Options[K]): void {
    this._validateOptions({ [key]: value })
    this._options[key] = value
  }

  /**
   * Returns option.
   *
   * @param key Lookup key.
   * @returns The resolved value of the requested server option.
   */
  getOption<K extends keyof ResolvedODHttp2Options>(key: K): ResolvedODHttp2Options[K] {
    return this._options[key]
  }

  /**
   * Validates options before the OD Http2 Web Server continues processing.
   *
   * @param options Optional configuration values.
   */
  private _validateOptions(options: ODHttp2WebServerOptions): void {
    for (const [key, value] of Object.entries(options)) {
      const validator = OPTION_VALIDATORS[key as keyof ODHttp2WebServerOptions]
      if (validator !== undefined) {
        validator(value)
      }
    }
  }

  /**
   * Closes an HTTP/1.1 fallback or pre-session socket without affecting active HTTP/2 session draining.
   *
   * @param socket Socket to close.
   */
  private _closeFallbackSocket(socket: Socket): void {
    if (socket.destroyed) return
    try {
      socket.end()
    } catch {
      socket.destroy()
    }
  }

  /**
   * Returns a stable connection id for a socket-like object.
   * HTTP/2 request/session sockets are Node proxies, but assigning ordinary
   * properties on them forwards to the underlying connection socket.
   *
   * @param socket Socket or HTTP/2 socket proxy.
   * @returns Stable id for the underlying connection.
   */
  private _getSocketId(socket: Socket): number {
    const taggedSocket = socket as Socket & { [SOCKET_ID]?: number }
    if (taggedSocket[SOCKET_ID] === undefined) {
      this._nextSocketId++
      taggedSocket[SOCKET_ID] = this._nextSocketId
    }
    return taggedSocket[SOCKET_ID]
  }

  /**
   * Starts the underlying transport server and wires its main processing callbacks.
   *
   * @param handler Callback function.
   * @param requestOptions Optional factories for custom ODRequest and ODResponse instances.
   * @returns True when the asynchronous check succeeds.
   */
  start(handler: RequestHandler, requestOptions: ServerStartOptions = {}): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this._server) {
        reject(new Error('Server has already started'))
        return
      }

      const { createResponse, createRequest } = requestOptions
      const makeResponse = createResponse ?? (() => new ODResponse())
      const makeRequest = createRequest ?? ((init: ODRequestInit) => new ODRequest(init))
      const tls = this.getOption('tls')

      const protocol: 'http' | 'https' = tls ? 'https' : 'http'
      /**
       * Local per-request callback that adapts transport-specific requests into the framework processing pipeline.
       *
       * @param request Incoming request object.
       * @param response Server response object.
       */
      const requestHandler = (
        request: http2.Http2ServerRequest | IncomingMessage,
        response: http2.Http2ServerResponse | ServerResponse,
      ) => {
        this._activeRequests++
        const socket = request.socket as Socket
        const socketId = this._getSocketId(socket)
        const isHttp1Request = request.httpVersionMajor === 1
        if (isHttp1Request) {
          this._http1RequestCounts.set(socketId, (this._http1RequestCounts.get(socketId) ?? 0) + 1)
        }
        let completed = false
        const onComplete = () => {
          if (completed) return
          completed = true
          this._activeRequests = Math.max(0, this._activeRequests - 1)
          if (isHttp1Request) {
            const remaining = (this._http1RequestCounts.get(socketId) ?? 1) - 1
            if (remaining > 0) {
              this._http1RequestCounts.set(socketId, remaining)
            } else {
              this._http1RequestCounts.delete(socketId)
              if (this._isStopping) {
                this._closeFallbackSocket(this._sockets.get(socketId) ?? socket)
              }
            }
          }
        }
        response.on('close', onComplete)
        void processServerRequest(request, response, handler, makeRequest, makeResponse, this.getOption('maxBodySize'), onComplete, this._options.logger, () => this.getOption('errorHandler'), protocol, (r, o) => this.send(r, o))
      }

      const server: http2.Http2SecureServer | http2.Http2Server = tls
        ? http2.createSecureServer(
          {
            key: tls.key,
            cert: tls.cert,
            ...(tls.ca ? { ca: tls.ca } : {}),
            allowHTTP1: tls.allowHTTP1 ?? true,
          },
          requestHandler,
        )
        : http2.createServer(requestHandler)

      this._server = server

      // Track HTTP/2 sessions for graceful shutdown (one session = one multiplexed connection).
      server.on('session', (session: http2.Http2Session) => {
        this._sessions.add(session)
        const socketId = this._getSocketId(session.socket as Socket)
        this._sessionSocketIds.add(socketId)
        session.on('close', () => {
          this._sessions.delete(session)
          this._sessionSocketIds.delete(socketId)
        })
      })

      // Track all TCP/TLS sockets so stop() can close fallback or pre-session sockets and
      // force-destroy anything that refuses to drain before the shutdown timeout.
      const trackSocket = (socket: Socket) => {
        const socketId = this._getSocketId(socket)
        this._sockets.set(socketId, socket)
        socket.on('close', () => {
          this._sockets.delete(socketId)
          this._sessionSocketIds.delete(socketId)
          this._http1RequestCounts.delete(socketId)
        })
      }
      if (tls) {
        ;(server as http2.Http2SecureServer).on('secureConnection', (socket) => trackSocket(socket))
      } else {
        server.on('connection', trackSocket)
      }

      if (tls && (tls.allowHTTP1 ?? true) === false) {
        ;(server as http2.Http2SecureServer).on('unknownProtocol', (socket: Socket) => {
          if (!socket.destroyed) {
            socket.destroy()
          }
        })
      }

      /**
       * Temporary startup error callback that rejects initialization before the server begins listening.
       *
       * @param err Error instance.
       */
      const startupErrorHandler = (err: Error) => {
        this._server = null
        reject(err)
      }

      server.once('error', startupErrorHandler)
      server.listen(this.getOption('port'), this.getOption('host'), () => {
        server.off('error', startupErrorHandler)
        server.on('error', (e: Error) => {
          this._options.logger.error('Server error', e)
        })
        resolve(true)
      })
    })
  }

  /**
   * Sends the prepared framework response through the active transport implementation.
   *
   * @param response Server response object.
   * @param res Framework response object.
   */
  async send(response: IServerResponse, res: ODResponse): Promise<void> {
    return writeResponse(response, res)
  }

  /**
   * Returns the number of requests currently being processed.
   *
   * @returns The number of requests currently being processed.
   */
  get inFlightRequests(): number {
    return this._activeRequests
  }

  /**
   * Attaches signal Handlers used by this OD Http2 Web Server.
   *
   * @param stop Shutdown callback.
   */
  attachSignalHandlers(stop: () => Promise<void>): void {
    _attachSignalHandlers(this._signalHandlers, this._options.logger, stop)
  }

  /**
   * Detaches signal Handlers previously attached by this OD Http2 Web Server.
   */
  detachSignalHandlers(): void {
    _detachSignalHandlers(this._signalHandlers)
  }

  /**
   * Stops this OD Http2 Web Server and performs shutdown or cleanup logic.
   *
   * @param gracefulShutdownTimeout Override graceful shutdown timeout in milliseconds, or null to use the configured default.
   * @returns True when the asynchronous check succeeds.
   */
  stop(gracefulShutdownTimeout: number | null = this.getOption('gracefulShutdownTimeout')): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this._server) {
        reject(new Error('Server is not started'))
        return
      }
      const server = this._server
      this.detachSignalHandlers()
      this._isStopping = true

      let timeout: NodeJS.Timeout | null = null
      if (gracefulShutdownTimeout !== null) {
        timeout = setTimeout(() => {
          // Force-close HTTP/2 sessions that haven't finished draining
          for (const session of this._sessions) {
            session.destroy()
          }
          // Force-close HTTP/1.1 fallback sockets
          for (const socket of this._sockets.values()) {
            socket.destroy()
          }
        }, gracefulShutdownTimeout)
        timeout.unref()
      }

      for (const session of this._sessions) {
        if (session.closed || session.destroyed) continue
        session.close()
      }

      for (const [socketId, socket] of this._sockets) {
        if (this._sessionSocketIds.has(socketId)) continue
        if ((this._http1RequestCounts.get(socketId) ?? 0) > 0) continue
        this._closeFallbackSocket(socket)
      }

      server.close((err?: Error) => {
        if (timeout) {
          clearTimeout(timeout)
        }
        this._server = null
        this._isStopping = false
        if (err) {
          reject(err)
          return
        }
        resolve(true)
      })
    })
  }
}
