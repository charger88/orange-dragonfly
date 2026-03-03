# ODRateLimitMiddleware / ODGlobalRateLimitMiddleware

Limits requests per IP using the app cache. Returns `429` when a limit is exceeded.

This middleware can be registered as an app-level beforeware (`app.useMiddleware(...)`). In the current request pipeline, routing is resolved before middleware runs, so controller/action-specific rules can safely inspect `context.route`.

## Usage

### Simple global limit

```ts
import { ODGlobalRateLimitMiddleware } from 'orange-dragonfly'

app.useMiddleware(ODGlobalRateLimitMiddleware(100, 60))
// 100 requests per 60 seconds per IP
```

### Fine-grained control

```ts
import { ODRateLimitMiddleware } from 'orange-dragonfly'

app.useMiddleware(ODRateLimitMiddleware({
  global: { limit: 200, windowSeconds: 60 },
  controllers: {
    UsersController: { limit: 50, windowSeconds: 60 },
  },
  actions: {
    'UsersController.doPost': { limit: 10, windowSeconds: 60 },
  },
  statusCode: 429,
  message: 'Rate limit exceeded',
}))
```

## Options

| Option | Default | Description |
|---|---|---|
| `global` | - | Rate limit applied to every request |
| `controllers` | - | Per-controller limits, keyed by controller class name |
| `actions` | - | Per-action limits, keyed by `ControllerName.actionMethod` |
| `statusCode` | `429` | HTTP status code when the limit is exceeded |
| `message` | `'Rate limit exceeded'` | Error message in the response body |
| `keyPrefix` | `'odrl'` | Cache key prefix |

Rules are evaluated in order: global -> controller -> action. When multiple rules match, all matching rules are enforced independently. Response headers reflect the most restrictive remaining quota, and any exceeded matching rule can return `429`.

## Response Headers

The following headers are added to every response when rate limiting is active:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum requests allowed in the window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds until the client may retry (only on `429`) |

## Cache Dependency

Rate limiting uses `app.cache`. The default `ODMemoryCache` works for single-process deployments. For multi-instance deployments, plug in a shared cache (e.g. Redis) via `ODApp.create({ cache })`. See [Configuration](../../configuration.md#cache) for details.

> **Warning - per-process counters**
>
> `ODMemoryCache` stores counters in process memory. In a multi-instance deployment (e.g. multiple Node.js processes, containers, or replicas behind a load balancer), each instance maintains its own independent counters. A client can exceed the configured limit by spreading requests across instances - effectively multiplying the real limit by the number of running instances.
>
> For accurate rate limiting across multiple instances, replace the default cache with a shared backend:
>
> ```ts
> import { createClient } from 'redis'
> import { ODRedisCache } from 'my-redis-cache-adapter' // your adapter
>
> const redis = createClient({ url: process.env.REDIS_URL })
> await redis.connect()
>
> const app = ODApp.create({ cache: new ODRedisCache(redis) })
> ```
