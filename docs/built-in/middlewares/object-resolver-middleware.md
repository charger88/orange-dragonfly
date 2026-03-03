# ODObjectResolverMiddleware

Automatically resolves route parameters to objects before the action runs. Useful for loading a resource by ID once and sharing it across middleware and the controller.

## Usage

```ts
import { ODObjectResolverMiddleware } from 'orange-dragonfly'

app.useMiddleware(ODObjectResolverMiddleware(new Map([
  ['user_id', async (context, id) => {
    const user = await db.users.find(id as number)
    return { result: user ?? undefined }
  }],
])))
```

The resolved object is stored in `context.state` under the param name (`'user_id'` in this example). Read it in the controller:

```ts
class UsersController extends ODController {
  static get idParameterName() { return '#user_id' }

  async doGetId() {
    const user = this.context.state.get('user_id') as User
    return user
  }
}
```

## Resolver Function

```ts
type ODObjectResolverFunction = (
  context: ODContext,
  id: unknown,
) => Promise<{
  result?: object    // the resolved object
  response?: ODResponse  // abort with this response
  param?: string     // custom key for context.state (defaults to the param name)
}>
```

Return one of:

| Return | Behaviour |
|---|---|
| `{ result }` | Store `result` in `context.state` under the param name and continue |
| `{ result, param }` | Same, but store under `param` instead |
| `{ response }` | Short-circuit with the given response |
| `{}` or `{ result: undefined }` | Return a `404` response automatically |

## Notes

- The key `'id'` is reserved and cannot be used as a resolver name.
- Resolvers only run when their param name is present in the current route's params.
- Multiple resolvers can be registered in the same middleware instance.
