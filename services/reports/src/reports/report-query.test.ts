import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { saToday } from './as-of'
import { reportFiltersFrom, reportQuerySchema } from './report-query'

const PROPERTY = '3a1b2c3d-4e5f-4061-8728-394a5b6c7d8e'

describe('reportQuerySchema', () => {
  it('reads a single or repeated propertyId and status as lists', () => {
    expect(reportQuerySchema.parse({ propertyId: PROPERTY, status: 'vacant' })).toEqual({ propertyId: [PROPERTY], status: ['vacant'] })
    expect(reportQuerySchema.parse({ status: ['vacant', 'occupied'] }).status).toEqual(['vacant', 'occupied'])
    expect(reportQuerySchema.parse({})).toEqual({})
  })

  it('refuses malformed ids and dates, and parameters no report takes', () => {
    expect(reportQuerySchema.safeParse({ propertyId: 'MSQ' }).success).toBe(false)
    expect(reportQuerySchema.safeParse({ from: '21 Nov 2026' }).success).toBe(false)
    expect(reportQuerySchema.safeParse({ page: '2' }).success).toBe(false)
  })
})

describe('reportFiltersFrom', () => {
  it('keeps the filters the report offers and states them back', () => {
    expect(reportFiltersFrom('occupancy', { propertyId: [PROPERTY], status: ['vacant'], from: '2026-01-01' })).toEqual({
      propertyIds: [PROPERTY],
      statuses: ['vacant'],
    })
  })

  it('refuses a status the report does not offer with a 400 naming it', () => {
    expect(() => reportFiltersFrom('portfolio_overview', { status: ['vacant'] })).toThrow(BadRequestException)
  })
})

describe('saToday', () => {
  it('is the South African calendar date, whatever the host time zone', () => {
    // 22:30 UTC on 21 Nov is 00:30 on 22 Nov in Johannesburg (UTC+2).
    expect(saToday(new Date('2026-11-21T22:30:00Z'))).toBe('2026-11-22')
    expect(saToday(new Date('2026-11-21T08:00:00Z'))).toBe('2026-11-21')
  })
})
