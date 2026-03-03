import { ODWebServer } from '../src'
import app from './setup'

const port = 8080

await ODWebServer.run(await app.init(), { port })
console.log(`Server running at http://localhost:${port}`)

// setTimeout(stop, 10000)