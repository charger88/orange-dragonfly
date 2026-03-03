# ODCORSMiddleware

Adds CORS headers to responses and handles preflight (`OPTIONS`) requests.

**Must be registered as a beforeware** so CORS headers are present on app-level responses, including controller/app pipeline errors (transport-level errors like malformed requests or body-size rejections happen before middleware runs).

## Usage

```ts
import { ODCORSMiddleware } from 'orange-dragonfly'

app.useMiddleware(ODCORSMiddleware({
  origins: ['https://example.com', 'https://*.example.com'],
  allowHeaders: ['content-type', 'authorization'],
  exposeHeaders: ['x-request-id'],
  credentials: true,
  maxAge: 86400,
  rejectUnallowed: false,
}))
```

## Options

| Option | Default | Description |
|---|---|---|
| `origins` | `['*']` | Allowed origins. Supports exact match, `*` (global wildcard), `*.example.com` (single-level subdomain wildcard), and `**.example.com` (multi-level subdomain wildcard) |
| `allowHeaders` | `[]` | `Access-Control-Allow-Headers` value. If empty, the request's `Access-Control-Request-Headers` is echoed back |
| `exposeHeaders` | `[]` | `Access-Control-Expose-Headers` value |
| `credentials` | `false` | Set `Access-Control-Allow-Credentials: true` |
| `maxAge` | - | `Access-Control-Max-Age` in seconds (preflight cache duration) |
| `rejectUnallowed` | `false` | Return `403` for disallowed origins instead of silently omitting CORS headers |

## Behaviour

- Requests without an `Origin` header are passed through unchanged.
- When `origins: ['*']` and `credentials: false`, the wildcard `*` is sent directly.
- When using specific origins or `credentials: true`, the actual request origin is echoed and `Vary: Origin` is added.
- Preflight `OPTIONS` responses are handled by the framework's built-in `corsOptions` controller action, which sets `Access-Control-Allow-Methods`. This middleware contributes the remaining preflight headers (`Access-Control-Allow-Headers`, `Access-Control-Max-Age`, `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`).

## Security note: `credentials` and `origins`

Combining `credentials: true` with `origins: ['*']` is **not allowed** — ODCORSMiddleware throws an error at startup if this configuration is detected. A wildcard origin with credentials would grant every website access to your authenticated API resources.

Always pair `credentials: true` with an explicit list of allowed origins:

```ts
app.useMiddleware(ODCORSMiddleware({
  origins: ['https://app.example.com'],
  credentials: true,
}))
```

## Security note: `allowHeaders` reflection

When `allowHeaders` is left at its default (`[]`), the value of the incoming `Access-Control-Request-Headers` preflight header is echoed back verbatim as `Access-Control-Allow-Headers`. This means a browser preflight can nominate any custom header and have it whitelisted.

**In production, always set `allowHeaders` explicitly** to the exact list your API requires:

```ts
app.useMiddleware(ODCORSMiddleware({
  origins: ['https://example.com'],
  allowHeaders: ['content-type', 'authorization'],
}))
```

Leaving `allowHeaders` empty is acceptable only in fully-trusted internal environments where all clients are under your control.
