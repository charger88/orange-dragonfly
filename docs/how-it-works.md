# How It Works

## Architecture

Orange Dragonfly is organized in two layers:

**App core** handles business logic: routing, controllers, actions, middleware, and the request/response lifecycle. The core is transport-agnostic - it only knows about `ODRequest` and `ODResponse` objects.

**Transport layer** handles how the app receives work: HTTP/1.1 (`ODWebServer`), HTTP/2 (`ODHttp2WebServer`), or command-line (`ODCommandLineInterface`). Each transport converts its input into an `ODRequest`, calls `app.processRequest()` or `app.processAction()`, and then sends the result back (an `ODResponse` for HTTP, or a string result for CLI actions).

This separation means the same application logic can run over any transport without changes to controller or action code.

## App Initialization

```ts
const app = await ODApp
  .create(options)              // 1. Create app with options
  .useMiddleware(fn)            // 2. Register middleware
  .useController(MyController)  // 3. Register controllers
  .useAction(MyAction)          // 4. Register actions
  .onInit(async (app) => {})    // 5. Register init callbacks
  .init()                       // 6. Run init callbacks, then register routes
```

`init()` first runs all `onInit` callbacks, then inspects every registered controller for handler methods and builds routes in the router. `processRequest` should not be called before `init()` completes.

To auto-load from a directory tree (only files in real subdirectories under that path are scanned; directory symlinks are skipped; matching controller/action default exports are registered; files are loaded sorted alphabetically):

```ts
await app.use('./src/controllers')
```

> **Note:** `app.use()` dynamically `import()`s every `.ts`/`.js`/`.mts`/`.mjs` file it finds (skipping declaration files like `.d.ts`/`.d.mts`). Any top-level module code (database connections, timers, global registrations) runs immediately when the file is imported.

## Request Lifecycle

When a transport receives an HTTP request:

1. The transport wraps the raw request into `ODRequest` and calls `app.processRequest(request)`.
2. The router resolves the path and method first. Unmatched requests resolve to the configured not-found controller (`ODNotFoundController` by default).
3. An `ODContext` is created with the app, request, a fresh response, the matched route, and an empty state map.
4. `onRequestStarted` callbacks run. `context.route` is already available here.
5. A controller instance is created for that request (including the not-found controller for unmatched routes).
6. `controller.invoke(action, params)` runs the middleware/action pipeline in this order:
   1. App-level beforewares (registration order)
   2. Controller-level beforewares
   3. Validation (body validator, query validator, then custom validate method)
   4. Action method (`doGet`, `doPost`, etc.; unmatched routes call `e404()` on the not-found controller)
   5. Controller-level afterwares
   6. App-level afterwares
7. If `ODRequestError` (or another unhandled error) escapes the controller path, `ODApp.processErrorRequest()` builds the response (`400`, `500`, etc.).
8. `onRequestCompleted` callbacks run in `finally`.
9. The transport writes the response.

Any middleware or validator can short-circuit by returning an `ODResponse`. The chain stops immediately and that response is sent.

> **Notes**
>
> - App-level middlewares are route-aware in the current pipeline (routing happens before the middleware chain). This means app-level middleware can safely use `context.route` and route params (for example, `ODRateLimitMiddleware`).
> - 404 responses are produced by the not-found controller, so they go through the same middleware/action pipeline as normal controller requests.
> - If an error escapes the controller pipeline and is handled by `ODApp.processErrorRequest()`, remaining afterwares are not run.

## Routing

Routes are derived automatically from controller class names and method names. No explicit route registration is needed.

**Path from class name:**

| Class name | Path |
|---|---|
| `UsersController` | `/users` |
| `UserPostsController` | `/user-posts` |
| `IndexController` | `/` |
| Custom `static get path()` | any |

**Handler method format:** `do{Verb}[Id][Suffix]`

| Method name | Route |
|---|---|
| `doGet` | `GET /users` |
| `doPost` | `POST /users` |
| `doGetId` | `GET /users/{#id}` |
| `doDeleteId` | `DELETE /users/{#id}` |
| `doGetSearch` | `GET /users/search` |
| `doGetIdPosts` | `GET /users/{#id}/posts` |

Every registered path also gets an `OPTIONS` handler automatically for CORS preflight support.

See [Controllers](controllers.md) for the full routing reference.

## Action Lifecycle

When the CLI runner invokes an action:

1. `app.processAction(actionName, input)` is called.
2. `onActionStarted` callbacks run.
3. `action.invoke(input)` runs: `doBeforeAction` -> `doAction` -> `doAfterAction`.
4. `onActionCompleted` callbacks run.
5. The result string is logged or returned.

See [Actions](actions.md) for details.

## Context and State

Every request gets an `ODContext` shared across all middleware and the controller for that request's lifetime:

```ts
context.app      // ODApp instance
context.request  // ODRequest
context.response // ODResponse
context.route    // matched route (path, method, controller class, action name)
context.state    // Map<string, unknown> - passes data between middleware and controller
```

Middleware stores data in `context.state`; controllers read it back. For example, `ODJWTMiddleware` stores the decoded token payload in `context.state` under `'user'`.
