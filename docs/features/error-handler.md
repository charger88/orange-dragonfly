# Error Handler

Orange Dragonfly no longer uses a separate `ODErrorHandler` class.

App-level error responses are produced in two places:

- `ODNotFoundController` (for unmatched routes / `404`)
- `ODApp.processErrorRequest()` (for thrown `ODRequestError` and unexpected errors)

## 404 Not Found (Unmatched Routes)

Unmatched routes are routed to a built-in controller (`ODNotFoundController`) by default. Because 404s go through a controller, they also go through the normal middleware pipeline.

Customize the 404 response by passing `notFoundController` to `ODApp.create()`:

```ts
import { ODApp, ODNotFoundController } from 'orange-dragonfly'

class MyNotFoundController extends ODNotFoundController {
  async e404() {
    return this.setError(404, 'Nothing here')
  }
}

const app = await ODApp
  .create({ notFoundController: MyNotFoundController })
  .init()
```

## Thrown Errors (ODRequestError / 500)

When `ODRequestError` (or another unhandled error) escapes the controller pipeline, `ODApp.processErrorRequest()` builds the response.

Default behavior:

- `ODRequestError(status, message)` -> `{ error: message }` with the given status
- unexpected errors -> `{ error: 'Error' }` with `500`

## Customizing `processErrorRequest()`

Subclass `ODApp` and override the protected method:

```ts
import { ODApp, ODContext, ODResponse } from 'orange-dragonfly'

class MyApp extends ODApp {
  protected async processErrorRequest(
    context: ODContext,
    statusCode: number,
    message?: string,
  ): Promise<ODResponse> {
    if (statusCode === 422) {
      return context.response.setError(422, message ?? 'Validation failed')
    }

    if (statusCode >= 500) {
      return context.response.setError(500, 'Internal server error')
    }

    return context.response.setError(statusCode, message ?? 'Error')
  }
}
```

## Notes

- `ODController.handleError()` is still the right place for per-controller/domain-specific error handling.
- `ODWebServer` / `ODHttp2WebServer` also have a transport-level `errorHandler` option. That is separate from app-level request error formatting.
