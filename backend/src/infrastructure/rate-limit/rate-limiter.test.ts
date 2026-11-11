import { describe, expect, it } from 'vitest'

import { counterKey, decide, retryAfterSeconds, type RateLimitRule } from './rate-limiter'

const MINUTE: RateLimitRule = { name: 'search-minute', limit: 3, windowSeconds: 60 }
const DAY: RateLimitRule = { name: 'search-day', limit: 100, windowSeconds: 86_400 }

describe('decide (counts before this use)', () => {
  it('allows while every rule has room', () => {
    expect(decide([MINUTE, DAY], [2, 99], 0)).toEqual({ allowed: true })
  })

  it('refuses on the first rule already at its limit, with the seconds left in its window', () => {
    // 45 s into the minute window: 15 s to wait.
    expect(decide([MINUTE, DAY], [3, 50], 45_000)).toEqual({ allowed: false, retryAfterSeconds: 15, rule: 'search-minute' })
    expect(decide([MINUTE, DAY], [1, 100], 3_600_000)).toEqual({ allowed: false, retryAfterSeconds: 82_800, rule: 'search-day' })
  })

  it('never asks to wait less than a second', () => {
    expect(retryAfterSeconds(MINUTE, 59_999)).toBe(1)
  })
})

describe('counterKey', () => {
  it('names the prefix, rule, subject and window, so each window counts separately', () => {
    expect(counterKey('lg', MINUTE, 'user-1', 125_000)).toBe('lg:ratelimit:search-minute:user-1:2')
    expect(counterKey('lg', MINUTE, 'user-1', 179_999)).toBe('lg:ratelimit:search-minute:user-1:2')
    expect(counterKey('lg', MINUTE, 'user-1', 180_000)).toBe('lg:ratelimit:search-minute:user-1:3')
  })
})
