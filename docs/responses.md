# Responses

## Returning from a Handler

A controller action can return:

| Return value | Result |
|---|---|
| Object or array | JSON body, `200` |
| String | `text/plain` body, `200` |
| `Buffer` | Binary body (no content type inferred) |
| `Blob` | Binary body (`blob.type` is used as content type) |
| `Readable` | Streamed body (set content type explicitly) |
| `ODResponse` | Used as-is |
| `undefined` | `this.response` used as-is |

```ts
async doGet() {
  return { users: [] }                      // JSON 200
}

async doGetId(params) {
  return this.context.app.createResponse(200, { id: params.id })  // explicit
}
```

## Creating a Response

Use `app.createResponse()` to create a response that inherits the app's default response options (e.g. `compactJsonResponse`):

```ts
app.createResponse(201, { id: 1 })           // JSON 201
app.createResponse(204)                       // empty
app.createResponse(200, 'ok')                 // text/plain
```

Or construct `ODResponse` directly:

```ts
import { ODResponse } from 'orange-dragonfly'
new ODResponse(200, { message: 'ok' })
```

## Response Properties

```ts
response.code     // number - HTTP status code
response.content  // ODResponseContent - body
response.headers  // ODResponseHeader[] - response headers
response.sent     // boolean - whether the response has already been sent
```

## Setting Headers

```ts
// Add a header (allows multiple values for the same name)
response.addHeader('Set-Cookie', 'session=abc; HttpOnly')
response.addHeader('Set-Cookie', 'theme=dark')

// Replace or remove a header
response.setHeader('Content-Type', 'application/json')
response.setHeader('X-Old-Header')           // removes it
```

## Error Responses

```ts
response.setError(404, 'Not found')
response.setError(422, 'Validation failed', { field: 'email' })
```

Produces:

```json
{ "error": "Not found" }
{ "error": "Validation failed", "field": "email" }
```

The `setError` method returns the response object itself, so it can be returned directly from a handler:

```ts
return this.response.setError(403, 'Forbidden')
// or
return this.setError(403, 'Forbidden')  // shortcut on ODController
```

## Response Options

Control JSON serialization via `ODAppOptions.responseOptions`:

```ts
ODApp.create({
  responseOptions: { compactJsonResponse: false }  // pretty-print JSON
})
```

When `compactJsonResponse` is `true` (the default), JSON is serialized without indentation. Use `app.createResponse()` to ensure app-level options are applied.

## Streaming

Stream a response body using a Node.js `Readable`:

```ts
import { createReadStream } from 'node:fs'

async doGetFile() {
  const stream = createReadStream('./report.csv')
  this.response.stream(stream, 'text/csv')
  this.response.setHeader('Content-Disposition', 'attachment; filename="report.csv"')
}
```

## Content Type Detection

When content type is not set explicitly, it is inferred from the body:

| Body type | Content-Type |
|---|---|
| Object / array | `application/json` |
| String | `text/plain` |
| `Buffer` | *(none - binary)* |
| `Blob` | Uses `blob.type` |
| `Readable` | Streamed by transport; set `Content-Type` explicitly (prefer `response.stream()`) |
