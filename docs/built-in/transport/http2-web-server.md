# ODHttp2WebServer

HTTP/2 transport. Supports h2 (over TLS) and h2c (cleartext, e.g. behind a TLS-terminating proxy).

## Usage

```ts
import { ODHttp2WebServer } from 'orange-dragonfly'

await ODHttp2WebServer.run(app, options)
```

## h2 (TLS)

```ts
import { readFileSync } from 'node:fs'

await ODHttp2WebServer.run(app, {
  port: 443,
  tls: {
    key:  readFileSync('server.key'),
    cert: readFileSync('server.crt'),
    ca:   readFileSync('ca.crt'),  // optional
    allowHTTP1: true,              // allow HTTP/1.1 clients via TLS fallback; default: true
  },
})
```

## h2c (Cleartext)

Omit `tls` to run HTTP/2 without TLS. Suitable when TLS is terminated upstream (load balancer, reverse proxy):

```ts
await ODHttp2WebServer.run(app, { port: 8080 })
```

## Options

Supports the same options as [ODWebServer](web-server.md) except `requestTimeout` (not applicable to HTTP/2), plus:

| Option | Default | Description |
|---|---|---|
| `tls.allowHTTP1` | `true` | Allow HTTP/1.1 clients to connect via TLS negotiation fallback |

## Graceful Shutdown

Same behaviour as [ODWebServer](web-server.md#graceful-shutdown). On shutdown, open HTTP/2 sessions are drained and then destroyed after the timeout.
