import ODApp from '../core/app'
import ODRequest from '../core/request'
import ODResponse from '../core/response'
import {
  applyAwsCookiesHeader,
  buildAwsLambdaHandler,
  buildAwsQueryString,
  convertAwsResponse,
  mergeAwsHeaders,
  type ODAwsLambdaHandlerFactoryOptions,
} from './utils/aws'

export interface ODAwsHttpApiEvent {
  version?: string
  routeKey?: string
  rawPath: string
  rawQueryString?: string | null
  cookies?: string[] | null
  headers?: Record<string, string> | null
  queryStringParameters?: Record<string, string> | null
  body?: string | null
  isBase64Encoded?: boolean
  requestContext?: {
    http?: {
      method?: string | null
      path?: string | null
      protocol?: string | null
      sourceIp?: string | null
    } | null
  } | null
}

export interface ODAwsHttpApiHandlerResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
  isBase64Encoded: boolean
  cookies?: string[]
}

export interface ODAwsHttpApiHandlerFactoryOptions {
  logger?: ODAwsLambdaHandlerFactoryOptions['logger']
  maxBodySize?: ODAwsLambdaHandlerFactoryOptions['maxBodySize']
  maxResponseSize?: ODAwsLambdaHandlerFactoryOptions['maxResponseSize']
  errorHandler?: ODAwsLambdaHandlerFactoryOptions['errorHandler']
}

export type ODAwsHttpApiHandler = (event: ODAwsHttpApiEvent) => Promise<ODAwsHttpApiHandlerResponse>

/**
 * Adapter that wraps an ODApp as an AWS API Gateway HTTP API (v2) Lambda handler.
 */
export default class ODAwsHttpApiHandlerFactory {

  /**
   * Builds and returns an AWS API Gateway HTTP API Lambda handler for the given app.
   *
   * @param app Already-initialized ODApp instance.
   * @param options Optional configuration values.
   * @returns Async Lambda handler function.
   */
  static async build(app: ODApp, options: ODAwsHttpApiHandlerFactoryOptions = {}): Promise<ODAwsHttpApiHandler> {
    return await buildAwsLambdaHandler(
      app,
      options,
      (requestApp, event, rawBody) => ODAwsHttpApiHandlerFactory.convertRequest(requestApp, event, rawBody),
      (response) => ODAwsHttpApiHandlerFactory.convertResponse(response, options.maxResponseSize),
    )
  }

  /**
   * Converts an AWS API Gateway HTTP API event into an ODRequest.
   *
   * @param app ODApp instance used to create the request.
   * @param event AWS API Gateway HTTP API event.
   * @param rawBody Pre-decoded body buffer, or undefined when the event has no body.
   * @returns ODRequest instance.
   */
  static convertRequest(app: ODApp, event: ODAwsHttpApiEvent, rawBody?: Buffer): ODRequest {
    const headers = mergeAwsHeaders(event.headers)
    applyAwsCookiesHeader(headers, event.cookies)
    const queryString = buildAwsQueryString(event.rawQueryString, event.queryStringParameters)
    const path = event.rawPath || event.requestContext?.http?.path || '/'
    const method = event.requestContext?.http?.method || 'GET'

    return app.createRequest({
      method,
      url: `${path}${queryString}`,
      headers,
      body: rawBody,
      ip: event.requestContext?.http?.sourceIp ?? undefined,
      protocol: 'https',
    })
  }

  /**
   * Converts an ODResponse into an AWS API Gateway HTTP API Lambda response object.
   *
   * @param res ODResponse instance.
   * @returns AWS API Gateway response object.
   */
  static async convertResponse(
    res: ODResponse,
    maxResponseSize?: number | null,
  ): Promise<ODAwsHttpApiHandlerResponse> {
    const converted = await convertAwsResponse(res, maxResponseSize)
    const headers = { ...converted.headers }
    delete headers['set-cookie']

    return {
      statusCode: converted.statusCode,
      headers,
      body: converted.body,
      isBase64Encoded: converted.isBase64Encoded,
      ...(converted.cookies.length > 0 ? { cookies: converted.cookies } : {}),
    }
  }
}
