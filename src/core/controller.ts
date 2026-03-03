import { ODValidatorException, ODValidatorRulesException, ODValidator } from 'orange-dragonfly-validator'
import { camelCaseToDashCase } from '../utils/text-transformations'
import ODContext from './context'
import { ODMiddlewareFunction, ODMiddlewareFunctionValue } from './middleware'
import ODResponse, { ODResponseContent } from './response'
import { ODRouteParams } from './route'
import ODApp from './app'

export type ODControllerClass = typeof ODController
export type ODControllerValidationFunction = (params: ODRouteParams) => Promise<ODMiddlewareFunctionValue>
export type ODControllerActionFunction = (params: ODRouteParams) => Promise<ODResponseContent | undefined | ODResponse>
export type ODControllerValidatorGetter = ODValidator

type Ctor<T = any> = (new (...args: any[]) => T) & { _getMethods(): string[], buildRoutes(): {method: string, path: string, action: string}[], get idParameterName(): string, get path(): string }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Base controller implementation that runs validation, middleware, and route action methods for a matched request.
 */
export default class ODController {

  protected context: ODContext
    
  /**
   * Initializes internal state for this OD Controller.
   *
   * @param context Request context.
   */
  constructor(context: ODContext) {
    this.context = context
  }

  /**
   * Executes the main workflow for this OD Controller.
   *
   * @param action Action instance.
   * @param params Route parameters.
   * @returns A promise that resolves to the operation result.
   */
  async invoke(action: string, params: ODRouteParams): Promise<ODResponse> {
    try {
      // App-level middlewares are merged into the controller pipeline.
      // Order: app beforewares -> controller beforewares -> action -> controller afterwares -> app afterwares.
      let response = await this._runMiddlewares([...this.app.beforewares, ...this.beforewares], params)
      if (response) return this._finalizeResponse(response)
      response = await this._validateRequest(action, params)
      if (response) return this._finalizeResponse(response)
      await this._runEndpoint(action, params)
      response = await this._runMiddlewares([...this.afterwares, ...this.app.afterwares], params)
      if (response) return this._finalizeResponse(response)
      return this.context.response
    } catch (e) {
      try {
        return this._finalizeResponse(await this.handleError(e instanceof Error ? e : new Error(`${e}`)))
      } catch (handledError) {
        this.context.response.dispose()
        throw handledError
      }
    }
  }

  /**
   * Validates request before the OD Controller continues processing.
   *
   * @param action Action instance.
   * @param params Route parameters.
   * @returns A promise that resolves to the operation result.
   */
  private async _validateRequest(action: string, params: ODRouteParams): Promise<ODMiddlewareFunctionValue> {
    const actionName = action.slice(2)
    const bodyValidator = `bodyValidator${actionName}`
    if (bodyValidator in this) {
      if (this.context.request.rawBody.length === 0) {
        return this.response.setError(400, 'Empty request') 
      }
      const body = this.context.request.body
      // Validators expect object-like input; guard string/null/array to avoid validator crashes.
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return this.response.setError(400, 'Request can\'t be parsed for validation') 
      }
      const response = await this.runValidator((this as unknown as Record<string, ODControllerValidatorGetter>)[bodyValidator], body)
      if (response) {
        return response
      }
    }
    const queryValidator = `queryValidator${actionName}`
    if (queryValidator in this) {
      const response = await this.runValidator((this as unknown as Record<string, ODControllerValidatorGetter>)[queryValidator], this.context.request.query)
      if (response) {
        return response
      }
    }
    const validationAction = `validate${actionName}`
    if (!(validationAction in this)) return
    return await (this as unknown as Record<string, ODControllerValidationFunction>)[validationAction](params)
  }


  /**
   * Executes a validator function and normalizes its result for controller flow control.
   *
   * @param validator Validator function to execute.
   * @param input Input payload.
   */
  async runValidator(validator: ODValidator, input: Record<string, unknown>) {
    validator.exceptionMode = true
    try {
      validator.validate(input)
    } catch (e) {
      if ((e instanceof ODValidatorException) && !(e instanceof ODValidatorRulesException)) {
        return this.response.setError(422, 'Validation error', e.info)
      } else {
        throw e
      }
    }
    return
  }

  /**
   * Runs middleware functions sequentially and stops when one returns a response or short-circuit value.
   *
   * @param middlewares Middleware functions to execute in order.
   * @param params Route parameters.
   * @returns The first middleware result that short-circuits processing, or undefined when all middlewares continue.
   */
  private async _runMiddlewares(middlewares: ODMiddlewareFunction[], params: ODRouteParams): ODMiddlewareFunctionValue {
    for (const middleware of middlewares) {
      const res = await middleware(this.context, params)
      if (res) return res
    }
  }

  /**
   * Processes request itself (without middlewares)
   *
   * @param action Action instance.
   * @param params Route parameters.
   */
  private async _runEndpoint(action: string, params: ODRouteParams): Promise<void> {
    if (!(action in this)) {
      throw new Error(`System error: action ${action} not found in the controller`)
    }
    const content = await (this as unknown as Record<string, ODControllerActionFunction>)[action](params)
    if (content !== undefined) {
      if (content instanceof ODResponse) {
        if (content !== this.context.response) {
          this.context.response.dispose()
        }
        this.context.response = content
      } else {
        this.context.response.content = content
      }
    }
  }

  /**
   * Releases the abandoned context response when controller flow switches to a different response object.
   *
   * @param response Response selected by middleware or error handling.
   * @returns The selected response.
   */
  private _finalizeResponse(response: ODResponse): ODResponse {
    if (response !== this.context.response) {
      this.context.response.dispose()
    }
    return response
  }

  /**
   * Handles error.
   *
   * @param e Error instance.
   * @returns A promise that resolves to the operation result.
   */
  async handleError(e: Error): Promise<ODResponse> {
    throw e
  }

  /**
   * Path for the controller. By default it is being generated based on controller's name (dashed instead of camel-case).
   * For controller named "Index" path will be returned as root ("/")
   * "Controller" part from the end of the name will be ignored.
   *
   * @return {string}
   * @returns The base route path for the controller.
   */
  static get path(): string {
    let name = this.name
    if (name.endsWith('Controller')) {
      name = name.slice(0, -10)
    }
    if (name === 'Index') {
      return '/'
    }
    return '/' + camelCaseToDashCase(name)
  }

  /**
   * Name of the "id" parameter
   *
   * @return {string}
   * @returns The route parameter name used for resource identifiers.
   */
  static get idParameterName(): string {
    return '#id'
  }

  /**
   * List of middlewares to be executed before controller's action (like doGetId)
   *
   * @returns The controller beforeware middleware list.
   */
  get beforewares(): ODMiddlewareFunction[] {
    return []
  }

  /**
   * List of middlewares to be executed after controller's action (like doGetId)
   *
   * @returns The controller afterware middleware list.
   */
  get afterwares(): ODMiddlewareFunction[] {
    return []
  }

  /**
   * Generates the controller response for automatic CORS preflight handling.
   */
  async corsOptions() {
    const routes = (this.constructor as unknown as Ctor).buildRoutes()
    const currentPath = this.context.route.path
    const methods = routes
      .filter(r => r.path === currentPath)
      .map(r => r.method.toUpperCase())
    if (!methods.includes('OPTIONS')) {
      methods.push('OPTIONS')
    }
    const allowed = methods.join(', ')
    this.context.response.setHeader('Allow', allowed)
    const hasCors = this.context.response.headers.some(
      h => h.name.toLowerCase() === 'access-control-allow-origin',
    )
    if (hasCors) {
      this.context.response.setHeader('Access-Control-Allow-Methods', allowed)
    }
    this.context.response.code = 204
  }

  /**
   * Updates error for this OD Controller.
   *
   * @param code HTTP status code.
   * @param error Error message or object.
   * @param data Additional data.
   */
  setError(code: number, error: string, data: Record<string, unknown> = {}) {
    return this.context.response.setError(code, error, data)
  }

  /**
   * Returns the app instance associated with the controller execution.
   *
   * @returns The app instance associated with the controller execution.
   */
  get app() {
    return this.context.app
  }

  /**
   * Returns the request for this controller execution.
   *
   * @returns The request for this controller execution.
   */
  get request() {
    return this.context.request
  }

  /**
   * Returns the response object for this controller execution.
   *
   * @returns The response object for this controller execution.
   */
  get response() {
    return this.context.response
  }

  /**
   * Collects controller method names that match the framework route action naming convention.
   *
   * @returns The computed result.
   */
  static _getMethods(this: Ctor): string[] {
    const methods = new Set<string>()
    let proto: unknown = this.prototype
    while (proto && proto !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') {
          continue
        }
        const desc = Object.getOwnPropertyDescriptor(proto, name)
        const isMethod = !!desc && typeof desc.value === 'function'
        if ((isMethod) && !methods.has(name)) {
          methods.add(name)
        }
      }
      if (proto === ODController.prototype) break
      proto = Object.getPrototypeOf(proto)
    }
    return Array.from(methods).sort()
  }

  /**
   * Returns controller's routes
   *
   * @return {{method: {string}, path: {string}, action: {string}}[]}
   * @param app Application instance.
   * @returns The computed result.
   */
  static buildRoutes(this: Ctor, app?: ODApp): {method: string, path: string, action: string}[] {
    const methodPattern = /^do(Get|Head|Post|Patch|Put|Delete|Options)(Id)?([a-zA-Z0-9]+)?$/
    const actions = this._getMethods()
      .filter((v) => methodPattern.test(v))
    const routes = []
    for (const action of actions) {
      const m = action.match(methodPattern)
      if (m) {
        const method = m[1].toLowerCase()
        const pathGetterName = 'path' + action.slice(2)
        const ctorAsRecord = this as unknown as Record<string, unknown>
        const customPath = pathGetterName in ctorAsRecord && typeof ctorAsRecord[pathGetterName] === 'string'
          ? ctorAsRecord[pathGetterName] as string
          : null
        let path: string
        if (customPath !== null && customPath.startsWith('/')) {
          path = customPath
        } else {
          path = this.path
          if (m[2] === 'Id') path += `${path !== '/' ? '/' : ''}{${this.idParameterName}}`
          if (customPath !== null) {
            path += `${path !== '/' ? '/' : ''}${customPath}`
          } else if (m[3]) {
            path += `${path !== '/' ? '/' : ''}${camelCaseToDashCase(m[3])}`
          }
        }
        routes.push({ method, path, action })
      }
    }
    if (!routes.length) {
      const errorMessage = `There is no routes found in controller ${this.name}`
      if (!app) throw new Error(errorMessage)
      app.logger.warn(errorMessage)
    }
    return routes
  }
}
