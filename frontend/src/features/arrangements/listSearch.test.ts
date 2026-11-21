import { describe, expect, it } from 'vitest'

import { ARRANGEMENT_LIST_DEFAULTS, arrangementListSearchSchema } from './listSearch'

const TENANT_ID = '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b'
const PROPERTY_ID = '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6c'

describe('arrangementListSearchSchema', () => {
  it('reads every filter from the URL', () => {
    expect(
      arrangementListSearchSchema.parse({
        search: 'october ',
        status: 'active',
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        sort: 'firstInstallmentDate',
        direction: 'asc',
        page: '3',
      }),
    ).toEqual({
      ...ARRANGEMENT_LIST_DEFAULTS,
      page: 3,
      search: 'october ',
      status: 'active',
      tenantId: TENANT_ID,
      propertyId: PROPERTY_ID,
      sort: 'firstInstallmentDate',
      direction: 'asc',
    })
  })

  it('falls back to defaults for invalid values', () => {
    expect(
      arrangementListSearchSchema.parse({ page: 'x', pageSize: 1000, sort: 'tenant', direction: 'up', status: 'paid', tenantId: 'ten_1' }),
    ).toEqual(ARRANGEMENT_LIST_DEFAULTS)
  })
})
