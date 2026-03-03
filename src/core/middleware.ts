import ODContext from './context'
import ODResponse from './response'
import { ODRouteParams } from './route'

export type ODMiddlewareFunctionValue = Promise<ODResponse | undefined | void>
export type ODMiddlewareFunction = (context: ODContext, params?: ODRouteParams) => ODMiddlewareFunctionValue
