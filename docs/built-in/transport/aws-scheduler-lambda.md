# ODAwsSchedulerLambdaActionFactory

Amazon EventBridge Scheduler Lambda adapter. Routes a scheduled invocation to an `ODAction`. Returns `void`.

## Usage

```ts
import { ODApp, ODAwsSchedulerLambdaActionFactory } from 'orange-dragonfly'
import RunReportAction from './actions/run-report'

const app = await ODApp.create().init()

export const handler = await ODAwsSchedulerLambdaActionFactory.build(app, {
  onActionError: 'throw',
}, RunReportAction)
```

`build()` returns an async function that accepts the raw Lambda event and returns `Promise<void>`.

## Event Shape

EventBridge Scheduler delivers the schedule's **Input** field directly as the Lambda event. There is no `Records` wrapper. The Lambda runtime parses the Input JSON before the handler is called, so the event arrives as an already-parsed JavaScript value.

Configure the Input when creating the schedule:

```json
{
  "reportType": "monthly",
  "targetBucket": "my-reports"
}
```

The handler receives this object and passes it to the action as-is (after optional transformation).

## Event Processing

1. The event is validated to be a plain object. Arrays, strings, numbers, and `null` are rejected.
2. `transformInput` is called if provided, receiving the validated object. The return value is used as the action input.
3. A new instance of `ActionClass` is created and `invoke(input)` is called.
4. On failure the error is handled according to `onActionError`.

## Options

| Option | Default | Description |
|---|---|---|
| `onInputError` | `'throw'` | What to do when the event is not a plain object: `'throw'` (rethrow, Lambda fails and Scheduler retries) or `'discard'` (log and return). |
| `onActionError` | `'throw'` | What to do when the action throws: `'throw'` (rethrow, Lambda fails and Scheduler retries) or `'discard'` (log and return). |
| `transformInput` | — | `(input) => Record<string, unknown>` — transform the event before it reaches the action. May be async. |
| `logger` | app logger | Logger used for input and action errors. |

## Error Handling

When the handler throws, Scheduler marks the invocation as failed and retries it according to the schedule's retry policy (configurable up to 185 times). When the handler returns normally, the invocation is considered successful.

| Strategy | When to use |
|---|---|
| `'throw'` | The job must complete. Scheduler retries on failure. Use when the action is idempotent or when partial execution is worse than re-running from the start. |
| `'discard'` | Failures should be silently absorbed. Use for fire-and-forget tasks where a missed run is acceptable. |

## Notes

- The app must be initialized before calling `build()`.
- Unlike SQS and SNS, there is no parsing step — the Lambda runtime already deserializes the Input JSON. The adapter only validates that the result is a plain object.
- `handleError` on the action class is honoured — if it recovers without rethrowing, the invocation is treated as a success.
- Scheduler does not expose an invocation identifier in the event payload. Use `context.awsRequestId` (the Lambda context object, not passed to the handler by default) or a correlation ID in your Input for log tracing.
