import ODApp from '../../core/app'
import { ODActionClass } from '../../core/action'
import { ODLogger } from '../../core/logger'

export type ODAwsSchedulerLambdaActionHandler = (event: unknown) => Promise<void>

export interface ODAwsSchedulerLambdaActionFactoryOptions {
  logger?: ODLogger
  /**
   * Controls what happens when the event payload is not a plain object.
   * EventBridge Scheduler delivers the schedule Input field directly as the Lambda event,
   * so this fires when the configured input is an array, string, number, null, etc.
   * - 'throw' (default): rethrow the error, causing the Lambda invocation to fail (Scheduler will retry)
   * - 'discard': log the error and return without invoking the action
   */
  onInputError?: 'throw' | 'discard'
  /**
   * Controls what happens when the action throws during invocation.
   * - 'throw' (default): rethrow the error, causing the Lambda invocation to fail (Scheduler will retry)
   * - 'discard': log the error and return
   */
  onActionError?: 'throw' | 'discard'
  /**
   * Optional callback to transform the event payload before it is passed to the action.
   * Receives the validated input object and must return the (possibly modified) input.
   */
  transformInput?: (input: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>
}

export default class ODAwsSchedulerLambdaActionFactory {
  static async build(
    app: ODApp,
    options: ODAwsSchedulerLambdaActionFactoryOptions,
    ActionClass: ODActionClass,
  ): Promise<ODAwsSchedulerLambdaActionHandler> {
    const logger = options.logger ?? app.logger
    const onInputError = options.onInputError ?? 'throw'
    const onActionError = options.onActionError ?? 'throw'
    const { transformInput } = options

    return async(event: unknown): Promise<void> => {
      let input: Record<string, unknown>
      try {
        if (typeof event !== 'object' || event === null || Array.isArray(event)) {
          throw new Error('EventBridge Scheduler event must be a plain object')
        }
        input = event as Record<string, unknown>
      } catch (e) {
        logger.error('Invalid EventBridge Scheduler event payload', { error: e })
        if (onInputError === 'throw') throw e
        return
      }

      try {
        const action = new ActionClass(app)
        await action.invoke(transformInput ? await transformInput(input) : input)
      } catch (e) {
        logger.error('Scheduler action invocation failed', { error: e })
        if (onActionError === 'throw') throw e
      }
    }
  }
}
