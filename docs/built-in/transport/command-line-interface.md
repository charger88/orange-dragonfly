# ODCommandLineInterface

CLI transport for running actions from the command line.

## Usage

```ts
import { ODApp, ODCommandLineInterface } from 'orange-dragonfly'

const app = ODApp.create().useAction(MyAction)

await ODCommandLineInterface.run(app, process.argv)
```

Unlike web servers, `ODCommandLineInterface.run()` does not call `app.init()` - the app does not need HTTP routes for CLI-only use. Call `init()` if you rely on `onInit` callbacks or when controllers are registered.

## Input Format

```bash
node script.js <action-name> key=value key2=value2 ...
```

All values are passed as strings. Surrounding single or double quotes are stripped from values automatically (e.g. `name="Alice"` -> `Alice`). Type coercion is the action's responsibility (e.g. via `doBeforeAction`).

## Example

```bash
node cli.js seed-database table=users limit=100
```

Calls `app.processAction('seed-database', { table: 'users', limit: '100' })`.

See [Actions](../../actions.md) for how to implement actions and handle input.
