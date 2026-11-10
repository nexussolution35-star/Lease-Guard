import { isApiError } from '@leaseguard/api-client'

export const NETWORK_ERROR_MESSAGE = 'The LeaseGuard API could not be reached. Check your connection and try again.'
const RATE_LIMITED_MESSAGE = 'Too many requests. Wait a moment and try again.'

/** Statuses whose API message is written for users (validation, permission and state conflicts). */
const USER_FACING_STATUSES: ReadonlySet<number> = new Set([400, 403, 404, 409, 422])

/**
 * A message for a failed request that is safe and useful to show: the API's own message for
 * validation, permission and conflict answers (they explain what to do), a fixed text for network
 * failures and rate limits, and `fallback` for server errors and anything unexpected.
 */
export function describeApiError(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    if (error.isNetworkError) return NETWORK_ERROR_MESSAGE
    if (error.status === 429) return RATE_LIMITED_MESSAGE
    if (USER_FACING_STATUSES.has(error.status) && error.messages.length > 0) return sentence(error.messages.join('. '))
    return fallback
  }
  return fallback
}

/** API messages are lower-case fragments at times ("must be …"); show them as a sentence. */
function sentence(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return trimmed
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`
}
