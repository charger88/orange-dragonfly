# ODAwsSnsLambdaActionFactory

AWS SNS Lambda adapter. Routes each record in an SNS batch to an `ODAction`. Returns `void` — SNS does not support partial batch failures.

## Usage

```ts
import { ODApp, ODAwsSnsLambdaActionFactory } from 'orange-dragonfly'
import HandleNotificationAction from './actions/handle-notification'

const app = await ODApp.create().init()

export const handler = await ODAwsSnsLambdaActionFactory.build(app, {
  onParseError: 'discard',
  onActionError: 'throw',
}, HandleNotificationAction)
```

`build()` returns an async function that accepts an SNS event and returns `Promise<void>`.

## Event Shape

SNS delivers a batch of one or more records (typically one):

```ts
{
  Records: [
    {
      EventVersion: string,
      EventSubscriptionArn: string,
      EventSource: 'aws:sns',
      Sns: {
        MessageId: string,
        Message: string,         // JSON-encoded payload
        Subject: string,
        TopicArn: string,
        Timestamp: string,
        Type: 'Notification',
        MessageAttributes: Record<string, { Type: string, Value: string }>,
        SignatureVersion: string,
        Signature: string,
        SigningCertUrl: string,
        UnsubscribeUrl: string,
      },
    },
    // ...
  ]
}
```

## Record Processing

Each record is processed sequentially:

1. `record.Sns.Message` is parsed with `JSON.parse`. It must be a plain object — arrays, strings, numbers, and `null` are rejected as invalid.
2. `transformInput` is called if provided, receiving the parsed object and the full SNS record. The return value is used as the action input.
3. A new instance of `ActionClass` is created and `invoke(input)` is called.
4. On success the record is silently consumed. On failure the record is handled according to `onActionError`.

If step 1 fails, the record is handled according to `onParseError` and steps 2–3 are skipped.

## Options

| Option | Default | Description |
|---|---|---|
| `onParseError` | `'discard'` | What to do when `Sns.Message` cannot be parsed as a JSON object: `'discard'` (log and skip) or `'throw'` (rethrow, Lambda invocation fails and SNS retries). |
| `onActionError` | `'throw'` | What to do when the action throws: `'throw'` (rethrow, Lambda invocation fails and SNS retries) or `'discard'` (log and skip). |
| `transformInput` | — | `(input, record) => Record<string, unknown>` — transform the parsed message before it reaches the action. Receives the parsed object and the full SNS record (for access to `record.Sns.TopicArn`, `record.Sns.MessageId`, etc.). May be async. |
| `logger` | app logger | Logger used for parse and action errors. |

## Error Handling

SNS has no equivalent of SQS's `batchItemFailures`. When the handler throws, SNS treats the entire Lambda invocation as failed and retries it according to the subscription's retry policy. When the handler returns normally, all records are considered delivered.

| Strategy | When to use |
|---|---|
| `'throw'` | The record must not be lost. SNS retries the invocation until the retry policy is exhausted or the message expires. |
| `'discard'` | Malformed or unprocessable records should be silently dropped rather than blocking the retry cycle. Pair with a dead-letter queue on the SNS subscription for observability. |

## Notes

- The app must be initialized before calling `build()`.
- Each record gets a fresh `ActionClass` instance. No state is shared between records.
- Errors logged by the adapter always include `messageId` (from `record.Sns.MessageId`) for correlation.
- `handleError` on the action class is honoured — if it recovers without rethrowing, the record is treated as a success.
- When `onActionError` is `'throw'` and the batch has multiple records, a failure on one record stops processing of subsequent records and retries the whole batch.
