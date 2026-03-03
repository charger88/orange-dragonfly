import ODController from '../core/controller'

/**
 * Built-in health check controller. Register it to expose a GET /health endpoint.
 * Response body:
 * - status    - always "ok" (non-200 responses are returned on errors, not via this field)
 * - uptime    - process uptime in seconds
 * - timestamp - current UTC time in ISO 8601 format
 */
export default class ODHealthController extends ODController {
  /**
   * Returns the route path handled by this built-in health controller.
   *
   * @returns The route path handled by this built-in health controller.
   */
  static get path() {
    return '/health'
  }

  /**
   * Handles `GET /health` and returns a lightweight process health payload.
   */
  async doGet() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }
  }
}
