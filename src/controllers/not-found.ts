import ODController from '../core/controller'

/**
 * Built-in controller used for unmatched routes.
 * ODApp installs it as the router default (configurable via ODAppOptions.notFoundController).
 */
export default class ODNotFoundController extends ODController {
  
  /**
   * Builds the default 404 response for unmatched routes.
   */
  async e404() {
    return this.setError(404, 'Not found')
  }
}
