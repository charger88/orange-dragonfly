import { ODAction, ODAwsRestApiHandlerFactory, ODAwsSchedulerLambdaActionFactory, ODAwsSnsLambdaActionFactory, ODAwsSqsLambdaActionFactory } from '../src'
import app from './setup'

export const handler = await ODAwsRestApiHandlerFactory.build(await app.init(), {})

// SQS: each record body is passed to the action as a parsed object.
// Replace ProcessMessageAction with your own ODAction subclass.
class ProcessMessageAction extends ODAction {
  protected async doAction(input: Record<string, unknown>): Promise<string> {
    app.logger.info('Processing SQS message', input)
    return 'ok'
  }
}

export const handler_sqs = await ODAwsSqsLambdaActionFactory.build(await app.init(), {
  onParseError: 'fail',   // return unparseable records to the queue
  onActionError: 'throw1/fail', // throw on single-record batches (exact retry), fail on multi-record batches
}, ProcessMessageAction)

// SNS: each record's Sns.Message (a JSON string) is parsed and passed to the action.
// Replace HandleNotificationAction with your own ODAction subclass.
class HandleNotificationAction extends ODAction {
  protected async doAction(input: Record<string, unknown>): Promise<string> {
    app.logger.info('Handling SNS notification', input)
    return 'ok'
  }
}

export const handler_sns = await ODAwsSnsLambdaActionFactory.build(await app.init(), {
  onParseError: 'discard',  // skip unparseable messages (SNS has no partial failure)
  onActionError: 'throw',   // (default) retry the invocation on failure
}, HandleNotificationAction)

// EventBridge Scheduler: the schedule's Input field is the Lambda event itself.
// Replace RunScheduledJobAction with your own ODAction subclass.
class RunScheduledJobAction extends ODAction {
  protected async doAction(input: Record<string, unknown>): Promise<string> {
    app.logger.info('Running scheduled job', input)
    return 'ok'
  }
}

export const handler_event_bridge = await ODAwsSchedulerLambdaActionFactory.build(await app.init(), {
  onActionError: 'throw',   // (default) retry the invocation on failure
}, RunScheduledJobAction)
