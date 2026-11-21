import { describe, expect, it } from 'vitest'

import { TENANT_LIST_DEFAULTS, tenantListSearchSchema } from './listSearch'

const PROPERTY_ID = '0b6f1f43-6d5c-4f8e-9d43-3f1a2b7c9e10'

describe('tenantListSearchSchema', () => {
  it('reads search, filters, sort and paging from the URL', () => {
    expect(
      tenantListSearchSchema.parse({ page: '2', pageSize: '50', search: 'ubuntu ', sort: 'status', direction: 'desc', status: 'in_arrears', propertyId: PROPERTY_ID }),
    ).toEqual({ page: 2, pageSize: 50, search: 'ubuntu ', sort: 'status', direction: 'desc', status: 'in_arrears', propertyId: PROPERTY_ID })
  })

  it('falls back to defaults for invalid values', () => {
    expect(
      tenantListSearchSchema.parse({ page: 'x', pageSize: 1000, sort: 'nope', direction: 'up', search: 42, status: 'late', propertyId: 'ACP' }),
    ).toEqual({ ...TENANT_LIST_DEFAULTS, search: undefined, status: undefined, propertyId: undefined })
  })
})
