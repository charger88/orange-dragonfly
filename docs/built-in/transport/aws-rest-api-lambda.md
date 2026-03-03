# ODAwsRestApiHandlerFactory

AWS API Gateway REST API (v1) Lambda adapter.

## Usage

```ts
import { ODApp, ODAwsRestApiHandlerFactory } from 'orange-dragonfly'

const app = await ODApp.create()
  .useController(MyController)
  .init()

export const handler = await ODAwsRestApiHandlerFactory.build(app)
```

`build()` returns an async function that accepts an API Gateway REST API event and returns a Lambda proxy response.

## Request Mapping

- `event.httpMethod` becomes `request.method`
- `event.path` becomes the request path
- `event.headers` and `event.multiValueHeaders` are merged into lowercase request headers
- `event.multiValueHeaders` overrides `event.headers` for the same header name
- repeated `Cookie` headers are joined with `; `
- `event.multiValueQueryStringParameters` is preferred over `event.queryStringParameters`
- `event.requestContext.identity.sourceIp` becomes `request.ip`
- request protocol is always `https`
- `event.body` is decoded from base64 when `event.isBase64Encoded` is `true`

## Response Mapping

The returned Lambda object has this shape:

```ts
{
  statusCode: number,
  headers: Record<string, string>,
  multiValueHeaders: Record<string, string[]>,
  body: string,
  isBase64Encoded: boolean,
}
```

- duplicate response headers are preserved in `multiValueHeaders`
- the last value for a repeated header is also exposed in `headers`
- `Buffer`, `Blob`, and `Readable` responses are base64-encoded
- repeated `Set-Cookie` headers stay in `multiValueHeaders['set-cookie']`

## Options

| Option | Default | Description |
|---|---|---|
| `maxBodySize` | `1048576` | Max decoded request body size in bytes. `null` = unlimited |
| `maxResponseSize` | `6291456` | Max serialized Lambda response body size in bytes. `null` = unlimited |
| `errorHandler` | `null` | Custom transport-level error handler used when `app.processRequest()` throws unexpectedly |
| `logger` | app logger | Logger for malformed requests and transport-level failures |

## Notes

- The app should be initialized before calling `build()`.
- If request conversion fails, the adapter returns `400 Bad Request`.
- If the decoded request body exceeds `maxBodySize`, the adapter returns `413 Payload Too Large`.
- If controller execution throws, the adapter uses `errorHandler` when provided, otherwise it returns `500 Internal Server Error`.
- If response serialization fails, the adapter logs the failure and returns a minimal `500` response when possible.
