import { ODController, ODEnvConfigProvider } from '../../src'

export class IndexController extends ODController {
  async doGet() {
    const env = ODEnvConfigProvider.str('ENV', 'N/A')
    return { message: 'Welcome to OD.js!', env }
  }
}