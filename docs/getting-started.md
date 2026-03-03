# Getting Started

## Installation

```bash
npm install orange-dragonfly
```

Node.js `>= 18` is required.

## Quick Start

```ts
import { ODApp, ODController, ODWebServer, ODCORSMiddleware, ODGlobalRateLimitMiddleware } from 'orange-dragonfly'

class UsersController extends ODController {
  async doGet() {
    return [{ id: 1, name: 'George Washington' }]
  }
}

const app = await ODApp
  .create({
    queryParser: { integerParameters: ['offset', 'limit'] },
    responseOptions: { compactJsonResponse: false },
  })
  .useMiddleware(ODCORSMiddleware())
  .useMiddleware(ODGlobalRateLimitMiddleware(100, 60))
  .onRequestCompleted(async(context) => {
    context.app.logger.info(
      `${context.request.id} ${context.request.method} ${context.request.path} -> ${context.response.code}`,
    )
  })
  .useController(UsersController)
  .init()

await ODWebServer.run(app, { port: 8080 })
```
