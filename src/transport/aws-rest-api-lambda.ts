import ODApp from '../core/app'
import ODRequest from '../core/request'
import ODResponse from '../core/response'
import {
  buildAwsLambdaHandler,
  buildAwsQueryString,
  convertAwsResponse,
  mergeAwsHeaders,
  type ODAwsLambdaHandlerFactoryOptions,
} from './utils/aws'

export interface ODAwsRestApiEvent {
  httpMethod: string
  path: string
  headers?: Record<string, string> | null
  multiValueHeaders?: Record<string, string[]> | null
  queryStringParameters?: Record<string, string> | null
  multiValueQueryStringParameters?: Record<string, string[]> | null
  body?: string | null
  isBase64Encoded?: boolean
  requestContext?: {
    identity?: {
      sourceIp?: string | null
    } | null
  } | null
}

export interface ODAwsRestApiHandlerResponse {
  statusCode: number
  headers: Record<string, string>
  multiValueHeaders: Record<string, string[]>
  body: string
  isBase64Encoded: boolean
}

export interface ODAwsRestApiHandlerFactoryOptions {
  logger?: ODAwsLambdaHandlerFactoryOptions['logger']
  maxBodySize?: ODAwsLambdaHandlerFactoryOptions['maxBodySize']
  maxResponseSize?: ODAwsLambdaHandlerFactoryOptions['maxResponseSize']
  errorHandler?: ODAwsLambdaHandlerFactoryOptions['errorHandler']
}

export type ODAwsRestApiHandler = (event: ODAwsRestApiEvent) => Promise<ODAwsRestApiHandlerResponse>

/**
 * Adapter that wraps an ODApp as an AWS API Gateway REST API (v1) Lambda handler.
 */
export default class ODAwsRestApiHandlerFactory {

  /**
   * Builds and returns an AWS API Gateway REST API Lambda handler for the given app.
   *
   * @param app Already-initialized ODApp instance.
   * @param options Optional configuration values.
   * @returns Async Lambda handler function.
   */
  static async build(app: ODApp, options: ODAwsRestApiHandlerFactoryOptions = {}): Promise<ODAwsRestApiHandler> {
    return await buildAwsLambdaHandler(
      app,
      options,
      (requestApp, event, rawBody) => ODAwsRestApiHandlerFactory.convertRequest(requestApp, event, rawBody),
      (response) => ODAwsRestApiHandlerFactory.convertResponse(response, options.maxResponseSize),
    )
  }

  /**
   * Converts an AWS API Gateway REST API event into an ODRequest.
   * The body must be decoded before calling this method.
   *
   * @param app ODApp instance used to create the request.
   * @param event AWS API Gateway REST API event.
   * @param rawBody Pre-decoded body buffer, or undefined when the event has no body.
   * @returns ODRequest instance.
   */
  static convertRequest(app: ODApp, event: ODAwsRestApiEvent, rawBody?: Buffer): ODRequest {
    const headers = mergeAwsHeaders(event.headers, event.multiValueHeaders)
    const queryString = buildAwsQueryString(
      undefined,
      event.queryStringParameters,
      event.multiValueQueryStringParameters,
    )

    return app.createRequest({
      method: event.httpMethod,
      url: `${event.path}${queryString}`,
      headers,
      body: rawBody,
      ip: event.requestContext?.identity?.sourceIp ?? undefined,
      protocol: 'https',
    })
  }

  /**
   * Converts an ODResponse into an AWS API Gateway REST API Lambda response object.
   * Readable stream content is buffered and base64-encoded; Buffer content is also base64-encoded.
   *
   * @param res ODResponse instance.
   * @returns AWS API Gateway response object.
   */
  static async convertResponse(
    res: ODResponse,
    maxResponseSize?: number | null,
  ): Promise<ODAwsRestApiHandlerResponse> {
    const converted = await convertAwsResponse(res, maxResponseSize)

    return {
      statusCode: converted.statusCode,
      headers: converted.headers,
      multiValueHeaders: converted.multiValueHeaders,
      body: converted.body,
      isBase64Encoded: converted.isBase64Encoded,
    }
  }
}
