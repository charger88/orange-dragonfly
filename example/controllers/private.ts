import { ODController, ODJWTMiddleware, ODWithUser, ODJWTPayload, ODMiddlewareFunction } from '../../src'

/** Shared secret used by PrivateController and the generate-demo-token CLI action. */
export const DEMO_JWT_SECRET = 'orange-dragonfly-example-secret'

const jwtBeforeware = ODJWTMiddleware({ secret: DEMO_JWT_SECRET })

@ODWithUser()
export default class PrivateController extends ODController {
  // Enables this.user type-checking inside the class body (the decorator handles the runtime getter).
  declare user: ODJWTPayload | undefined

  get beforewares(): ODMiddlewareFunction[] {
    return [jwtBeforeware]
  }

  async doGet() {
    return {
      message: 'Access granted',
      user: this.user,
    }
  }
}
