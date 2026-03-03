# Middlewares

Middlewares are functions that run before or after a controller action. They can inspect or modify the request/response, short-circuit the chain, and pass data to downstream handlers via context state.

## Middleware Function

```ts
type ODMiddlewareFunction = (
  context: ODContext,
  params?: ODRouteParams,
) => Promise<ODResponse | undefined | void>
```

- Return `undefined` to continue to the next step.
- Return an `ODResponse` to short-circuit - the chain stops and that response is sent.

## Beforeware and Afterware

Middleware registered without a second argument runs before the action (beforeware). Pass `true` to run after (afterware):

```ts
app.useMiddleware(ODCORSMiddleware())         // beforeware (default)
app.useMiddleware(myLoggingFn, true)          // afterware
```

### Execution Order

```
1. App beforewares       (in registration order)
2. Controller beforewares
3. Validation            (body -> query -> custom)
4. Action                (doGet, doPost, ... / ODNotFoundController.e404 on not-found endpoint)
5. Controller afterwares
6. App afterwares
```

Important notes:

- Routing happens before the middleware chain, so `context.route` and route params are already available to app-level middleware.
- `ODCORSMiddleware()` must run as a beforeware so CORS headers are present on app-level error responses (transport-level errors like malformed requests or body-size rejections happen before middleware runs).
- Unmatched routes (404) still run through the middleware chain via `ODNotFoundController`.
- If an error escapes the controller pipeline and `ODApp.processErrorRequest()` builds the response, remaining afterwares are not run.
- For access logging, prefer `onRequestCompleted()` over afterware in app setup.

## Writing Custom Middleware

```ts
import type { ODMiddlewareFunction } from 'orange-dragonfly'

const requireApiKey: ODMiddlewareFunction = async (context) => {
  const key = context.request.getHeader('x-api-key')
  if (key !== process.env.API_KEY) {
    return context.response.setError(401, 'Invalid API key')
  }
  // return undefined to continue
}

app.useMiddleware(requireApiKey)
```

### Passing Data to Controllers

Store values in `context.state` and read them in the controller:

```ts
// middleware
context.state.set('resolvedUser', user)

// controller
const user = this.context.state.get('resolvedUser') as User
```

## Built-in Middleware

- [ODCORSMiddleware](built-in/middlewares/cors-middleware.md) - CORS headers and preflight handling
- [ODJWTMiddleware](built-in/middlewares/jwt-middleware.md) - JWT verification; includes `ODWithUser` decorator
- [ODRateLimitMiddleware / ODGlobalRateLimitMiddleware](built-in/middlewares/rate-limit-middleware.md) - per-IP rate limiting
- [ODObjectResolverMiddleware](built-in/middlewares/object-resolver-middleware.md) - auto-resolve route params to objects
- [ODSecurityHeadersMiddleware](built-in/middlewares/security-headers-middleware.md) - security-related HTTP response headers

## Security Guidance

- [CSRF Protection](features/csrf.md) - when CSRF matters and how to mitigate it
