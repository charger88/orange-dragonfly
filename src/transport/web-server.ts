import http from 'http'
import https from 'https'
import net from 'net'
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
  validateRequestTimeout,
  validateGracefulShutdownTimeout,
  validateHandleProcessSignals,
  validateLogger,
  validateErrorHandler,
  processServerRequest,
} from './utils/http'

export type { RequestHandler, ErrorHandler }

export interface TlsOptions {
  key: Buffer | string
  cert: Buffer | string
  ca?: Buffer | string
}

export interface WebServerOptions {
  port?: number
  host?: string
  tls?: TlsOptions
  errorHandler?: ErrorHandler | null
  maxBodySize?: number | null
  requestTimeout?: number | null
  gracefulShutdownTimeout?: number | null
  handleProcessSignals?: boolean
  logger?: ODLogger
}

interface ServerStartOptions {
  createResponse?: () => ODResponse
  createRequest?: (init: ODRequestInit) => ODRequest
}

type ResolvedWebServerOptions = {
  port: number
  host: string
  tls: TlsOptions | undefined
  errorHandler: ErrorHandler | null
  maxBodySize: number | null
  requestTimeout: number | null
  gracefulShutdownTimeout: number | null
  handleProcessSignals: boolean
  logger: ODLogger
}

const DEFAULT_OPTIONS: ResolvedWebServerOptions = {
  port: 8888,
  host: '0.0.0.0',
  tls: undefined,
  errorHandler: null,
  maxBodySize: 1_048_576,
  requestTimeout: 300_000,
  gracefulShutdownTimeout: 10_000,
  handleProcessSignals: true,
  logger: defaultLogger,
}

const OPTION_VALIDATORS: Partial<Record<keyof WebServerOptions, (value: unknown) => void>> = {
  port: validatePort,
  host: validateHost,
  tls: validateTls,
  errorHandler: validateErrorHandler,
  maxBodySize: validateMaxBodySize,
  requestTimeout: validateRequestTimeout,
  gracefulShutdownTimeout: validateGracefulShutdownTimeout,
  handleProcessSignals: validateHandleProcessSignals,
  logger: validateLogger,
}

/**
 * Node.js HTTP/HTTPS transport adapter that forwards requests into an OD app and manages server lifecycle and graceful shutdown.
 */
export default class ODWebServer {

  private _options: ResolvedWebServerOptions
  private _server: net.Server | null = null
  private _activeRequests: number = 0
  private _requestTrackingGeneration: number = 0
  private _drainWaiters: Set<() => void> = new Set()
  private _sockets: Set<Socket> = new Set()
  private _signalHandlers: Map<'SIGINT' | 'SIGTERM', () => void> = new Map()

  /**
   * Starts a web server for the given app and returns a shutdown function that stops the server and unloads the app.
   *
   * @param app Application instance.
   * @param options Optional configuration values.
   */
  static async run(app: ODApp, options: WebServerOptions = {}) {
    const server = new this({ logger: app.logger, ...options })
    try {
      await server.start((req) => app.processRequest(req), { createResponse: () => app.createResponse(), createRequest: (init) => app.createRequest(init) })
    } catch (error) {
      try {
        await app.unload()
      } catch (unloadError) {
        app.logger.error('Failed to unload app after server startup failure', unloadError)
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
   * Validates constructor options and initializes internal state for this OD Web Server.
   *
   * @param options Optional configuration values.
   */
  constructor(options: WebServerOptions) {
    this._validateOptions(options)
    this._options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Validates and stores a single resolved server option.
   * Some options (for example errorHandler, logger, and maxBodySize) affect future requests immediately.
   * Listener-bound or startup-bound options such as port, host, tls, and requestTimeout only take effect the next time start() runs.
   *
   * @param key Lookup key.
   * @param value Value to use.
   */
  setOption<K extends keyof ResolvedWebServerOptions>(key: K, value: ResolvedWebServerOptions[K]): void {
    this._validateOptions({ [key]: value })
    this._options[key] = value
  }

  /**
   * Returns option.
   *
   * @param key Lookup key.
   * @returns The resolved value of the requested server option.
   */
  getOption<K extends keyof ResolvedWebServerOptions>(key: K): ResolvedWebServerOptions[K] {
    return this._options[key]
  }

  /**
   * Validates options before the OD Web Server continues processing.
   *
   * @param options Optional configuration values.
   */
  private _validateOptions(options: WebServerOptions): void {
    for (const [key, value] of Object.entries(options)) {
      const validator = OPTION_VALIDATORS[key as keyof WebServerOptions]
      if (validator !== undefined) {
        validator(value)
      }
    }
  }

  /**
   * Starts a new request-accounting generation and resolves any stale drain waiters.
   */
  private _resetRequestTracking(): void {
    this._requestTrackingGeneration++
    this._activeRequests = 0
    this._flushDrainWaiters()
  }

  /**
   * Resolves any pending waiters once all tracked request work has completed.
   */
  private _flushDrainWaiters(): void {
    if (this._activeRequests !== 0) return
    for (const waiter of this._drainWaiters) {
      waiter()
    }
    this._drainWaiters.clear()
  }

  /**
   * Returns a promise that resolves when all tracked request work has completed.
   * The returned cancel callback removes the waiter if shutdown times out first.
   *
   * @returns Wait handle for active request drainage.
   */
  private _waitForRequestDrain(): { promise: Promise<void>; cancel: () => void } {
    if (this._activeRequests === 0) {
      return { promise: Promise.resolve(), cancel: () => {} }
    }

    let waiter: (() => void) | null = null
    const promise = new Promise<void>((resolve) => {
      waiter = () => {
        if (!waiter) return
        this._drainWaiters.delete(waiter)
        waiter = null
        resolve()
      }
      this._drainWaiters.add(waiter)
    })

    return {
      promise,
      cancel: () => {
        if (!waiter) return
        this._drainWaiters.delete(waiter)
        waiter = null
      },
    }
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
      this._resetRequestTracking()
      const requestTrackingGeneration = this._requestTrackingGeneration
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
      const requestHandler = (request: http.IncomingMessage, response: http.ServerResponse) => {
        this._activeRequests++
        let completed = false
        const onComplete = () => {
          if (completed) return
          completed = true
          if (requestTrackingGeneration !== this._requestTrackingGeneration) return
          this._activeRequests = Math.max(0, this._activeRequests - 1)
          this._flushDrainWaiters()
        }
        void processServerRequest(request, response, handler, makeRequest, makeResponse, this.getOption('maxBodySize'), onComplete, this._options.logger, () => this.getOption('errorHandler'), protocol, (r, o) => this.send(r, o)).catch((e) => {
          this._options.logger.error('Unexpected request processing failure', e)
          onComplete()
        })
      }

      const server: net.Server = tls
        ? https.createServer({ key: tls.key, cert: tls.cert, ...(tls.ca ? { ca: tls.ca } : {}) }, requestHandler)
        : http.createServer(requestHandler)

      this._server = server

      server.on('connection', (socket: Socket) => {
        this._sockets.add(socket)
        socket.on('close', () => this._sockets.delete(socket))
      })

      const requestTimeout = this.getOption('requestTimeout')
      ;(server as unknown as { requestTimeout: number }).requestTimeout = requestTimeout ?? 0

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
        server.on('error', (e) => {
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
   * Attaches signal Handlers used by this OD Web Server.
   *
   * @param stop Shutdown callback.
   */
  attachSignalHandlers(stop: () => Promise<void>): void {
    _attachSignalHandlers(this._signalHandlers, this._options.logger, stop)
  }

  /**
   * Detaches signal Handlers previously attached by this OD Web Server.
   */
  detachSignalHandlers(): void {
    _detachSignalHandlers(this._signalHandlers)
  }

  /**
   * Closes currently idle keep-alive sockets when the underlying server implementation supports it.
   *
   * @param server Active server instance.
   */
  private _closeIdleConnections(server: net.Server): void {
    const idleClosableServer = server as unknown as { closeIdleConnections?: () => void }
    if (typeof idleClosableServer.closeIdleConnections === 'function') {
      idleClosableServer.closeIdleConnections()
    }
  }

  /**
   * Stops this OD Web Server and performs shutdown or cleanup logic.
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

      const waitForServerClose = new Promise<void>((resolveServerClose, rejectServerClose) => {
        server.close((err?: Error) => {
          if (err) {
            rejectServerClose(err)
            return
          }
          resolveServerClose()
        })
      })
      this._closeIdleConnections(server)

      const requestDrain = this._waitForRequestDrain()
      let timeout: NodeJS.Timeout | null = null
      const waitForShutdownBudget = gracefulShutdownTimeout === null
        ? requestDrain.promise.then(() => {
          this._closeIdleConnections(server)
        })
        : new Promise<void>((resolveBudget) => {
          let resolved = false
          const resolveBudgetOnce = () => {
            if (resolved) return
            resolved = true
            if (timeout) {
              clearTimeout(timeout)
              timeout = null
            }
            resolveBudget()
          }

          timeout = setTimeout(() => {
            requestDrain.cancel()
            timeout = null
            this._resetRequestTracking()
            for (const socket of this._sockets) {
              socket.destroy()
            }
            resolveBudgetOnce()
          }, gracefulShutdownTimeout)
          timeout.unref()
          void requestDrain.promise.then(() => {
            this._closeIdleConnections(server)
            resolveBudgetOnce()
          })
        })

      void Promise.all([waitForServerClose, waitForShutdownBudget]).then(() => {
        if (timeout) {
          clearTimeout(timeout)
        }
        this._resetRequestTracking()
        this._server = null
        resolve(true)
      }).catch((err) => {
        if (timeout) {
          clearTimeout(timeout)
        }
        requestDrain.cancel()
        reject(err)
      })
    })
  }
}
