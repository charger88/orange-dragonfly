import ODApp from './app'
import ODRequest from './request'
import ODResponse from './response'
import ODRoute from './route'

/**
 * Per-request execution context shared by middleware and controllers, bundling app, request, response, route data, and state.
 */
export default class ODContext {
  readonly app: ODApp
  request: ODRequest
  response: ODResponse
  /**
   * The matched route for this request.
   * Routing is resolved before the middleware/controller pipeline starts,
   * so this is available in onRequestStarted callbacks and all middlewares.
   */
  route: ODRoute
  readonly state: Map<string, unknown> = new Map()

  /**
   * Initializes internal state for this OD Context.
   *
   * @param app Application instance.
   * @param request Incoming request object.
   * @param response Response object used by the operation.
   * @param route Matched route metadata.
   */
  constructor(app: ODApp, request: ODRequest, response: ODResponse, route: ODRoute) {
    this.app = app
    this.request = request
    this.response = response
    this.route = route
  }
}
