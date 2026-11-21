import { describe, expect, it } from 'vitest'

import { LEASE_LIST_DEFAULTS, leaseListParamsFrom, leaseListSearchSchema } from './listSearch'

const PROPERTY_ID = '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b'

describe('leaseListSearchSchema', () => {
  it('reads every filter from the URL', () => {
    expect(
      leaseListSearchSchema.parse({
        search: 'umoya ',
        status: 'active',
        verification: 'unverified',
        propertyId: PROPERTY_ID,
        expiresWithinDays: '90',
        sort: 'expiryDate',
        direction: 'desc',
        page: '2',
      }),
    ).toEqual({
      ...LEASE_LIST_DEFAULTS,
      page: 2,
      search: 'umoya ',
      status: 'active',
      verification: 'unverified',
      propertyId: PROPERTY_ID,
      expiresWithinDays: 90,
      sort: 'expiryDate',
      direction: 'desc',
    })
  })

  it('falls back to defaults for invalid values', () => {
    expect(
      leaseListSearchSchema.parse({
        page: 'x',
        pageSize: 1000,
        sort: 'tenant',
        direction: 'up',
        search: 42,
        status: 'lapsed',
        verification: 'yes',
        propertyId: 'prop_1',
        expiresWithinDays: '45',
      }),
    ).toEqual({
      ...LEASE_LIST_DEFAULTS,
      search: undefined,
      status: undefined,
      verification: undefined,
      propertyId: undefined,
      expiresWithinDays: undefined,
    })
  })
})

describe('leaseListParamsFrom', () => {
  it('turns the verification filter into the API verified flag', () => {
    const base = leaseListSearchSchema.parse({})
    expect(leaseListParamsFrom({ ...base, verification: 'unverified' })).toMatchObject({ verified: false })
    expect(leaseListParamsFrom({ ...base, verification: 'verified' })).toMatchObject({ verified: true })
    expect(leaseListParamsFrom(base)).not.toHaveProperty('verified')
    expect(leaseListParamsFrom({ ...base, verification: 'verified' })).not.toHaveProperty('verification')
  })
})
