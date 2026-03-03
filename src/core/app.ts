import { pathToFileURL } from 'url'
import { ODRouter } from 'orange-dragonfly-router'
import { ODMiddlewareFunction } from './middleware'
import ODController, { ODControllerClass } from './controller'
import ODRoute from './route'
import { readDirRecursively } from '../utils/fs-helpers'
import ODResponse, { ODResponseContent, ODResponseHeader, ODResponseOptions } from './response'
import ODRequest, { ODRequestInit, ODRequestOptions } from './request'
import ODContext from './context'
import MagicQueryParser, { MagicQueryParserOptions } from '../utils/magic-query-parser'
import { ODLogger, defaultLogger } from './logger'
import ODRequestError from './request-error'
import { ODCache, ODMemoryCache } from './cache'
import ODAction, { ODActionClass } from './action'
import ODNotFoundController from '../controllers/not-found'

export type ODAppCallback = (app: ODApp) => Promise<void>
export type ODAppRequestCallback = (context: ODContext) => Promise<void>
export type ODAppActionCallback = (app: ODApp, action: ODAction) => Promise<void>

export interface ODAppOptions {
    queryParser?: MagicQueryParserOptions
    responseOptions?: ODResponseOptions
    logger?: ODLogger
    notFoundController?: typeof ODNotFoundController,
    cache?: ODCache
    /**
     * List of trusted proxy IP addresses (exact match only; CIDR ranges are not supported).
     * When the connecting IP is in this list, the real client IP is read from the
     * rightmost non-trusted entry in the X-Forwarded-For header.
     * Only set this if your app runs behind a known reverse proxy you control.
     */
    trustedProxy?: string[]
}

/**
 * Central framework runtime that registers controllers, actions, and middleware and coordinates request/action lifecycles.
 */
export default class ODApp {

  private _router: ODRouter<ODRoute> = new ODRouter<ODRoute>()

  private _controllers: ODControllerClass[] = []
  private _actions: Record<string, ODActionClass> = {}

  private _beforewares: ODMiddlewareFunction[] = []
  private _afterwares: ODMiddlewareFunction[] = []

  private _onInit: ODAppCallback[] = []
  private _onRequestStarted: ODAppRequestCallback[] = []
  private _onRequestCompleted: ODAppRequestCallback[] = []
  private _onActionStarted: ODAppActionCallback[] = []
  private _onActionCompleted: ODAppActionCallback[] = []
  private _onUnload: ODAppCallback[] = []

  private _queryParser: MagicQueryParser | null = null
  private _responseOptions: ODResponseOptions = {}
  private _logger: ODLogger
  private _notFoundController: typeof ODNotFoundController
  private _cache: ODCache
  private _trustedProxy: string[]

  /**
   * Initializes internal state for this OD App.
   *
   * @param options Optional configuration values.
   */
  constructor(options: ODAppOptions = {}) {
    if (options.queryParser) {
      this._queryParser = new MagicQueryParser(options.queryParser)
    }
    this._responseOptions = options.responseOptions ?? {}
    this._logger = options.logger ?? defaultLogger
    this._notFoundController = options.notFoundController ?? ODNotFoundController
    this._cache = options.cache ?? new ODMemoryCache()
    this._trustedProxy = options.trustedProxy ?? []
  }

  /**
   * Creates a new instance using the current class so subclasses keep their factory behavior.
   *
   * @param options Optional configuration values.
   */
  static create(options: ODAppOptions = {}) {
    return new this(options)
  }

  /**
   * Registers action for use by this OD App.
   *
   * @param action Action instance.
   */
  useAction(action: ODActionClass) {
    const { actionName } = action
    if (actionName in this._actions) {
      throw new Error(`Duplicated action name: ${actionName}`)
    }
    this._actions[actionName] = action
    return this
  }

  /**
   * Registers controller for use by this OD App.
   *
   * @param controller Controller class.
   */
  useController(controller: ODControllerClass) {
    this._controllers.push(controller)
    return this
  }

  /**
   * Registers module exports from a directory for use by this OD App.
   * Only non-symlinked entries are considered by default; symlinked files and directories are skipped.
   *
   * @param dirPath Directory path.
   * @param followSymlinks When true, resolves symlinked entries and traverses symlinked directories. Disabled by default, so symlinked files and directories are skipped.
   */
  async use(dirPath: string, followSymlinks = false) {
    const files = readDirRecursively(dirPath, true, ['.ts', '.js', '.mts', '.mjs'], followSymlinks).sort()
    for (const file of files) {
      if (file.endsWith('.d.ts') || file.endsWith('.d.mts')) continue
      const mod = await import(pathToFileURL(file).href)
      const Class = mod.default
      if (Class?.prototype instanceof ODController) {
        this.useController(Class)
      } else if (Class?.prototype instanceof ODAction) {
        this.useAction(Class)
      } else {
        this._logger.warn(`File skipped during auto-load (no ODController/ODAction default export): ${file}`)
      }
    }
    return this
  }

  /**
   * Registers middleware for use by this OD App.
   *
   * @param middleware Middleware function.
   * @param runAfter When true, registers the middleware to run after controller processing.
   */
  useMiddleware(middleware: ODMiddlewareFunction, runAfter: boolean = false) {
    if (runAfter) {
      this._afterwares.push(middleware)
    } else {
      this._beforewares.push(middleware)
    }
    return this
  }

  /**
   * Registers or clears callbacks for the init lifecycle hook.
   *
   * @param callback Callback to register, or null to clear the callback list.
   */
  onInit(callback: ODAppCallback|null) {
    if (callback === null) {
      this._onInit = []
    } else {
      this._onInit.push(callback)
    }
    return this
  }

  /**
   * Registers or clears callbacks for the request Started lifecycle hook.
   *
   * @param callback Callback to register, or null to clear the callback list.
   */
  onRequestStarted(callback: ODAppRequestCallback|null) {
    if (callback === null) {
      this._onRequestStarted = []
    } else {
      this._onRequestStarted.push(callback)
    }
    return this
  }

  /**
   * Registers or clears callbacks for the request Completed lifecycle hook.
   *
   * @param callback Callback to register, or null to clear the callback list.
   */
  onRequestCompleted(callback: ODAppRequestCallback|null) {
    if (callback === null) {
      this._onRequestCompleted = []
    } else {
      this._onRequestCompleted.push(callback)
    }
    return this
  }

  /**
   * Registers or clears callbacks for the action Started lifecycle hook.
   *
   * @param callback Callback to register, or null to clear the callback list.
   */
  onActionStarted(callback: ODAppActionCallback|null) {
    if (callback === null) {
      this._onActionStarted = []
    } else {
      this._onActionStarted.push(callback)
    }
    return this
  }

  /**
   * Registers or clears callbacks for the action Completed lifecycle hook.
   *
   * @param callback Callback to register, or null to clear the callback list.
   */
  onActionCompleted(callback: ODAppActionCallback|null) {
    if (callback === null) {
      this._onActionCompleted = []
    } else {
      this._onActionCompleted.push(callback)
    }
    return this
  }

  /**
   * Registers or clears callbacks for the unload lifecycle hook.
   *
   * @param callback Callback to register, or null to clear the callback list.
   */
  onUnload(callback: ODAppCallback|null) {
    if (callback === null) {
      this._onUnload = []
    } else {
      this._onUnload.push(callback)
    }
    return this
  }

  /**
   * Returns the registered middleware functions that run before controllers.
   *
   * @returns The registered middleware functions that run before controllers.
   */
  get beforewares(): ODMiddlewareFunction[] {
    return this._beforewares
  }

  /**
   * Returns the registered middleware functions that run after controllers.
   *
   * @returns The registered middleware functions that run after controllers.
   */
  get afterwares(): ODMiddlewareFunction[] {
    return this._afterwares
  }

  /**
   * Returns the app router instance.
   *
   * @returns The app router instance.
   */
  get router(): ODRouter {
    return this._router
  }

  /**
   * Initializes this OD App and prepares its runtime state.
   */
  async init() {
    for (const c of this._onInit) {
      await c(this)
    }
    this._registerRoutes()
    return this
  }

  /**
   * Runs shutdown and cleanup hooks for this OD App.
   */
  async unload() {
    for (const c of this._onUnload) {
      await c(this)
    }
    return this
  }

  /**
   * Registers routes in the internal state used by this OD App.
   */
  private _registerRoutes() {
    type RouteEntry = { Controller: ODControllerClass, route: { method: string, path: string, action: string } }
    const allRoutes: RouteEntry[] = []
    const explicitOptionsPaths = new Set<string>()

    for (const Controller of this._controllers) {
      for (const route of Controller.buildRoutes().filter(r => !!r.path)) {
        allRoutes.push({ Controller, route })
        if (route.method.toUpperCase() === 'OPTIONS') {
          explicitOptionsPaths.add(route.path)
        }
      }
    }

    this._assertRouteOwnership(allRoutes)

    const autoOptionsPaths = new Set<string>()
    for (const { Controller, route } of allRoutes) {
      this._assertAction(Controller, route.action)
      this._router.register(route.path, route.method.toUpperCase(), { controller: Controller, action: route.action, path: route.path, method: route.method })
      if (!explicitOptionsPaths.has(route.path) && !autoOptionsPaths.has(route.path)) {
        this._router.register(route.path, ['OPTIONS'], { controller: Controller, action: 'corsOptions', path: route.path, method: 'OPTIONS' })
        autoOptionsPaths.add(route.path)
      }
    }
    // Register the built-in (or user-supplied) not-found controller as the router default.
    // Unmatched routes are handled as a normal controller invocation (action: e404).
    this._router.registerDefault({
      controller: this._notFoundController,
      action: 'e404',
      path: '',
      method: '',
    })
  }

  /**
   * Asserts action and throws when the requirement is not satisfied.
   *
   * @param Controller Controller class.
   * @param action Action instance.
   */
  private _assertAction(Controller: ODControllerClass, action: string) {
    if (typeof Controller.prototype[action as keyof typeof Controller.prototype] !== 'function') {
      throw new Error(`Route registration error: action "${action}" not found on ${Controller.name}`)
    }
  }

  /**
   * Rejects ambiguous route matches across different controllers.
   *
   * Greedy proxy routes ({+param}) are allowed to overlap non-proxy routes because the router
   * intentionally defers proxy matches until all non-proxy routes have been checked.
   *
   * @param routes Registered controller routes prior to router registration.
   */
  private _assertRouteOwnership(routes: { Controller: ODControllerClass, route: { method: string, path: string, action: string } }[]) {
    const owners = new Map<string, { Controller: ODControllerClass, method: string, action: string }>()

    for (const { Controller, route } of routes) {
      const existing = owners.get(route.path)
      if (!existing) {
        owners.set(route.path, { Controller, method: route.method.toUpperCase(), action: route.action })
        continue
      }
      if (existing.Controller === Controller) {
        continue
      }
      throw new Error(
        `Route registration error: path "${route.path}" is already owned by ${existing.Controller.name}.${existing.action} (${existing.method}) and cannot also be registered by ${Controller.name}.${route.action} (${route.method.toUpperCase()})`,
      )
    }
  }

  /**
   * Returns the app logger.
   *
   * @returns The app logger.
   */
  get logger(): ODLogger {
    return this._logger
  }

  /**
   * Returns the app cache implementation.
   *
   * @returns The app cache implementation.
   */
  get cache(): ODCache {
    return this._cache
  }

  /**
   * Returns the configured query parser instance, if any.
   *
   * @returns The configured query parser instance, if any.
   */
  get queryParser(): MagicQueryParser | null {
    return this._queryParser
  }

  /**
   * Returns default response options applied when creating ODResponse instances.
   *
   * @returns Default response options applied when creating ODResponse instances.
   */
  get responseOptions(): ODResponseOptions {
    return this._responseOptions
  }

  /**
   * Creates and configures a new ODRequest instance for incoming transport data.
   *
   * @param init Request initialization values from the transport layer.
   * @returns The computed result.
   */
  createRequest(init: ODRequestInit): ODRequest {
    const options: ODRequestOptions = {}
    if (this._trustedProxy.length > 0) {
      options.trustedProxy = this._trustedProxy
    }
    const request = new ODRequest(init, options)
    if (this._queryParser) {
      request.queryParser = this._queryParser
    }
    return request
  }

  /**
   * Creates and configures a new ODResponse instance for request handling.
   *
   * @param code HTTP status code.
   * @param content Content value.
   * @param headers Headers map or list.
   * @returns The computed result.
   */
  createResponse(
    code: number = 200,
    content: ODResponseContent = '',
    headers: ODResponseHeader[] = [],
  ): ODResponse {
    return new ODResponse(
      code,
      content,
      headers,
      this._responseOptions,
    )
  }

  /**
   * Processes error Request as part of this OD App workflow.
   *
   * @param context Request context.
   * @param statusCode HTTP status code.
   * @param message Error message.
   * @returns A promise that resolves to the operation result.
   */
  protected async processErrorRequest(
    context: ODContext,
    statusCode: number,
    message?: string,
  ): Promise<ODResponse> {
    context.response.setError(statusCode, message ?? 'Error')
    return context.response
  }

  /**
   * Processes action as part of this OD App workflow.
   *
   * @param actionName Registered action name.
   * @param input Input payload.
   * @returns A promise that resolves to the operation result.
   */
  async processAction(actionName: string, input: Record<string, unknown>): Promise<string | undefined> {
    if (!(actionName in this._actions)) {
      this.logger.error('Action is not registered', actionName)
      return
    }
    const action = new this._actions[actionName](this)
    try {
      for (const c of this._onActionStarted) {
        await c(this, action)
      }
      return await action.invoke(input)
    } catch (e) {
      this.logger.error('Action invocation failed', e)
    } finally {
      try {
        for (const c of this._onActionCompleted) {
          await c(this, action)
        }
      } catch (e) {
        this.logger.error('Action completion callback failed', e)
      }
    }
  }

  /**
   * Processes request as part of this OD App workflow.
   *
   * @param request Incoming request object.
   * @returns A promise that resolves to the operation result.
   */
  async processRequest(request: ODRequest): Promise<ODResponse> {
    const route = this._router.route(request.path, request.method)
    const routeObj = route.route_object
    const context = new ODContext(this, request, this.createResponse(), routeObj)
    try {
      for (const c of this._onRequestStarted) {
        await c(context)
      }
      context.route = routeObj
      const Controller = routeObj.controller as unknown as ODControllerClass
      const controller = new Controller(context)
      context.response = await controller.invoke(routeObj.action, route.params)
    } catch (e) {
      if (e instanceof ODRequestError) {
        context.response = await this.processErrorRequest(context, e.statusCode, e.message)
      } else {
        context.response = await this.processErrorRequest(context, 500)
        this.logger.error('Controller invocation failed', e)
      }
    } finally {
      try {
        for (const c of this._onRequestCompleted) {
          await c(context)
        }
      } catch (e) {
        this.logger.error('Request completion callback failed', e)
      }
    }
    return context.response
  }

}
