import { createValidator } from 'orange-dragonfly-validator'
import { ODController } from '../../src'
import PresidentsService from '../services/presidents'

const service = new PresidentsService()

const GET_QUERY_VALIDATOR = createValidator({ offset: { type: 'integer', min: 0 }, limit: { type: 'integer', min: 1, max: 500 } })
const POST_BODY_VALIDATOR = createValidator({ name: { type: 'string', required: true } })

export default class UsersController extends ODController {
  get queryValidatorGet() {
    return GET_QUERY_VALIDATOR
  }

  async doGet() {
    const offset = Number(this.context.request.getQueryParam('offset', 0))
    const limit = Number(this.context.request.getQueryParam('limit', 10))
    return service.getList(offset, limit)
  }

  async doGetId(params: { id: number }) {
    const user = service.getById(params.id)
    if (!user) {
      return this.context.response.setError(404, 'Not found')
    }
    return user
  }
  
  get bodyValidatorPost() {
    return POST_BODY_VALIDATOR
  }

  async validatePost() {
    const { name } = this.context.request.body as { name: string }
    if (service.getByName(name) !== null) {
      return this.context.response.setError(409, 'Name is already in use')
    }
  }
  
  async doPost() {
    const { name } = this.context.request.body as { name: string }
    this.context.response.code = 201
    return service.create(name)
  }
  
  async doDeleteId(params: { id: number }) {
    const deleted = service.deleteById(params.id)
    if (!deleted) {
      return this.context.response.setError(404, 'Not found')
    }
    this.context.response.code = 204
    return ''
  }

  static get pathGetIdAvatar() { return 'userpic' }

  async doGetIdAvatar(params: { id: number }) {
    const user = service.getById(params.id)
    if (!user) {
      return this.context.response.setError(404, 'Not found')
    }
    return { userId: params.id, avatarUrl: `/static/avatars/${params.id}.png` }
  }
}
