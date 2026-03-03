# ODNotFoundController

Built-in controller used by `ODApp` for unmatched routes (`404 Not Found`).

You normally do **not** register it with `app.useController()`. `ODApp` uses it internally as the router's default controller.

## Default Behaviour

For an unmatched route, `ODNotFoundController.e404()` returns:

```json
{ "error": "Not found" }
```

## Customising 404 Responses

Pass a subclass via `ODApp.create({ notFoundController })`:

```ts
import { ODApp, ODNotFoundController } from 'orange-dragonfly'

class MyNotFoundController extends ODNotFoundController {
  async e404() {
    return this.setError(404, 'Nothing here')
  }
}

const app = ODApp.create({
  notFoundController: MyNotFoundController,
})
```

Because this is a controller, unmatched routes still go through the normal middleware pipeline.
