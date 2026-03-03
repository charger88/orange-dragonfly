import ODContext from '../core/context'
import { ODMiddlewareFunction, ODMiddlewareFunctionValue } from '../core/middleware'
import ODResponse from '../core/response'
import { ODRouteParams } from '../core/route'

export type ODObjectResolverValue = { result?: object, response?: ODResponse, param?: string }
export type ODObjectResolverFunction = (context: ODContext, id: unknown) => Promise<ODObjectResolverValue>

/**
 * Creates middleware that resolves a route parameter to an object and stores it in request state.
 *
 * @param resolvers Resolver functions used to load objects by route parameter values.
 * @returns A configured middleware function.
 */
export default function ODObjectResolverMiddleware(
  resolvers: Map<string, ODObjectResolverFunction>,
): ODMiddlewareFunction {
  if (resolvers.has('id')) {
    throw new Error('"id" is the parameter name the router uses for default ID routes ({#id}) and cannot be used as a resolver key')
  }

  return async(context: ODContext, params?: ODRouteParams): ODMiddlewareFunctionValue => {
    for (const [paramName, resolver] of resolvers) {
      if (params && Object.hasOwn(params, paramName)) {
        const { result, response, param } = await resolver(context, params[paramName])
        if (response) {
          return response
        }
        if (!result) {
          return context.response.setError(404, 'Not found')
        }
        context.state.set(param ?? paramName, result)
      }
    }
  }
}
