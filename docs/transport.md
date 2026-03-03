# Transports

A transport is the layer that sits between the outside world and the app core. It receives work from some source, converts it into the framework's native types, hands it to the app, and delivers the result back.

The app core (`ODApp`) knows nothing about sockets, HTTP, or processes. It only works with `ODRequest` and `ODResponse` objects. This means:

- The same app can be served over HTTP/1.1, HTTP/2, or any other protocol.
- You can run it in a serverless function, a test harness, or any custom environment.
- Swapping the transport requires no changes to controllers, actions, or middleware.

## Transport Contract

### HTTP requests

```ts
// 1. Build an ODRequest (prefer app.createRequest() so app-level request options apply)
const request = app.createRequest({
  method: 'GET',
  url: '/users?limit=10',
  headers: { 'content-type': 'application/json' },
  body: Buffer.from(''),
  ip: '127.0.0.1',
})

// 2. Hand it to the app (app must be init()-ed first)
const response = await app.processRequest(request)

// 3. Use response.code, response.headers, and response.content to send the reply
```

### CLI actions

```ts
// 1. Parse the input however you like
const input = { name: 'Alice' }

// 2. Run the action by name
const result = await app.processAction('hello-action', input)

// 3. Use the result string
console.log(result)
```

## Writing a Custom Transport

Any code that follows the contract above is a valid transport. A minimal example for a serverless function:

```ts
export async function handler(event) {
  const request = app.createRequest({
    method: event.httpMethod,
    url: event.path + (event.rawQueryString ? '?' + event.rawQueryString : ''),
    headers: event.headers ?? {},
    body: event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : Buffer.alloc(0),
    ip: event.requestContext?.http?.sourceIp,
  })

  const response = await app.processRequest(request)
  const [contentType, body] = await response.convert()
  const headers = new Map<string, string[]>()
  for (const h of response.headers) {
    const key = h.name.toLowerCase()
    const existing = headers.get(key)
    if (existing) existing.push(h.value)
    else headers.set(key, [h.value])
  }
  if (contentType && !headers.has('content-type')) {
    headers.set('content-type', [contentType])
  }

  return {
    statusCode: response.code,
    // Adapt this shape to your platform (e.g. multiValueHeaders/cookies) if needed.
    headers: Object.fromEntries(Array.from(
      headers,
      ([name, values]) => [name, values.length === 1 ? values[0] : values],
    )),
    body: body instanceof Buffer ? body.toString('base64') : body,
    isBase64Encoded: body instanceof Buffer,
  }
}
```

## AWS Lambda Adapters

Orange Dragonfly includes two built-in adapters for API Gateway:

- `ODAwsRestApiHandlerFactory` for API Gateway REST API (v1) events
- `ODAwsHttpApiHandlerFactory` for API Gateway HTTP API (v2) events

Both adapters:

- accept an already initialized app and return an async Lambda handler via `build(app, options)`
- decode incoming request bodies when `isBase64Encoded` is `true`
- enforce `maxBodySize` on the decoded request body (`1048576` bytes by default, `null` = unlimited)
- enforce `maxResponseSize` on the serialized Lambda response body (`6291456` bytes by default, `null` = unlimited)
- convert unexpected transport-level failures into a `500` response when possible
- always create framework requests with `https` as the protocol

Use the REST API adapter when API Gateway sends `httpMethod`, `path`, `multiValueHeaders`, and `multiValueQueryStringParameters`.

Use the HTTP API adapter when API Gateway sends `rawPath`, `rawQueryString`, and the v2 `cookies` array.

## Built-in Transports

- [ODWebServer](built-in/transport/web-server.md) - HTTP/1.1, with optional HTTPS and graceful shutdown
- [ODHttp2WebServer](built-in/transport/http2-web-server.md) - HTTP/2 (h2 over TLS, or h2c cleartext)
- [ODAwsRestApiHandlerFactory](built-in/transport/aws-rest-api-lambda.md) - API Gateway REST API (v1) Lambda adapter
- [ODAwsHttpApiHandlerFactory](built-in/transport/aws-http-api-lambda.md) - API Gateway HTTP API (v2) Lambda adapter
- [ODCommandLineInterface](built-in/transport/command-line-interface.md) - CLI transport for actions
