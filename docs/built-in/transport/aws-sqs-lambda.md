# ODAwsSqsLambdaActionFactory

AWS SQS Lambda adapter. Routes each record in an SQS batch to an `ODAction` and returns `{ batchItemFailures }` so SQS can retry only the records that failed.

## Usage

```ts
import { ODApp, ODAwsSqsLambdaActionFactory } from 'orange-dragonfly'
import ProcessOrderAction from './actions/process-order'

const app = await ODApp.create().init()

export const handler = await ODAwsSqsLambdaActionFactory.build(app, {
  onParseError: 'fail',
  onActionError: 'throw1/fail',
}, ProcessOrderAction)
```

`build()` returns an async function that accepts an SQS event and returns `{ batchItemFailures }`.

## Event Shape

SQS delivers a batch of one or more records:

```ts
{
  Records: [
    {
      messageId: string,
      receiptHandle: string,
      body: string,            // JSON-encoded payload
      attributes: Record<string, string>,
      messageAttributes: Record<string, unknown>,
      md5OfBody: string,
      eventSource: 'aws:sqs',
      eventSourceARN: string,
      awsRegion: string,
    },
    // ...
  ]
}
```

## Record Processing

Each record is processed sequentially:

1. `record.body` is parsed with `JSON.parse`. It must be a plain object — arrays, strings, numbers, and `null` are rejected as invalid.
2. `transformInput` is called if provided, receiving the parsed object and the full SQS record. The return value is used as the action input.
3. A new instance of `ActionClass` is created and `invoke(input)` is called.
4. On success the record is silently consumed. On failure the record is handled according to `onActionError`.

If step 1 fails, the record is handled according to `onParseError` and step 2–3 are skipped.

## Options

| Option | Default | Description |
|---|---|---|
| `onParseError` | `'discard'` | What to do when the body cannot be parsed as a JSON object. See [Error Handling](#error-handling). |
| `onActionError` | `'fail'` | What to do when the action throws. See [Error Handling](#error-handling). |
| `transformInput` | — | `(input, record) => Record<string, unknown>` — transform the parsed body before it reaches the action. Receives the parsed object and the full SQS record (for access to `messageId`, `attributes`, etc.). May be async. |
| `logger` | app logger | Logger used for parse and action errors. |

## Error Handling

Both `onParseError` and `onActionError` accept the same set of strategies:

| Value | Behaviour |
|---|---|
| `'discard'` | Log the error and skip the record. SQS deletes it from the queue. |
| `'fail'` | Log the error and add `messageId` to `batchItemFailures`. SQS returns the record to the queue. |
| `'throw'` | Log the error and rethrow. The Lambda invocation fails and SQS retries the **entire batch**. |
| `'throw1/discard'` | If the batch contains exactly one record: throw. Otherwise: discard. |
| `'throw1/fail'` | If the batch contains exactly one record: throw. Otherwise: fail. |

`onParseError` defaults to `'discard'`. `onActionError` defaults to `'fail'`.

**When to use `throw1/*`**

SQS can deliver batches of 1–10 records (or more with large payload mode). When a batch has one record, throwing causes SQS to retry that exact record with its original delivery count, which is the most precise retry signal. When a batch has multiple records, throwing retries the entire batch including records that already succeeded. `throw1/fail` is the recommended strategy when you want exact retries on single-record batches but safe partial failure handling on larger batches.

## Notes

- The app must be initialized before calling `build()`.
- Each record gets a fresh `ActionClass` instance. No state is shared between records.
- Errors logged by the adapter always include `messageId` for correlation with the SQS console.
- `handleError` on the action class is honoured — if it recovers without rethrowing, the record is treated as a success.
- Enable [SQS partial batch failure reporting](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#services-sqs-batchfailurereporting) in your Lambda event source mapping for `batchItemFailures` to take effect.
