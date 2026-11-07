import { describe, expect, it } from 'vitest'
import { enumOptions, labelFor, toneFor } from './labels'

describe('labels', () => {
  it('uses overrides and humanises the rest', () => {
    expect(labelFor('under_review')).toBe('Under review')
    expect(labelFor('pty_ltd')).toBe('(Pty) Ltd')
    expect(labelFor('some_new_value')).toBe('Some new value')
    expect(labelFor(undefined)).toBe('—')
  })
  it('maps tones with a neutral fallback', () => {
    expect(toneFor('failed')).toBe('danger')
    expect(toneFor('verified')).toBe('success')
    expect(toneFor('unknown_status')).toBe('neutral')
  })
  it('builds select options', () => {
    expect(enumOptions(['low', 'high'] as const)).toEqual([
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
    ])
  })
})
