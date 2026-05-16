import ODApp from '../../core/app'
import { ODActionClass } from '../../core/action'
import { ODLogger } from '../../core/logger'

export interface ODAwsSnsMessageAttribute {
  Type: string
  Value: string
}

export interface ODAwsSnsMessage {
  SignatureVersion: string
  Timestamp: string
  Signature: string
  SigningCertUrl: string
  MessageId: string
  Message: string
  MessageAttributes: Record<string, ODAwsSnsMessageAttribute>
  Type: string
  UnsubscribeUrl: string
  TopicArn: string
  Subject: string
}

export interface ODAwsSnsRecord {
  EventVersion: string
  EventSubscriptionArn: string
  EventSource: string
  Sns: ODAwsSnsMessage
}

export interface ODAwsSnsEvent {
  Records: ODAwsSnsRecord[]
}

export type ODAwsSnsLambdaActionHandler = (event: ODAwsSnsEvent) => Promise<void>

export interface ODAwsSnsLambdaActionFactoryOptions {
  logger?: ODLogger
  /**
   * Controls what happens when a record's message cannot be parsed as a JSON object.
   * - 'discard' (default): log the error and skip the message
   * - 'throw': rethrow the error, causing the Lambda invocation to fail (SNS will retry)
   */
  onParseError?: 'discard' | 'throw'
  /**
   * Controls what happens when the action throws during invocation.
   * - 'throw' (default): rethrow the error, causing the Lambda invocation to fail (SNS will retry)
   * - 'discard': log the error and skip the message
   */
  onActionError?: 'throw' | 'discard'
  /**
   * Optional callback to transform the parsed input before it is passed to the action.
   * Receives the parsed message and the full SNS record, and must return the (possibly modified) input.
   */
  transformInput?: (input: Record<string, unknown>, record: ODAwsSnsRecord) => Record<string, unknown> | Promise<Record<string, unknown>>
}

export default class ODAwsSnsLambdaActionFactory {
  static async build(
    app: ODApp,
    options: ODAwsSnsLambdaActionFactoryOptions,
    ActionClass: ODActionClass,
  ): Promise<ODAwsSnsLambdaActionHandler> {
    const logger = options.logger ?? app.logger
    const onParseError = options.onParseError ?? 'discard'
    const onActionError = options.onActionError ?? 'throw'
    const { transformInput } = options

    return async(event: ODAwsSnsEvent): Promise<void> => {
      for (const record of event.Records) {
        const messageId = record.Sns.MessageId

        let input: Record<string, unknown>
        try {
          const parsed: unknown = JSON.parse(record.Sns.Message)
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('SNS record message must be a JSON object')
          }
          input = parsed as Record<string, unknown>
        } catch (e) {
          logger.error('Failed to parse SNS record message', { messageId, error: e })
          if (onParseError === 'throw') {
            throw e
          }
          continue
        }

        try {
          const action = new ActionClass(app)
          await action.invoke(transformInput ? await transformInput(input, record) : input)
        } catch (e) {
          logger.error('SNS action invocation failed', { messageId, error: e })
          if (onActionError === 'throw') {
            throw e
          }
        }
      }
    }
  }
}
