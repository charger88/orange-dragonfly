# Orange Dragonfly | OD.js

REST-oriented TypeScript framework for building APIs on Node.js.

## Installation

```bash
npm install orange-dragonfly
```

Node.js `>= 18` is required.

## Philosophy

Orange Dragonfly is built around a few core ideas:

**Extend, don't configure.** The framework is designed to be extended through inheritance. You build applications by subclassing - inherit a base controller, an action, or the app itself and override what you need. The framework shapes itself to your domain, not the other way around.

**No third-party dependencies.** The framework relies only on Node.js built-ins and a few Orange Dragonfly companion packages. Keeping the dependency tree flat means fewer security surface areas, fewer version conflicts, and a more predictable runtime.

**REST-oriented, but flexible.** The defaults are optimized for building REST APIs, while the underlying design stays general enough to accommodate other use cases without fighting the framework.

**Run it your way.** The application core is decoupled from how it receives requests. The same app can be served through a built-in HTTP server, HTTP/2, a serverless function, or any other transport - without changing your business logic.

## Super Quick Start

```ts
import { ODApp, ODController, ODWebServer } from 'orange-dragonfly'

class UsersController extends ODController {
  async doGet() {
    return [{ id: 1, name: 'George Washington' }]
  }
}

const app = await ODApp
  .create()
  .useController(UsersController)
  .init()

await ODWebServer.run(app, { port: 8080 })
```

## Documentation

- [Getting Started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [How It Works](docs/how-it-works.md)
- [Controllers](docs/controllers.md)
- [Middlewares](docs/middlewares.md)
- [Actions](docs/actions.md)
- [Requests](docs/requests.md)
- [Responses](docs/responses.md)
- [Transport](docs/transport.md)
- [Static Files](docs/static-files.md)

## License

[ISC](LICENSE.md)
