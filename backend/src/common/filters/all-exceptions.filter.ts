import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { STATUS_CODES } from 'node:http'
import type { Response } from 'express'

import type { LeaseGuardRequest } from '../request-context'

/** Error body returned by every failing API request. */
export interface ApiErrorBody {
  statusCode: number
  /** HTTP reason phrase, e.g. "Forbidden". */
  error: string
  message: string | string[]
  /** Correlates the response with server logs (also sent as the X-Request-Id header). */
  requestId: string | null
}

/**
 * Global filter: HttpExceptions keep their status and message; anything else becomes a generic 500
 * whose details are logged with the request id but never returned to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<LeaseGuardRequest>()
    const response = http.getResponse<Response>()
    const requestId = request.id === undefined ? null : String(request.id)

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR
    let message: string | string[] = 'An unexpected error occurred'
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus()
      const body = exception.getResponse()
      message = typeof body === 'string' ? body : messageFrom(body) ?? exception.message
    } else {
      const detail = exception instanceof Error ? exception.stack ?? exception.message : String(exception)
      this.logger.error(`Unhandled error on ${request.method} ${request.url} [request ${requestId}]: ${detail}`)
    }

    const body: ApiErrorBody = { statusCode, error: STATUS_CODES[statusCode] ?? 'Error', message, requestId }
    response.status(statusCode).json(body)
  }
}

function messageFrom(body: object): string | string[] | undefined {
  const message = (body as { message?: unknown }).message
  if (typeof message === 'string') return message
  if (Array.isArray(message) && message.every((m) => typeof m === 'string')) return message
  return undefined
}
