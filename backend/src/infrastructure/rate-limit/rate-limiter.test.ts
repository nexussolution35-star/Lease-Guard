import { describe, expect, it } from 'vitest'

import { counterKey, decide, type RateLimitRule } from './rate-limiter'

const MINUTE: RateLimitRule = { name: 'search-minute', limit: 3, windowSeconds: 60 }
const DAY: RateLimitRule = { name: 'search-day', limit: 100, windowSeconds: 86_400 }

describe('decide', () => {
  it('allows while every rule is within its limit (the limit itself included)', () => {
    expect(decide([MINUTE, DAY], [3, 50], 0)).toEqual({ allowed: true })
  })

  it('refuses on the first rule over its limit, with the seconds left in its window', () => {
    // 45 s into the minute window: 15 s to wait.
    expect(decide([MINUTE, DAY], [4, 50], 45_000)).toEqual({ allowed: false, retryAfterSeconds: 15, rule: 'search-minute' })
    expect(decide([MINUTE, DAY], [1, 101], 3_600_000)).toEqual({ allowed: false, retryAfterSeconds: 82_800, rule: 'search-day' })
  })

  it('never asks to wait less than a second', () => {
    expect(decide([MINUTE], [4], 59_999)).toMatchObject({ retryAfterSeconds: 1 })
  })
})

describe('counterKey', () => {
  it('names the prefix, rule, subject and window, so each window counts separately', () => {
    expect(counterKey('lg', MINUTE, 'user-1', 125_000)).toBe('lg:ratelimit:search-minute:user-1:2')
    expect(counterKey('lg', MINUTE, 'user-1', 179_999)).toBe('lg:ratelimit:search-minute:user-1:2')
    expect(counterKey('lg', MINUTE, 'user-1', 180_000)).toBe('lg:ratelimit:search-minute:user-1:3')
  })
})
