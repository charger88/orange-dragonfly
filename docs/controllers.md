# Controllers

Controllers handle HTTP requests. Each controller maps to a path and contains handler methods for one or more HTTP verbs.

## Creating a Controller

Extend `ODController` and define handler methods:

```ts
import { ODController } from 'orange-dragonfly'

class UsersController extends ODController {
  async doGet() {
    return [{ id: 1, name: 'Alice' }]
  }

  async doPost() {
    const { name } = this.request.body as { name: string }
    return { id: 2, name }
  }
}
```

Register it with the app:

```ts
app.useController(UsersController)
```

Or auto-load a directory tree (only files in real subdirectories under that path; directory symlinks are skipped; controller/action default exports are registered in alphabetical order):

```ts
await app.use('./src/controllers')
```

## Route Generation

Routes are derived from the class name and method names. No explicit registration is needed.

### Path

The base path is derived from the class name:

| Class name | Path |
|---|---|
| `UsersController` | `/users` |
| `UserPostsController` | `/user-posts` |
| `IndexController` | `/` |

The `Controller` suffix is stripped, then CamelCase is converted to dash-case. Override the path with a static getter:

```ts
class UsersController extends ODController {
  static get path() { return '/api/v1/users' }
}
```

### Handler Methods

Format: `do{Verb}[Id][Suffix]`

| Method name | Route |
|---|---|
| `doGet()` | `GET /users` |
| `doPost()` | `POST /users` |
| `doPut()` | `PUT /users` |
| `doPatch()` | `PATCH /users` |
| `doDelete()` | `DELETE /users` |
| `doHead()` | `HEAD /users` |
| `doGetId()` | `GET /users/{#id}` |
| `doDeleteId()` | `DELETE /users/{#id}` |
| `doGetSearch()` | `GET /users/search` |
| `doPostImport()` | `POST /users/import` |
| `doGetIdPosts()` | `GET /users/{#id}/posts` |

Supported verbs: `Get`, `Head`, `Post`, `Patch`, `Put`, `Delete`, `Options`.

The `Suffix` part of the method name is converted to dash-case: `doGetActiveUsers` -> `/users/active-users`.

Every registered path also gets an automatic `OPTIONS` handler for CORS preflight.

### Id Parameter

The default id token is `{#id}`. Params starting with `#` are parsed as numbers. Override it per controller:

```ts
class PostsController extends ODController {
  static get idParameterName() { return '#postId' }
  // doGetId -> GET /posts/{#postId}
}
```

### Per-Action Path Override

Set a static property named `path` + the action name without `do` to override the path for a single action:

```ts
class UsersController extends ODController {
  // Relative - appended to base path -> /users/active-users
  static pathGetActiveUsers = 'active-users'
  async doGetActiveUsers() { ... }

  // Absolute (starts with '/') - replaces the full path
  static pathGetLegacy = '/legacy/users'
  async doGetLegacy() { ... }
}
```

## Accessing Request, Response, and Context

Inside any handler:

```ts
this.app       // ODApp - application object
this.request   // ODRequest - incoming HTTP request
this.response  // ODResponse - outgoing response (modify in place or replace)
this.context   // ODContext - shared context (app, request, response, route, state)
```

## Route Parameters

Params extracted from the URL are passed as the first argument to the handler. Route tokens like `{#id}` become `params.id`:

```ts
async doGetId(params: { id: number }) {
  return { id: params.id }
}

async doGetIdPosts(params: { id: number }) {
  return getPosts(params.id)
}
```

- Params starting with `#` are automatically parsed as numbers.
- Other params are strings.

## Returning a Response

A handler can return:

- **Object or array** -> serialized as JSON with status `200`
- **String** -> returned as `text/plain` with status `200`
- **`Buffer`** -> binary body (no content type inferred)
- **`Blob`** -> binary body (`blob.type` is used as content type)
- **`Readable`** -> streamed body (set content type explicitly; `this.response.stream(...)` is preferred)
- **`ODResponse`** -> used as-is (full control over status, headers, body)
- **`undefined`** -> `this.response` is used as-is

```ts
// JSON 200
async doGet() {
  return { users: [] }
}

// JSON 201
async doPost() {
  return this.context.app.createResponse(201, { id: 1 })
}

// Custom headers
async doGetFile() {
  this.response.setHeader('Content-Disposition', 'attachment; filename="file.txt"')
  return fileBuffer
}
```

## Validation

### Body Validation

Define `bodyValidator{Action}` as an `ODValidator` instance (from `orange-dragonfly-validator`):

```ts
import { ODValidator } from 'orange-dragonfly-validator'

class UsersController extends ODController {
  bodyValidatorPost = new ODValidator({
    name: { type: 'string', required: true },
    age:  { type: 'integer', min: 0 },
  })

  async doPost() {
    const body = this.request.body as { name: string; age: number }
    return { name: body.name }
  }
}
```

If the body is absent or cannot be parsed as an object, a `400` response is returned automatically. If the body is present but fails the validator rules, a `422` response is returned. Either way the action does not run.

### Query Validation

Same pattern with `queryValidator{Action}`:

```ts
queryValidatorGet = new ODValidator({
  limit:  { type: 'integer', min: 1, max: 100 },
  offset: { type: 'integer', min: 0 },
})
```

### Custom Validation

For logic that goes beyond a static schema, define `validate{Action}`:

```ts
async validatePost(params: ODRouteParams): Promise<ODResponse | undefined> {
  const body = this.request.body as { role: string }
  if (body.role === 'admin' && !this.context.state.get('user')) {
    return this.setError(403, 'Cannot assign admin role')
  }
}
```

Return an `ODResponse` to abort, or `undefined` to continue. Custom validation runs after body/query validators.

## Controller-Level Middleware

Override `beforewares` and `afterwares` to apply middleware only to this controller:

```ts
class AdminController extends ODController {
  get beforewares() {
    return [ODJWTMiddleware({ secret: process.env.JWT_SECRET })]
  }
}
```

Controller beforewares run after app-level beforewares. Controller afterwares run before app-level afterwares.

## Error Handling

### Throwing ODRequestError

Throw `ODRequestError` to short-circuit with a specific HTTP status:

```ts
import { ODRequestError } from 'orange-dragonfly'

async doGetId(params: { id: number }) {
  const user = await findUser(params.id)
  if (!user) throw new ODRequestError(404, 'User not found')
  return user
}
```

### setError

Shortcut to set the response to an error state and return it:

```ts
return this.setError(403, 'Forbidden')
return this.setError(422, 'Validation failed', { field: 'email' })
```

### handleError

Override for per-controller error handling:

```ts
async handleError(e: Error): Promise<ODResponse> {
  if (e instanceof MyDomainError) {
    return this.setError(422, e.message)
  }
  throw e  // rethrow for app-level handling
}
```

## Built-in Controllers

- [ODHealthController](built-in/controllers/health-controller.md) - `GET /health` health check endpoint
- [ODNotFoundController](built-in/controllers/not-found-controller.md) - built-in 404 controller used for unmatched routes (configurable via `ODApp.create({ notFoundController })`)

For app-level error response customization (`404` via `notFoundController`, thrown errors via `ODApp.processErrorRequest()`), see [Error Handler](features/error-handler.md).
