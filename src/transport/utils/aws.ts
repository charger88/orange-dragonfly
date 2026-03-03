import { Readable } from 'stream'
import ODApp from '../../core/app'
import ODRequest from '../../core/request'
import ODResponse from '../../core/response'
import { ODLogger } from '../../core/logger'
import { ErrorHandler } from './http'

export interface ODAwsLambdaHandlerFactoryOptions {
  logger?: ODLogger
  maxBodySize?: number | null
  maxResponseSize?: number | null
  errorHandler?: ErrorHandler | null
}

export interface ODAwsLambdaEventBody {
  body?: string | null
  isBase64Encoded?: boolean
}

export interface ODAwsTransportResponse {
  statusCode: number
  headers: Record<string, string>
  multiValueHeaders: Record<string, string[]>
  cookies: string[]
  body: string
  isBase64Encoded: boolean
}

const DEFAULT_AWS_MAX_RESPONSE_SIZE = 6 * 1024 * 1024

class AwsResponseTooLargeError extends Error {
  constructor(maxResponseSize: number) {
    super(`Lambda response exceeds maxResponseSize (${maxResponseSize} bytes)`)
    this.name = 'AwsResponseTooLargeError'
  }
}

function assertAwsResponseSize(
  content: string | Buffer,
  maxResponseSize: number | null,
): void {
  if (maxResponseSize === null) return
  if (Buffer.byteLength(content) > maxResponseSize) {
    throw new AwsResponseTooLargeError(maxResponseSize)
  }
}

function getMaxAwsBinaryBodySize(maxResponseSize: number | null): number | null {
  if (maxResponseSize === null) return null
  return Math.floor(maxResponseSize / 4) * 3
}

export function decodeAwsEventBody(
  body: string | null | undefined,
  isBase64Encoded: boolean | undefined,
): Buffer | undefined {
  if (!body) return undefined
  return isBase64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf-8')
}

export function mergeAwsHeaders(
  headers?: Record<string, string> | null,
  multiValueHeaders?: Record<string, string[]> | null,
): Record<string, string> {
  const merged: Record<string, string> = {}
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      merged[key.toLowerCase()] = value
    }
  }
  if (multiValueHeaders) {
    for (const [key, values] of Object.entries(multiValueHeaders)) {
      if (values.length === 0) continue
      const lowerKey = key.toLowerCase()
      merged[lowerKey] = values.join(lowerKey === 'cookie' ? '; ' : ', ')
    }
  }
  return merged
}

export function applyAwsCookiesHeader(
  headers: Record<string, string>,
  cookies?: string[] | null,
): void {
  if (!cookies || cookies.length === 0) return
  headers.cookie = cookies.join('; ')
}

export function buildAwsQueryString(
  rawQueryString?: string | null,
  queryStringParameters?: Record<string, string> | null,
  multiValueQueryStringParameters?: Record<string, string[]> | null,
): string {
  if (rawQueryString !== undefined && rawQueryString !== null) {
    return rawQueryString.length > 0 ? `?${rawQueryString}` : ''
  }

  if (multiValueQueryStringParameters && Object.keys(multiValueQueryStringParameters).length > 0) {
    const params = new URLSearchParams()
    for (const [key, values] of Object.entries(multiValueQueryStringParameters)) {
      for (const value of values) {
        params.append(key, value)
      }
    }
    return `?${params.toString()}`
  }

  if (queryStringParameters && Object.keys(queryStringParameters).length > 0) {
    return `?${new URLSearchParams(queryStringParameters).toString()}`
  }

  return ''
}

export async function convertAwsResponse(
  res: ODResponse,
  maxResponseSize: number | null = DEFAULT_AWS_MAX_RESPONSE_SIZE,
): Promise<ODAwsTransportResponse> {
  const headers: Record<string, string> = {}
  const multiValueHeaders: Record<string, string[]> = {}
  const cookies: string[] = []

  for (const header of res.headers) {
    const lowerName = header.name.toLowerCase()
    if (multiValueHeaders[lowerName]) {
      multiValueHeaders[lowerName].push(header.value)
    } else {
      multiValueHeaders[lowerName] = [header.value]
    }
    headers[lowerName] = header.value
    if (lowerName === 'set-cookie') {
      cookies.push(header.value)
    }
  }

  let body: string
  let isBase64Encoded: boolean

  const { content } = res
  if (content instanceof Readable) {
    const chunks: Buffer[] = []
    const maxBinaryBodySize = getMaxAwsBinaryBodySize(maxResponseSize)
    let size = 0
    await new Promise<void>((resolve, reject) => {
      let settled = false

      const onData = (chunk: Buffer | string) => {
        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += chunkBuffer.length
        if (maxBinaryBodySize !== null && size > maxBinaryBodySize) {
          settled = true
          content.off('data', onData)
          content.off('end', onEnd)
          content.off('error', onError)
          if (!content.destroyed) content.destroy()
          reject(new AwsResponseTooLargeError(maxResponseSize as number))
          return
        }
        chunks.push(chunkBuffer)
      }

      const onEnd = () => {
        if (settled) return
        settled = true
        content.off('data', onData)
        content.off('end', onEnd)
        content.off('error', onError)
        resolve()
      }

      const onError = (error: unknown) => {
        if (settled) return
        settled = true
        content.off('data', onData)
        content.off('end', onEnd)
        content.off('error', onError)
        reject(error)
      }

      content.on('data', onData)
      content.on('end', onEnd)
      content.on('error', onError)
    })
    body = Buffer.concat(chunks).toString('base64')
    assertAwsResponseSize(body, maxResponseSize)
    isBase64Encoded = true
  } else {
    const [contentType, converted] = await res.convert()
    if (contentType && !multiValueHeaders['content-type']) {
      headers['content-type'] = contentType
      multiValueHeaders['content-type'] = [contentType]
    }
    if (Buffer.isBuffer(converted)) {
      body = converted.toString('base64')
      assertAwsResponseSize(body, maxResponseSize)
      isBase64Encoded = true
    } else {
      assertAwsResponseSize(converted, maxResponseSize)
      body = converted
      isBase64Encoded = false
    }
  }

  return {
    statusCode: res.code,
    headers,
    multiValueHeaders,
    cookies,
    body,
    isBase64Encoded,
  }
}

export async function buildAwsLambdaHandler<
  TEvent extends ODAwsLambdaEventBody,
  TResult,
>(
  app: ODApp,
  options: ODAwsLambdaHandlerFactoryOptions,
  convertRequest: (app: ODApp, event: TEvent, rawBody?: Buffer) => ODRequest,
  convertResponse: (response: ODResponse) => Promise<TResult>,
): Promise<(event: TEvent) => Promise<TResult>> {
  const logger = options.logger ?? app.logger
  const maxBodySize = options.maxBodySize !== undefined ? options.maxBodySize : 1_048_576
  const errorHandler = options.errorHandler ?? null

  const serializeResponse = async(response: ODResponse, requestId?: string): Promise<TResult> => {
    try {
      return await convertResponse(response)
    } catch (e) {
      logger.error(
        'Response serialization failed',
        requestId ? { requestId, error: e } : e,
      )
      try {
        return await convertResponse(
          app.createResponse(500),
        )
      } catch (fallbackError) {
        logger.error(
          'Fallback response serialization failed',
          requestId ? { requestId, error: fallbackError } : fallbackError,
        )
        throw fallbackError
      }
    }
  }

  return async(event: TEvent): Promise<TResult> => {
    const rawBody = decodeAwsEventBody(event.body, event.isBase64Encoded)
    if (rawBody && maxBodySize !== null && rawBody.length > maxBodySize) {
      return await serializeResponse(
        app.createResponse(413, { error: 'Payload Too Large' }),
      )
    }

    let req: ODRequest
    try {
      req = convertRequest(app, event, rawBody)
    } catch (e) {
      logger.warn('Malformed Lambda request', e)
      return await serializeResponse(
        app.createResponse(400, { error: 'Bad Request' }),
      )
    }

    let res: ODResponse
    try {
      res = await app.processRequest(req)
    } catch (e) {
      logger.error('Request handling failed', { requestId: req.id, error: e })
      let handled: ODResponse | null = null
      if (errorHandler) {
        try {
          handled = errorHandler(req, e)
        } catch (eh) {
          logger.error('Custom error handler failed', { requestId: req.id, error: eh })
        }
      }
      res = handled ?? app.createResponse(500, { error: 'Internal Server Error' })
    }

    return await serializeResponse(res, req.id)
  }
}
