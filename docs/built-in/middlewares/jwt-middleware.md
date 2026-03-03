# ODJWTMiddleware

Decodes and verifies a JWT from the request. On success, stores the decoded payload in `context.state`. On failure, returns `401`.

Exactly one key source must be provided: `secret`, `publicKey`, or `jwksUri`.
When using `jwksUri`, it must use `https://`.

## Usage

```ts
import { ODJWTMiddleware } from 'orange-dragonfly'
import fs from 'node:fs'

// Shared secret (HS256)
app.useMiddleware(ODJWTMiddleware({ secret: process.env.JWT_SECRET }))

// RSA/EC public key
app.useMiddleware(ODJWTMiddleware({
  publicKey: fs.readFileSync('public.pem'),
  algorithms: ['RS256'],
}))

// JWKS endpoint (supports automatic key rotation)
app.useMiddleware(ODJWTMiddleware({
  jwksUri: 'https://auth.example.com/.well-known/jwks.json',
  jwksCacheTtl: 600,  // seconds; default: 600
}))
```

## Options

| Option | Default | Description |
|---|---|---|
| `secret` | - | HMAC secret for HS256/384/512 |
| `publicKey` | - | PEM string or DER Buffer for RS*/ES* algorithms |
| `jwksUri` | - | HTTPS JWKS endpoint URL; keys are fetched and cached automatically |
| `jwksCacheTtl` | `600` | How long to cache JWKS keys (seconds) |
| `instantKeyResolution` | `false` | When `true`, an unknown JWT `kid` forces one immediate JWKS refresh. When `false`, unknown `kid` values are rejected until the cache refreshes naturally |
| `algorithms` | `['HS256']` / `['RS256']` | Allowed algorithms |
| `header` | `'authorization'` | Request header to read the token from |
| `scheme` | `'Bearer'` | Token prefix. Set to `null` to read the raw header value |
| `optional` | `false` | When `true`, missing or invalid tokens are silently skipped instead of returning `401` |
| `stateKey` | `'user'` | Key used to store the decoded payload in `context.state` |
| `ignoreCorsOptions` | `true` | Skip verification on CORS preflight `OPTIONS` requests |
| `expirationGap` | `0` | Grace seconds past a token's `exp` claim. For emergency use only |
| `issuer` | - | Expected `iss` claim. String or array of accepted issuers |
| `audience` | - | Expected `aud` claim. String or array of accepted audiences |
| `typ` | - | Expected `typ` header value(s). Rejects tokens whose `typ` does not match (case-insensitive). Common values: `'JWT'`, `'at+jwt'` |
| `crit` | - | Allowed `crit` header parameter names. If a token includes `crit`, every listed name must also be present in the header and appear in this allowlist |
| `clockTolerance` | `60` | Max clock skew in seconds tolerated for `nbf` and `iat` claims |
| `jwksFetchTimeout` | `5000` | Timeout in ms for each JWKS HTTP fetch |
| `jwksMaxBodySize` | `1048576` | Maximum allowed JWKS response body size in bytes |
| `jwksRetries` | `1` | Additional retry attempts for a failed JWKS fetch (0 = no retries) |
| `jtiValidator` | - | Async function for `jti` claim replay prevention (see below) |

## Claim Validation

When `issuer` or `audience` are set, the middleware validates those claims after verifying the signature and expiry. Tokens that do not match return `401`.

```ts
app.useMiddleware(ODJWTMiddleware({
  jwksUri: 'https://auth.example.com/.well-known/jwks.json',
  issuer: 'https://auth.example.com',
  audience: ['api.example.com', 'admin.example.com'],
}))
```

- **`issuer`**: the token's `iss` claim must exactly match one of the provided values.
- **`audience`**: the token's `aud` claim must contain at least one of the provided values (the JWT `aud` claim may be a string or an array).

## Header Validation

When `typ` or `crit` are set, the middleware also validates protected header values:

- **`typ`**: the token's `typ` header must case-insensitively match one of the configured values.
- **`crit`**: if the token includes a `crit` header, it must be a non-empty array; each listed name must be present in the JWT header and included in `options.crit`. If `options.crit` is omitted, tokens with `crit` are rejected.

The `crit` option validates the declared critical header names. Use it only for header parameters your deployment intentionally permits.

## jti Claim Validation (Replay Prevention)

Stateless JWTs are inherently replayable — a stolen token can be used until it expires. The `jtiValidator` option provides a hook to implement replay prevention using the `jti` (JWT ID) claim.

When `jtiValidator` is provided:

1. The token **must** contain a non-empty string `jti` claim — tokens without one are rejected.
2. The supplied function is called with the verified payload and the current request context.
3. If the function returns `false`, the token is rejected with `401`.

```ts
app.useMiddleware(ODJWTMiddleware({
  secret: process.env.JWT_SECRET,
  jtiValidator: async (payload, context) => {
    // Example: check a Redis denylist for revoked token IDs
    const revoked = await redis.get(`revoked:${payload.jti}`)
    return revoked === null
  },
}))
```

The function receives the fully verified `ODJWTPayload` (signature, expiry, issuer, and audience already checked), so it only needs to handle the `jti`-specific logic.

A common pattern for single-use tokens is to store the `jti` in a cache with TTL equal to the token's remaining lifetime, and reject tokens whose `jti` is already present:

```ts
jtiValidator: async (payload) => {
  const ttl = (payload.exp ?? 0) - Math.floor(Date.now() / 1000)
  if (ttl <= 0) return false
  const key = `used-jti:${payload.jti}`
  const already = await cache.get(key)
  if (already) return false   // replay detected
  await cache.set(key, 1, ttl)
  return true
}
```

## Supported Algorithms

- HMAC: `HS256`, `HS384`, `HS512`
- RSA: `RS256`, `RS384`, `RS512`
- EC: `ES256`, `ES384`, `ES512`

## JWKS Key Rotation

When using `jwksUri`, the middleware caches keys in-process. By default, if a token's `kid` is not found in a still-fresh cache, the token is rejected and the middleware does not force an immediate JWKS refresh.

Set `instantKeyResolution: true` to restore the eager behavior: an unknown `kid` forces one immediate JWKS refresh so newly published keys can be discovered on demand.

Concurrent requests that trigger a refresh all share a single in-flight fetch - the endpoint is called exactly once regardless of the number of simultaneous requests waiting on it.

## Reading the Payload in a Controller

```ts
async doGet() {
  const user = this.context.state.get('user') as MyUser
  return { id: user.sub }
}
```

## ODWithUser Decorator

Adds a typed `user` getter to a controller class. The getter reads from `context.state` using the configured `stateKey`.

```ts
import { ODWithUser } from 'orange-dragonfly'

interface MyUser { id: string; email: string }

@ODWithUser<MyUser>()
class ProfileController extends ODController {
  declare user: MyUser | undefined  // enables this.user typing inside the class

  async doGet() {
    return { email: this.user?.email }
  }
}
```

The `declare` field is needed only for TypeScript type-checking inside the class body. The decorator handles the actual property definition at runtime.
