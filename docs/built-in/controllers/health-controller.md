# ODHealthController

Provides a `GET /health` endpoint.

## Usage

```ts
import { ODHealthController } from 'orange-dragonfly'

app.useController(ODHealthController)
```

## Response

```json
{
  "status": "ok",
  "uptime": 42.3,
  "timestamp": "2026-02-22T00:00:00.000Z"
}
```

- `uptime` - seconds since the Node.js process started (`process.uptime()`)
- `timestamp` - current time in ISO 8601 format
