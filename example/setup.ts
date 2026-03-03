import { ODApp, ODCORSMiddleware, ODHealthController, ODPrintRoutes } from '../src/index'
import GenerateDemoToken from './actions/generate-demo-token'
import { IndexController } from './controllers'
import PrivateController from './controllers/private'
import UsersController from './controllers/users'
import StaticController from './controllers/static'

const app = ODApp
  .create({ queryParser: { integerParameters: ['offset', 'limit'] } })
  // CORS must run as a beforeware so all responses (including errors) can carry CORS headers.
  .useMiddleware(ODCORSMiddleware())
  .onRequestCompleted(async(context) => {
    context.response.setHeader('X-Request-Id', context.request.id)
    const duration = `${Date.now() - context.request.now}ms`
    context.app.logger.info(
      `[${new Date().toISOString()}] ${context.request.ip} ${context.request.method} ${context.request.path} ${context.response.code} ${duration}`,
    )
  })
  .useController(IndexController)
  .useController(ODHealthController)
  .useController(PrivateController)
  .useController(UsersController)
  .useController(StaticController)
  .useAction(ODPrintRoutes)
  .useAction(GenerateDemoToken)

export default app
