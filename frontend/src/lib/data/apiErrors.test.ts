import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { describeApiError, NETWORK_ERROR_MESSAGE } from './apiErrors'

describe('describeApiError', () => {
  it('shows the API message for validation, permission and conflict answers as a sentence', () => {
    expect(describeApiError(new ApiError(409, ['This email already belongs to a member of the company'], 'r1'), 'fallback')).toBe(
      'This email already belongs to a member of the company.',
    )
    expect(describeApiError(new ApiError(400, ['email: must be an email address'], null), 'fallback')).toBe('Email: must be an email address.')
    expect(describeApiError(new ApiError(403, ['Your role does not allow this action'], null), 'fallback')).toBe(
      'Your role does not allow this action.',
    )
  })

  it('uses fixed copy for network failures and rate limits', () => {
    expect(describeApiError(new ApiError(0, ['The LeaseGuard API could not be reached'], null), 'fallback')).toBe(NETWORK_ERROR_MESSAGE)
    expect(describeApiError(new ApiError(429, ['ThrottlerException'], null), 'fallback')).toMatch(/too many requests/i)
  })

  it('falls back for server errors and non-API errors', () => {
    expect(describeApiError(new ApiError(500, ['relation does not exist'], 'r2'), 'Could not save.')).toBe('Could not save.')
    expect(describeApiError(new Error('boom'), 'Could not save.')).toBe('Could not save.')
  })
})
