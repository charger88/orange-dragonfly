# ODAwsHttpApiHandlerFactory

AWS API Gateway HTTP API (v2) Lambda adapter.

## Usage

```ts
import { ODApp, ODAwsHttpApiHandlerFactory } from 'orange-dragonfly'

const app = await ODApp.create()
  .useController(MyController)
  .init()

export const handler = await ODAwsHttpApiHandlerFactory.build(app)
```

`build()` returns an async function that accepts an API Gateway HTTP API event and returns a Lambda proxy response.

## Request Mapping

- `event.requestContext.http.method` becomes `request.method`
- `event.rawPath` is used as the request path
- `event.rawQueryString` is used as-is when present
- when `rawQueryString` is missing, `event.queryStringParameters` is encoded and used instead
- `event.headers` are normalized to lowercase request headers
- `event.cookies` is merged into a single `cookie` header joined with `; `
- `event.requestContext.http.sourceIp` becomes `request.ip`
- request protocol is always `https`
- `event.body` is decoded from base64 when `event.isBase64Encoded` is `true`

## Response Mapping

The returned Lambda object has this shape:

```ts
{
  statusCode: number,
  headers: Record<string, string>,
  body: string,
  isBase64Encoded: boolean,
  cookies?: string[],
}
```

- duplicate response headers are normalized into the `headers` object
- `Set-Cookie` headers are removed from `headers` and exposed through the top-level `cookies` array
- `Buffer`, `Blob`, and `Readable` responses are base64-encoded

## Options

| Option | Default | Description |
|---|---|---|
| `maxBodySize` | `1048576` | Max decoded request body size in bytes. `null` = unlimited |
| `maxResponseSize` | `6291456` | Max serialized Lambda response body size in bytes. `null` = unlimited |
| `errorHandler` | `null` | Custom transport-level error handler used when `app.processRequest()` throws unexpectedly |
| `logger` | app logger | Logger for malformed requests and transport-level failures |

## Notes

- The app should be initialized before calling `build()`.
- The adapter intentionally uses `rawPath`, which omits API mapping or stage prefixes added by API Gateway.
- If request conversion fails, the adapter returns `400 Bad Request`.
- If the decoded request body exceeds `maxBodySize`, the adapter returns `413 Payload Too Large`.
- If controller execution throws, the adapter uses `errorHandler` when provided, otherwise it returns `500 Internal Server Error`.
- If response serialization fails, the adapter logs the failure and returns a minimal `500` response when possible.
