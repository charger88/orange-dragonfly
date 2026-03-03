# ODWebServer

HTTP/1.1 transport. Supports plain HTTP and HTTPS.

## Usage

```ts
import { ODWebServer } from 'orange-dragonfly'

await ODWebServer.run(app, options)
```

`run()` starts the server, optionally installs signal handlers (`handleProcessSignals: true`), and returns a `stop()` function.

## Options

| Option | Default | Description |
|---|---|---|
| `port` | `8888` | Port to listen on |
| `host` | `'0.0.0.0'` | Host to bind to |
| `tls` | - | TLS credentials (enables HTTPS; see below) |
| `maxBodySize` | `1048576` | Max request body in bytes. `null` = unlimited |
| `requestTimeout` | `null` | Request timeout in ms. `null` = no timeout |
| `gracefulShutdownTimeout` | `10000` | Ms to wait before force-closing sockets on shutdown. `null` = wait indefinitely |
| `handleProcessSignals` | `true` | Install `SIGINT`/`SIGTERM` handlers automatically |
| `errorHandler` | `null` | Custom transport-level error handler (called when request processing throws unexpectedly) |
| `logger` | app logger | Logger for server events |

## HTTPS

Pass a `tls` object to enable HTTPS:

```ts
import { readFileSync } from 'node:fs'

await ODWebServer.run(app, {
  port: 443,
  tls: {
    key:  readFileSync('server.key'),
    cert: readFileSync('server.crt'),
    ca:   readFileSync('ca.crt'),  // optional
  },
})
```

## Graceful Shutdown

When a `SIGINT` or `SIGTERM` signal is received (or `stop()` is called manually):

1. The server stops accepting new connections.
2. Idle connections are closed immediately.
3. In-flight requests are allowed to complete.
4. After `gracefulShutdownTimeout` ms, any remaining sockets are forcibly destroyed.
5. `app.unload()` is called.

To manage shutdown manually (e.g. integrate with your own signal handling):

```ts
const stop = await ODWebServer.run(app, { handleProcessSignals: false })
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
```
