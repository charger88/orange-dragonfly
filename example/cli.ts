import { ODCommandLineInterface } from '../src'
import app from './setup'

await ODCommandLineInterface.run(await app.init(), process.argv)
await app.unload()