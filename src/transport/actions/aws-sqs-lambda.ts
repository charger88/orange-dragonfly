import ODApp from '../../core/app'
import { ODActionClass } from '../../core/action'
import { ODLogger } from '../../core/logger'

export interface ODAwsSqsRecord {
  messageId: string
  receiptHandle: string
  body: string
  attributes: Record<string, string>
  messageAttributes: Record<string, unknown>
  md5OfBody: string
  eventSource: string
  eventSourceARN: string
  awsRegion: string
}

export interface ODAwsSqsEvent {
  Records: ODAwsSqsRecord[]
}

export interface ODAwsSqsHandlerResponse {
  batchItemFailures: Array<{ itemIdentifier: string }>
}

export type ODAwsSqsLambdaActionHandler = (event: ODAwsSqsEvent) => Promise<ODAwsSqsHandlerResponse>

export interface ODAwsSqsLambdaActionFactoryOptions {
  logger?: ODLogger
  /**
   * Controls what happens when a record's body cannot be parsed as a JSON object.
   * - 'discard' (default): log the error and skip the message (it will be deleted from the queue)
   * - 'fail': add the message to batchItemFailures so it is returned to the queue
   * - 'throw': rethrow the error, failing the Lambda invocation (SQS retries the entire batch)
   * - 'throw1/discard': throw if the batch contains exactly one record, otherwise discard
   * - 'throw1/fail': throw if the batch contains exactly one record, otherwise fail
   */
  onParseError?: 'discard' | 'fail' | 'throw' | 'throw1/discard' | 'throw1/fail'
  /**
   * Controls what happens when the action throws during invocation.
   * - 'fail' (default): add the message to batchItemFailures so it is returned to the queue
   * - 'discard': log the error and skip the message (it will be deleted from the queue)
   * - 'throw': rethrow the error, failing the Lambda invocation (SQS retries the entire batch)
   * - 'throw1/discard': throw if the batch contains exactly one record, otherwise discard
   * - 'throw1/fail': throw if the batch contains exactly one record, otherwise fail
   */
  onActionError?: 'fail' | 'discard' | 'throw' | 'throw1/discard' | 'throw1/fail'
  /**
   * Optional callback to transform the parsed input before it is passed to the action.
   * Receives the parsed body and the full SQS record, and must return the (possibly modified) input.
   */
  transformInput?: (input: Record<string, unknown>, record: ODAwsSqsRecord) => Record<string, unknown> | Promise<Record<string, unknown>>
}

export default class ODAwsSqsLambdaActionFactory {
  static async build(
    app: ODApp,
    options: ODAwsSqsLambdaActionFactoryOptions,
    ActionClass: ODActionClass,
  ): Promise<ODAwsSqsLambdaActionHandler> {
    const logger = options.logger ?? app.logger
    const onParseError = options.onParseError ?? 'discard'
    const onActionError = options.onActionError ?? 'fail'
    const { transformInput } = options

    return async(event: ODAwsSqsEvent): Promise<ODAwsSqsHandlerResponse> => {
      const batchItemFailures: Array<{ itemIdentifier: string }> = []
      const isSingleRecord = event.Records.length === 1

      const effectiveParseError =
          onParseError === 'throw1/discard' ? (isSingleRecord ? 'throw' : 'discard') :
            onParseError === 'throw1/fail' ? (isSingleRecord ? 'throw' : 'fail') :
              onParseError

      const effectiveActionError =
          onActionError === 'throw1/discard' ? (isSingleRecord ? 'throw' : 'discard') :
            onActionError === 'throw1/fail' ? (isSingleRecord ? 'throw' : 'fail') :
              onActionError

      for (const record of event.Records) {
        let input: Record<string, unknown>
        try {
          const parsed: unknown = JSON.parse(record.body)
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('SQS record body must be a JSON object')
          }
          input = parsed as Record<string, unknown>
        } catch (e) {
          logger.error('Failed to parse SQS record body', { messageId: record.messageId, error: e })
          if (effectiveParseError === 'throw') throw e
          if (effectiveParseError === 'fail') batchItemFailures.push({ itemIdentifier: record.messageId })
          continue
        }

        try {
          const action = new ActionClass(app)
          await action.invoke(transformInput ? await transformInput(input, record) : input)
        } catch (e) {
          logger.error('SQS action invocation failed', { messageId: record.messageId, error: e })
          if (effectiveActionError === 'throw') throw e
          if (effectiveActionError === 'fail') batchItemFailures.push({ itemIdentifier: record.messageId })
        }
      }

      return { batchItemFailures }
    }
  }
}
