import { describe, expect, it } from 'vitest'

import { PROPERTY_LIST_DEFAULTS, propertyListSearchSchema } from './listSearch'

describe('propertyListSearchSchema', () => {
  it('keeps the search exactly as typed so the debounced search box is not rewritten', () => {
    expect(propertyListSearchSchema.parse({ search: 'mall ' }).search).toBe('mall ')
    expect(propertyListSearchSchema.parse({ search: '  ' }).search).toBe('  ')
  })

  it('does not drop a search longer than the API limit (data sources cap it)', () => {
    const long = 'a'.repeat(150)
    expect(propertyListSearchSchema.parse({ search: long }).search).toBe(long)
  })

  it('falls back to defaults for invalid values', () => {
    expect(propertyListSearchSchema.parse({ page: 'x', pageSize: 1000, sort: 'nope', direction: 'up', search: 42 })).toEqual({
      ...PROPERTY_LIST_DEFAULTS,
      search: undefined,
      status: undefined,
      type: undefined,
    })
  })
})
