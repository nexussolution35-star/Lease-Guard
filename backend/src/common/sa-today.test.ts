import { describe, expect, it } from 'vitest'

import { saToday } from './sa-today'

describe('saToday', () => {
  it('returns the South African calendar date regardless of the host timezone', () => {
    expect(saToday(new Date('2026-11-08T21:59:59Z'))).toBe('2026-11-08')
    expect(saToday(new Date('2026-11-08T22:00:00Z'))).toBe('2026-11-09')
    expect(saToday(new Date('2026-11-08T22:30:00Z'))).toBe('2026-11-09')
    expect(saToday(new Date('2026-11-09T04:00:00Z'))).toBe('2026-11-09')
  })
})
