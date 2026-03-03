# Requests

## Request ID

Each `ODRequest` is assigned a UUID (`request.id`). The ID could be included in responses as the `X-Request-Id` header. Use it for correlation in logs:

```ts
app.onRequestCompleted(async (context) => {
  context.app.logger.info(
    `${context.request.id} ${context.request.method} ${context.request.path} -> ${context.response.code}`
  )
})
```

## Request Properties

```ts
request.id          // string - UUID
request.ip          // string - client IP address
request.now         // number - timestamp when request was created (Date.now())
request.method      // string - uppercase HTTP method ('GET', 'POST', ...)
request.url         // string - raw request URL from the transport (typically '/path?query=...')
request.path        // string - URL pathname
request.host        // string - host with port (e.g. 'api.example.com:3000')
request.hostname    // string - domain only (e.g. 'api.example.com')
request.port        // number | null - port if present
request.headers     // Record<string, string> - all headers (lowercase keys)
request.contentType // string - Content-Type header value (without parameters)
```

### Getting a Header

```ts
request.getHeader('authorization')           // string | undefined
request.getHeader('x-custom', 'default')     // returns default if missing
```

### Host header and derived properties

`request.host`, `request.hostname`, and `request.port` are derived from the `Host` request header sent by the client. Because `Host` is attacker-controlled, **do not use these properties for security decisions** (e.g. constructing redirect URLs, validating origin, or building absolute URLs that will be rendered to users) without validating the value against a known-good allowlist first.

```ts
const ALLOWED_HOSTS = new Set(['api.example.com', 'api.example.com:8443'])

async doGet() {
  if (!ALLOWED_HOSTS.has(this.request.host)) {
    return this.setError(400, 'Invalid Host header')
  }
  // safe to use this.request.hostname here
}
```

For informational uses — logging, tracing, or selecting a locale — the raw value is fine as-is.

## Body Parsing

The body is parsed automatically based on `Content-Type`:

| Content-Type | Parsed as |
|---|---|
| `application/json` | Any valid JSON value (object, array, string, number, boolean, or `null`) |
| `application/x-www-form-urlencoded` | Object (key/value pairs) |
| `multipart/form-data` | Object (fields and file parts) |
| Any other | String (raw body text) |

When content type is absent, the framework attempts JSON and falls back to a string.

```ts
const body = this.request.body  // parsed body
const raw  = this.request.rawBody  // Buffer - original bytes
```

## Query Parameters

```ts
request.query            // Record<string, unknown> - parsed query params
request.querySearchParams // URLSearchParams - raw query params

request.getQueryParam('limit')           // unknown (null if missing)
request.getQueryParam('limit', 100)      // returns 100 if missing
```

Both URL query strings and URL-encoded bodies are parsed using the app's configured query parser (`ODAppOptions.queryParser`). The query parser can coerce specific parameter names to integers automatically:

```ts
ODApp.create({
  queryParser: { integerParameters: ['offset', 'limit', 'page'] }
})
```

## Route Parameters

Path parameters are passed directly to the handler method. Params starting with `#` in the route pattern are parsed as numbers (e.g. `{#id}` becomes `params.id`):

```ts
// Route: GET /users/{#id}
async doGetId(params: { id: number }) {
  return { id: params.id, type: typeof params.id }  // number
}

// Route: GET /posts/{slug}
class PostsController extends ODController {
  static get idParameterName() { return 'slug' }
  async doGetId(params: { slug: string }) {
    return { slug: params.slug }  // string
  }
}
```

See [Controllers](controllers.md) for more on route parameter configuration.
