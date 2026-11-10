import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { secondsUntil, useCooldown } from './useCooldown'

describe('secondsUntil', () => {
  it('rounds up to whole seconds and never goes below zero', () => {
    expect(secondsUntil(null, 1_000)).toBe(0)
    expect(secondsUntil(61_000, 1_000)).toBe(60)
    expect(secondsUntil(1_500, 1_000)).toBe(1)
    expect(secondsUntil(1_000, 5_000)).toBe(0)
  })
})

describe('useCooldown', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('counts down once a second and ends at zero', () => {
    const { result } = renderHook(() => useCooldown())
    expect(result.current.secondsLeft).toBe(0)
    act(() => result.current.start(3))
    expect(result.current.secondsLeft).toBe(3)
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.secondsLeft).toBe(2)
    act(() => vi.advanceTimersByTime(2000))
    expect(result.current.secondsLeft).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
