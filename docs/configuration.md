# Configuration

## App Options

`ODApp.create(options)` accepts:

| Option | Type | Description |
|---|---|---|
| `queryParser` | `MagicQueryParserOptions` | Configure query string parsing |
| `responseOptions` | `ODResponseOptions` | Default response options |
| `logger` | `ODLogger` | Custom logger (default: `console`) |
| `notFoundController` | `typeof ODNotFoundController` | Controller used for unmatched routes (`404`). Default: built-in `ODNotFoundController` |
| `cache` | `ODCache` | Custom cache implementation |
| `trustedProxy` | `string[]` | IP addresses of trusted reverse proxies. When the direct client IP matches, the real client IP is read from the rightmost non-trusted entry in the `X-Forwarded-For` header. Default: `[]` (disabled) |

### Query Parser

Coerces named parameters to specific types. Applies to both URL query strings and `application/x-www-form-urlencoded` request bodies.

```ts
ODApp.create({
  queryParser: {
    integerParameters: ['offset', 'limit', 'page'],
    booleanParameters: ['active', 'verified'],
    trueValues: ['1', 'true', 'TRUE', 'True'],  // values that coerce to true (default shown)
  }
})
```

The parser also supports nested structures using bracket notation:

```
?user[name]=Alice&user[age]=30   -> { user: { name: 'Alice', age: '30' } }
?tags[]=a&tags[]=b               -> { tags: ['a', 'b'] }
?items[0]=a&items[1]=b           -> { items: { 0: 'a', 1: 'b' } }
```

Only empty brackets (`[]`) create arrays. Numeric bracket segments such as `[0]` and `[1]` are treated as object keys.

### Response Options

```ts
ODApp.create({
  responseOptions: {
    compactJsonResponse: true,  // compact JSON (no indentation) - this is the default
  }
})
```

## Environment Config Provider

`ODEnvConfigProvider` reads values from `process.env`:

```ts
import { ODEnvConfigProvider } from 'orange-dragonfly'

ODEnvConfigProvider.str('APP_NAME', 'my-app')   // string with fallback
ODEnvConfigProvider.int('PORT', 8080)            // parsed integer with fallback
ODEnvConfigProvider.param('OPTIONAL_VAR')         // string | undefined (no default required)
```

- `str` returns `process.env[name]`, or the default if the variable is absent. Throws if the variable is absent and no default is provided.
- `int` returns the parsed integer, or the default if the variable is absent. Throws if the variable is absent and no default is provided, or if the value is not a valid integer.
- `param` returns `process.env[name]` or `undefined`.

## Transports

The app is decoupled from how it receives requests. See [Transports](transport.md) for the full explanation and how to write your own.

Built-in transports:

- [ODWebServer](built-in/transport/web-server.md) - HTTP/1.1, with optional HTTPS and graceful shutdown
- [ODHttp2WebServer](built-in/transport/http2-web-server.md) - HTTP/2 (h2 over TLS, or h2c cleartext)
- [ODCommandLineInterface](built-in/transport/command-line-interface.md) - CLI transport for actions

## Error Responses

App-level error handling is split into two parts:

- **404 (route not found)**: handled by the configured `notFoundController` (`ODNotFoundController` by default)
- **Thrown request errors / unexpected errors**: handled by `ODApp.processErrorRequest()`

Customise the not-found response:

```ts
import { ODApp, ODNotFoundController } from 'orange-dragonfly'

class MyNotFoundController extends ODNotFoundController {
  async e404() {
    return this.setError(404, 'Nothing here')
  }
}

const app = ODApp.create({ notFoundController: MyNotFoundController })
```

For `400`/`500`/custom thrown `ODRequestError` statuses, subclass `ODApp` and override `processErrorRequest()` (see [Error Handler](features/error-handler.md)).

## Cache

`ODApp` exposes `app.cache`, used internally by rate limiting middleware.

Default implementation: `ODMemoryCache` (in-process, no persistence).

### ODMemoryCache Options

```ts
import { ODMemoryCache } from 'orange-dragonfly'

new ODMemoryCache({
  maxSize: 10_000,                  // max entries; null = unlimited (default)
  overflowStrategy: 'ignore-new',   // what to do when full (see below)
})
```

Overflow strategies (applied after expired entries are purged):

| Strategy | Behaviour |
|---|---|
| `'ignore-new'` | Silently discard the new entry *(default)* |
| `'log'` | Log a warning and discard |
| `'throw'` | Throw an error |
| `'callback'` | Call `onOverflow(key)` - return `true` to allow, `false` to discard |
| `'forced-cleanup'` | Evict one entry (soonest-expiry by default), then insert |

Custom eviction order for `'forced-cleanup'`:

```ts
new ODMemoryCache({
  maxSize: 1000,
  overflowStrategy: 'forced-cleanup',
  // negative return value = evict `a` first; null expiresAt = never expires = evicted last
  evictionComparator: (a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity),
})
```

### Custom Cache

Implement `ODCache` to plug in any storage backend (Redis, Memcached, etc.):

```ts
import type { ODCache } from 'orange-dragonfly'

class RedisCache implements ODCache {
  async get<T>(key: string): Promise<T | null> { ... }
  async set<T>(key: string, value: T, ttlSeconds?: number | null): Promise<void> { ... }
  async delete(key: string): Promise<void> { ... }
  async increment(key: string, ttlSeconds?: number | null): Promise<number | null> { ... }
}

ODApp.create({ cache: new RedisCache() })
```

`increment` must return the new counter value, or `null` if the entry could not be stored (e.g. the cache is full). Rate limiting middleware treats a `null` return as "allow" (fail open).
