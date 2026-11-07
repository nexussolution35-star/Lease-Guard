import { z } from 'zod'
import { dateRangeRefinement, isoDate, optionalEmail, percentage, requiredString, zarAmount } from './schemas'

describe('form schemas', () => {
  it('zarAmount: non-negative, max 2dp', () => {
    expect(zarAmount.safeParse(35000.5).success).toBe(true)
    expect(zarAmount.safeParse(-1).success).toBe(false)
    expect(zarAmount.safeParse(1.005).success).toBe(false)
  })

  it('percentage and isoDate', () => {
    expect(percentage.safeParse(101).success).toBe(false)
    expect(isoDate.safeParse('2026-02-30').success).toBe(false)
    expect(isoDate.safeParse('2026-11-06').success).toBe(true)
  })

  it('requiredString and optionalEmail', () => {
    expect(requiredString('Tenant name').safeParse('  ').error?.issues[0]?.message).toBe(
      'Tenant name is required',
    )
    expect(optionalEmail.safeParse('').success).toBe(true)
    expect(optionalEmail.safeParse('nope').success).toBe(false)
  })

  it('dateRangeRefinement flags end before start on the end path', () => {
    const schema = z
      .object({ startDate: isoDate, endDate: isoDate })
      .superRefine(dateRangeRefinement({ start: 'startDate', end: 'endDate' }))
    const bad = schema.safeParse({ startDate: '2026-11-06', endDate: '2026-11-05' })
    expect(bad.error?.issues[0]?.path).toEqual(['endDate'])
    expect(schema.safeParse({ startDate: '2026-11-06', endDate: '2026-11-06' }).success).toBe(true)
  })
})
