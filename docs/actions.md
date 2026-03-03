# Actions

Actions are app-level commands for non-HTTP workflows: CLI tasks, maintenance jobs, diagnostics, and similar work that shouldn't go through the HTTP layer.

## Creating an Action

Extend `ODAction` and override `doAction`:

```ts
import { ODApp, ODAction, ODCommandLineInterface } from 'orange-dragonfly'

class HelloAction extends ODAction {
  protected async doAction(input: Record<string, unknown>) {
    return `hello ${input.name ?? 'world'}`
  }
}

const app = ODApp
  .create()
  .useAction(HelloAction)

await ODCommandLineInterface.run(app, process.argv)
```

CLI invocation:

```bash
node cli.js hello-action name=Alice
# -> hello Alice
```

## Action Name

The action name is derived from the class name using CamelCase -> dash-case conversion:

| Class name | Action name |
|---|---|
| `HelloAction` | `hello-action` |
| `SeedDatabaseAction` | `seed-database-action` |

Override with a static getter:

```ts
class SeedDatabaseAction extends ODAction {
  static get actionName() { return 'seed' }
}
```

## Input Format

CLI arguments format: `node script.js <action-name> key=value ...`

All values arrive as strings. Type coercion must be handled in the action itself.

## Lifecycle Hooks

### doBeforeAction

Runs before `doAction`. Use it to transform or validate input:

```ts
protected async doBeforeAction(input: Record<string, unknown>) {
  return {
    ...input,
    limit: input.limit ? Number(input.limit) : 100,
  }
}
```

### doAfterAction

Runs after `doAction`. Use it to post-process the output string:

```ts
protected async doAfterAction(output: string) {
  return output.toUpperCase()
}
```

### handleError

Override to handle errors per action:

```ts
async handleError(e: Error): Promise<string> {
  if (e instanceof MyDomainError) return `Error: ${e.message}`
  throw e  // rethrow for app-level handling
}
```

## App Access

Actions have access to the app via `this.app`:

```ts
class ReportAction extends ODAction {
  protected async doAction() {
    this.app.logger.info('Running report')
    return 'done'
  }
}
```

## App Callbacks

Hook into action lifecycle from the app setup:

```ts
app
  .onActionStarted(async (app, action) => {
    app.logger.info(`starting ${action.constructor.name}`)
  })
  .onActionCompleted(async (app, action) => {
    app.logger.info(`completed ${action.constructor.name}`)
  })
```

## Built-in Actions

- [ODPrintRoutes](built-in/actions/print-routes.md) - prints all registered routes as `METHOD /path`
