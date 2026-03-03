# CSRF Protection

Cross-Site Request Forgery (CSRF) is an attack where a malicious website tricks a browser into making authenticated requests to your API on the user's behalf.

## When you are NOT vulnerable

**Bearer-token APIs are not vulnerable to CSRF.** If your API authenticates requests using an `Authorization: Bearer <token>` header (the default pattern with `ODJWTMiddleware`), browsers will never attach that header to cross-site requests automatically. No CSRF protection is needed.

## When you ARE vulnerable

If your API authenticates requests using **cookies** (e.g. session cookies set with `Set-Cookie`), browsers will automatically include those cookies on cross-origin requests, making CSRF possible.

## Mitigations

### 1. SameSite cookie attribute (recommended)

Set `SameSite=Strict` or `SameSite=Lax` on session cookies. Modern browsers (all major browsers since 2020) will not send `SameSite=Strict` cookies on cross-site requests at all, and `SameSite=Lax` only sends them on top-level navigations (not on form POSTs or XHR).

```
Set-Cookie: session=<value>; HttpOnly; Secure; SameSite=Strict
```

`SameSite=Lax` is a good default for most applications. Use `Strict` if you can tolerate users being logged out when following external links to your app.

### 2. Custom request header check

Require a custom header on all mutating requests (e.g. `X-Requested-With: XMLHttpRequest`). Browsers will not add custom headers to cross-origin simple requests without a preflight — if the preflight is rejected (because the origin is not in the CORS allowlist), the actual request never reaches your server.

This is only effective when combined with a strict CORS policy. Implement it as middleware:

```ts
const requireXhrHeader: ODMiddlewareFunction = async (context) => {
  const method = context.request.method
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const xrw = context.request.getHeader('x-requested-with')
    if (!xrw) {
      return context.response.setError(403, 'CSRF check failed')
    }
  }
}

app.useMiddleware(requireXhrHeader)
```

### 3. Origin / Referer header validation

Check that the `Origin` or `Referer` header matches your expected domain on mutating requests. This is a defence-in-depth measure — some requests may not include these headers (e.g. from non-browser clients), so use this alongside another mitigation rather than as the sole defence.

```ts
const ALLOWED_ORIGINS = new Set(['https://app.example.com'])

const csrfOriginCheck: ODMiddlewareFunction = async (context) => {
  const method = context.request.method
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const origin = context.request.getHeader('origin')
      ?? context.request.getHeader('referer')
    if (!origin || !ALLOWED_ORIGINS.has(new URL(origin).origin)) {
      return context.response.setError(403, 'CSRF check failed')
    }
  }
}
```

## Summary

| Scenario | Recommendation |
|---|---|
| Bearer token auth (Authorization header) | No CSRF protection needed |
| Cookie auth, modern browsers only | `SameSite=Strict` or `SameSite=Lax` cookie attribute |
| Cookie auth, defence in depth | `SameSite` + custom header check + strict CORS policy |
