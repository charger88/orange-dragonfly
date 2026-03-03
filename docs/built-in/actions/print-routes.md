# ODPrintRoutes

Prints all registered routes to the app logger as `METHOD /path` (including auto-generated `OPTIONS` routes).

Action name: `print-routes`

## Usage

```ts
import { ODPrintRoutes } from 'orange-dragonfly'

app.useAction(ODPrintRoutes)
```

```bash
node cli.js print-routes
```

Example output:

```
GET /users
OPTIONS /users
GET /users/{#id}
OPTIONS /users/{#id}
POST /users
DELETE /users/{#id}
GET /health
OPTIONS /health
```
