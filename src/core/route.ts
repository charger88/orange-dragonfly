import type ODController from './controller'

export type ODRouteParams = Record<string, unknown>

export default interface ODRoute {
    controller: typeof ODController
    action: string
    method: string
    path: string
}
