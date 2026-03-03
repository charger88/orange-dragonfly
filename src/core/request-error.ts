/**
 * Core framework class that encapsulates OD Request Error behavior and shared runtime state.
 */
export default class ODRequestError extends Error {
  readonly statusCode: number

  /**
   * Initializes internal state for this OD Request Error.
   *
   * @param statusCode HTTP status code.
   * @param message Error message.
   */
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}
