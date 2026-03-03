import { camelCaseToDashCase } from '../utils/text-transformations'
import ODApp from './app'

/**
 * Represents a concrete (non-abstract) ODAction subclass that can be
 * instantiated and has the required static actionName property.
 */
export type ODActionClass = {
  new(app: ODApp): ODAction
  readonly actionName: string
}

/**
 * Base class for executable framework actions with before/after hooks and shared error handling.
 */
export default abstract class ODAction {

  /**
   * Returns the action name derived from the class name.
   *
   * @returns The action name derived from the class name.
   */
  static get actionName(){
    return camelCaseToDashCase(this.name)
  }

  protected app: ODApp

  /**
   * Initializes internal state for this OD Action.
   *
   * @param app Application instance.
   */
  constructor(app: ODApp) {
    this.app = app
  }

  protected abstract doAction(input: Record<string, unknown>): Promise<string>

  /**
   * Hook that runs before the action body and can transform the input payload.
   *
   * @param input Input payload.
   * @returns A promise that resolves to the input payload (or a transformed replacement).
   */
  protected async doBeforeAction(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return input
  }

  /**
   * Hook that runs after the action body and can transform the action output.
   *
   * @param output Action output value.
   * @returns A promise that resolves to the action output (or a transformed replacement).
   */
  protected async doAfterAction(output: string): Promise<string> {
    return output
  }

  /**
   * Executes the full action lifecycle (before hook, action body, after hook, error handling).
   *
   * @param input Input payload.
   * @returns A promise that resolves to the final action output.
   */
  async invoke(input: Record<string, unknown>): Promise<string> {
    try {
      return await this.doAfterAction(await this.doAction(await this.doBeforeAction(input)))
    } catch (e) {
      return await this.handleError(e instanceof Error ? e : new Error(`${e}`))
    }
  }

  /**
   * Handles an error raised during action execution.
   *
   * @param e Error instance.
   * @returns A promise that resolves to a fallback action output, or throws to propagate the error.
   */
  async handleError(e: Error): Promise<string> {
    throw e
  }
}
