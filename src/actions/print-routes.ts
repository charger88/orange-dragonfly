import ODAction from '../core/action'

/**
 * Built-in action that prints the app's registered routes in a sorted human-readable list.
 */
export default class ODPrintRoutes extends ODAction {
  /**
   * Returns the action name used to invoke this built-in action.
   *
   * @returns The action name used to invoke this built-in action.
   */
  static get actionName(){
    return super.actionName.slice(3)
  }

  /**
   * Builds a newline-delimited, sorted list of registered routes and methods.
   *
   * @returns A promise that resolves to the formatted route list.
   */
  protected async doAction(): Promise<string> {
    return this.app.router.routes
      .sort((a, b) => a.pathPattern.localeCompare(b.pathPattern))
      .map((v) => v.methods.map((v2) => `${v2} ${v.pathPattern}`))
      .flat()
      .join('\n')
  }
}
