import path from 'path'
import { ODController, ODRouteParams, serveStaticFiles } from '../../src'

const STORAGE_DIR = path.resolve(process.cwd(), 'example', 'storage')

export default class StaticController extends ODController {
  // Use a string parameter name (no '#' prefix) so the router matches any segment, not just digits
  static get idParameterName() { return 'file' }

  async doGetId(params: ODRouteParams) {
    return serveStaticFiles(params['file'] as string, STORAGE_DIR, this.context.response)
  }
}
