# Serving Static Files

`serveStaticFiles` streams a file from a directory to the client. It handles path validation, MIME type detection, security checks, caching headers, and RFC-compliant HTTP range requests when `strongEtags` is enabled.

## Usage

```ts
import { serveStaticFiles } from 'orange-dragonfly'

class AssetsController extends ODController {
  static get path() { return '/assets' }
  static get idParameterName() { return 'file' }  // string param (single path segment)

  async doGetId(params: { file: string }) {
    return serveStaticFiles(params.file, './public', this.response, this.request)
  }
}
```

Or from a catch-all route that delegates arbitrary sub-paths:

```ts
class StaticController extends ODController {
  static get pathGet() { return '/static/{+proxy}' }

  async doGet(params: { proxy: string }) {
    return serveStaticFiles(params.proxy, './public', this.response, this.request)
  }
}
```

Pass `this.request` as the fourth argument to enable conditional requests (304) and range requests (206). Omit it (or pass `null`) if you do not need those features.

## Signature

```ts
serveStaticFiles(
  requestedPath: string,
  baseDir: string,
  response: ODResponse,
  request?: ODRequest | null,
  options?: ServeStaticOptions,
): Promise<ODResponse>
```

| Parameter | Description |
|---|---|
| `requestedPath` | Path from the request (percent-encoding is decoded internally) |
| `baseDir` | Directory to serve files from |
| `response` | The current response object (from `this.response`) |
| `request` | Optional - enables conditional and range requests |
| `options` | Optional configuration |

Returns the same `ODResponse` configured for streaming (`200`/`206`/`304`) or set to an error code.

## Options

```ts
interface ServeStaticOptions {
  mimeTypes?: Record<string, string>   // Additional or override MIME type mappings
  cacheControl?: string | false        // Cache-Control header value, or false to omit
  charset?: string                     // Charset appended to text Content-Type headers
  strongEtags?: boolean                // Use content-hash ETags and enable byte-range responses
}
```

### `mimeTypes`

Custom MIME types are merged over the built-in table:

```ts
return serveStaticFiles(filePath, './public', this.response, this.request, {
  mimeTypes: {
    '.wasm': 'application/wasm',
  },
})
```

### `cacheControl`

Default value: `'public, max-age=3600'`. Set to `false` to omit the header:

```ts
return serveStaticFiles(filePath, './public', this.response, this.request, {
  cacheControl: 'public, max-age=86400, immutable',
})
```

### `charset`

When set, the charset is appended to the `Content-Type` header for text-based MIME types (`text/*`, `application/json`, `application/javascript`, `application/xml`). Binary types such as `image/*` are not affected. Default: not set (no charset appended).

```ts
return serveStaticFiles(filePath, './public', this.response, this.request, {
  charset: 'utf-8',
  // e.g. text/html -> 'text/html; charset=utf-8'
  //      application/json -> 'application/json; charset=utf-8'
})
```

### `strongEtags`

Default: `false`.

When enabled, `serveStaticFiles` hashes the file contents and emits a strong ETag instead of the default weak `mtime + size` validator.

This option also enables `206 Partial Content` responses for `Range` requests. When `strongEtags` is `false`, `Range` is ignored and the full file is served with `200` instead. This keeps partial responses aligned with strong validators.

Because the file must be read to build the hash before the response starts streaming, this adds extra disk I/O and CPU work.

```ts
return serveStaticFiles(filePath, './public', this.response, this.request, {
  strongEtags: true,
})
```

## Response Headers

The following headers are added on successful file-body responses (`200` and `206`):

| Header | Value |
|---|---|
| `Content-Type` | Detected from extension (see MIME table below) |
| `Content-Length` | Exact byte size of the file (or range chunk) |
| `ETag` | Weak `mtime + size` tag for normal `200`/`304` responses by default, or a strong content hash when `strongEtags` is enabled |
| `Last-Modified` | File modification time in HTTP-date format |
| `Accept-Ranges` | `bytes` when `strongEtags` is enabled |
| `Cache-Control` | `public, max-age=3600` by default (configurable) |

For `304 Not Modified`, cache validators are still added (`ETag`, `Last-Modified`, optional `Cache-Control`, and `Accept-Ranges` when `strongEtags` is enabled), but no body is sent and body-specific headers such as `Content-Type` / `Content-Length` are not added.

## Conditional Requests (304 Not Modified)

When `request` is provided and a matching `If-None-Match` or `If-Modified-Since` header is present, the function returns `304 Not Modified` with no body. This avoids re-sending unchanged content.

```
GET /assets/logo.png
If-None-Match: "17d8e5a2-1a4"

-> 304 Not Modified  (headers only, no body)
```

## Range Requests (206 Partial Content)

When `request` is provided, `strongEtags` is enabled, and a `Range` header is present, the function returns `206 Partial Content` with the requested byte slice and a `Content-Range` header.

If the client also sends `If-Range`, a stale validator disables range processing and the full file is served with `200` instead. ETag-based `If-Range` works with the current strong ETag. Date-based `If-Range` uses an exact `Last-Modified` match (second precision), which assumes the filesystem mtime is strong enough for that comparison.

```
GET /assets/video.mp4
Range: bytes=0-1048575

-> 206 Partial Content
   Content-Range: bytes 0-1048575/52428800
   Content-Length: 1048576
```

Multi-range requests (`bytes=0-499,600-999`) are not supported; the `Range` header is ignored and the file is served normally (`200` response). Unsatisfiable single-range requests return `416 Range Not Satisfiable` with a `Content-Range: bytes */total` header. When `strongEtags` is disabled, all `Range` headers are ignored and the file is served normally (`200` response).

## Built-in MIME Types

| Extension | Content-Type |
|---|---|
| `.txt` | `text/plain` |
| `.html`, `.htm` | `text/html` |
| `.json` | `application/json` |
| `.js` | `application/javascript` |
| `.css` | `text/css` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.svg` | `image/svg+xml` |
| `.pdf` | `application/pdf` |
| `.webp` | `image/webp` |
| `.ico` | `image/x-icon` |
| `.woff` | `font/woff` |
| `.woff2` | `font/woff2` |
| `.mp4` | `video/mp4` |
| `.mp3` | `audio/mpeg` |
| `.xml` | `application/xml` |
| `.csv` | `text/csv` |
| `.zip` | `application/zip` |

Unknown extensions fall back to `application/octet-stream`.

## Error Responses

| Situation | Response |
|---|---|
| Path contains null bytes, a colon, or invalid percent-encoding | `404 File not found` |
| Path resolves outside `baseDir` (traversal attempt) | `404 File not found` |
| Symlink points outside `baseDir` | `404 File not found` |
| File does not exist | `404 File not found` |
| Path points to a directory or device | `404 File not found` |
| `Range` header present but unsatisfiable | `416 Range Not Satisfiable` |

All security-gate rejections return `404` rather than `400` or `403` to avoid leaking filesystem structure to clients.

## Security

The function resolves symlinks via `realpath` and verifies the resolved path is strictly inside `baseDir` before serving. `..` segments, absolute paths, colon-containing paths, and out-of-directory symlinks are all rejected silently with `404`.
