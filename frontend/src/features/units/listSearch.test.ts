import { describe, expect, it } from 'vitest'

import { UNIT_LIST_DEFAULTS, unitListSearchSchema } from './listSearch'

const PROPERTY_ID = 'a1b2c3d4-0000-4000-8000-0000000000aa'

describe('unitListSearchSchema', () => {
  it('keeps the search exactly as typed so the debounced search box is not rewritten', () => {
    expect(unitListSearchSchema.parse({ search: 'G1 ' }).search).toBe('G1 ')
  })

  it('reads the property, unit type and occupancy filters', () => {
    expect(unitListSearchSchema.parse({ propertyId: PROPERTY_ID, type: 'line_shop', occupancyStatus: 'vacant' })).toMatchObject({
      propertyId: PROPERTY_ID,
      type: 'line_shop',
      occupancyStatus: 'vacant',
    })
  })

  it('falls back to defaults for invalid values', () => {
    expect(
      unitListSearchSchema.parse({ page: 'x', pageSize: 1000, sort: 'tenant', direction: 'up', search: 42, propertyId: 'msq', type: 'castle', occupancyStatus: 'let' }),
    ).toEqual({ ...UNIT_LIST_DEFAULTS, search: undefined, propertyId: undefined, type: undefined, occupancyStatus: undefined })
  })
})
