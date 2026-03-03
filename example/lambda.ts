import { ODAwsRestApiHandlerFactory } from '../src'
import app from './setup'

export const handler = await ODAwsRestApiHandlerFactory.build(await app.init(), {})
