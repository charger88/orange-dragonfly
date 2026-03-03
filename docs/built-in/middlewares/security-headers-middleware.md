# ODSecurityHeadersMiddleware

Adds security-related HTTP response headers to every response. All headers are opt-in - nothing is sent without configuration - except `X-Content-Type-Options`, which defaults to `nosniff`.

## Usage

```ts
import { ODSecurityHeadersMiddleware } from 'orange-dragonfly'

app.useMiddleware(ODSecurityHeadersMiddleware({
  frameOptions: 'SAMEORIGIN',
  hsts: { maxAge: 63072000, includeSubDomains: true },
  contentSecurityPolicy: "default-src 'self'",
  referrerPolicy: 'strict-origin-when-cross-origin',
}))
```

## Options

| Option | Header | Default | Description |
|---|---|---|---|
| `contentTypeOptions` | `X-Content-Type-Options` | `'nosniff'` | Set to `false` to omit |
| `frameOptions` | `X-Frame-Options` | omitted | Common values: `'DENY'`, `'SAMEORIGIN'` |
| `hsts` | `Strict-Transport-Security` | omitted | HSTS config object (see below). Only effective over HTTPS |
| `contentSecurityPolicy` | `Content-Security-Policy` | omitted | Raw policy string |
| `referrerPolicy` | `Referrer-Policy` | omitted | E.g. `'strict-origin-when-cross-origin'` |
| `permissionsPolicy` | `Permissions-Policy` | omitted | Raw policy string |
| `crossOriginOpenerPolicy` | `Cross-Origin-Opener-Policy` | omitted | E.g. `'same-origin'` |
| `crossOriginEmbedderPolicy` | `Cross-Origin-Embedder-Policy` | omitted | E.g. `'require-corp'` |
| `crossOriginResourcePolicy` | `Cross-Origin-Resource-Policy` | omitted | E.g. `'same-origin'` |

Set any option to `false` to explicitly omit that header (useful when you want to suppress the `X-Content-Type-Options` default).

## HSTS Options

```ts
interface ODSecurityHeadersHSTSOptions {
  maxAge?: number           // max-age in seconds. Default: 31536000 (1 year)
  includeSubDomains?: boolean  // adds includeSubDomains directive. Default: false
  preload?: boolean         // adds preload directive. Default: false
}
```

The `Strict-Transport-Security` value is built once at middleware creation time and reused for every response.

```ts
// Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
ODSecurityHeadersMiddleware({
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
})
```

> **Note** - HSTS is only effective when the site is served over HTTPS. Browsers ignore it on plain HTTP connections.

## Examples

### Minimal (only default X-Content-Type-Options)

```ts
app.useMiddleware(ODSecurityHeadersMiddleware())
// Sends: X-Content-Type-Options: nosniff
```

### Disable X-Content-Type-Options

```ts
app.useMiddleware(ODSecurityHeadersMiddleware({ contentTypeOptions: false }))
// Sends no headers at all
```

### Typical production setup

```ts
app.useMiddleware(ODSecurityHeadersMiddleware({
  frameOptions: 'DENY',
  hsts: { maxAge: 31536000, includeSubDomains: true },
  contentSecurityPolicy: "default-src 'self'; img-src 'self' data:",
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: 'camera=(), microphone=(), geolocation=(self)',
  crossOriginOpenerPolicy: 'same-origin',
}))
```
