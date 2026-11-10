import type { ApiErrorDto } from './generated/schema.js'

/** Error body returned by every failing LeaseGuard API request. */
export type ApiErrorBody = ApiErrorDto

/** Status used when the request never reached the API (offline, DNS, CORS, aborted). */
export const NETWORK_ERROR_STATUS = 0

/**
 * Every failed API call rejects with an ApiError, so callers handle one shape: the HTTP status, the
 * server's message(s) and the request id to quote when reporting a problem.
 */
export class ApiError extends Error {
  readonly status: number
  /** One entry per problem (validation errors list each field). */
  readonly messages: readonly string[]
  readonly requestId: string | null

  constructor(status: number, messages: readonly string[], requestId: string | null, options?: { cause?: unknown }) {
    super(messages.join('; ') || `Request failed with status ${status}`, options)
    this.name = 'ApiError'
    this.status = status
    this.messages = messages
    this.requestId = requestId
  }

  get isNetworkError(): boolean {
    return this.status === NETWORK_ERROR_STATUS
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  get isForbidden(): boolean {
    return this.status === 403
  }

  get isNotFound(): boolean {
    return this.status === 404
  }

  /** Worth retrying automatically: network failures, 429 and 5xx. */
  get isRetryable(): boolean {
    return this.status === NETWORK_ERROR_STATUS || this.status === 429 || this.status >= 500
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  if (typeof body !== 'object' || body === null) return false
  const candidate = body as Record<string, unknown>
  return typeof candidate.statusCode === 'number' && (typeof candidate.message === 'string' || Array.isArray(candidate.message))
}

/** Builds an ApiError from a failed response and its (possibly non-JSON) body. */
export function apiErrorFromResponse(response: Response, body: unknown): ApiError {
  const requestId = response.headers.get('x-request-id')
  if (isApiErrorBody(body)) {
    const messages = Array.isArray(body.message) ? body.message : [body.message]
    return new ApiError(response.status, messages, body.requestId ?? requestId)
  }
  return new ApiError(response.status, [response.statusText || `Request failed with status ${response.status}`], requestId)
}
