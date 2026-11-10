import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { MAX_QUERY_RETRIES, shouldRetryQuery } from './queryClient'

describe('shouldRetryQuery', () => {
  it('retries transient API failures up to the limit', () => {
    expect(shouldRetryQuery(0, new ApiError(0, ['offline'], null))).toBe(true)
    expect(shouldRetryQuery(0, new ApiError(503, ['down'], null))).toBe(true)
    expect(shouldRetryQuery(0, new ApiError(429, ['slow down'], null))).toBe(true)
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, new ApiError(503, ['down'], null))).toBe(false)
  })

  it('never retries client errors or non-API errors', () => {
    expect(shouldRetryQuery(0, new ApiError(400, ['bad'], null))).toBe(false)
    expect(shouldRetryQuery(0, new ApiError(403, ['forbidden'], null))).toBe(false)
    expect(shouldRetryQuery(0, new ApiError(404, ['missing'], null))).toBe(false)
    expect(shouldRetryQuery(0, new Error('demo failure'))).toBe(false)
  })
})
