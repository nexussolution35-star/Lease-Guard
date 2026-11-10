import { describe, expect, it, vi } from 'vitest'

import { lazySource } from './dataSource'

describe('lazySource', () => {
  it('creates the source on first use only and then reuses it', () => {
    const create = vi.fn(() => ({ id: Math.random() }))
    const get = lazySource(create)
    expect(create).not.toHaveBeenCalled()
    const first = get()
    expect(get()).toBe(first)
    expect(create).toHaveBeenCalledTimes(1)
  })
})
