import { describe, expect, it } from 'vitest'

import { MONITORING_LIST_DEFAULTS, monitoringListParamsFrom, monitoringListSearchSchema } from './listSearch'

const PROPERTY_ID = '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b'
const UNIT_ID = '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6c'
const TENANT_ID = '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6d'
const LEASE_ID = '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6e'
const USER_ID = '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6f'

describe('monitoringListSearchSchema', () => {
  it('reads every filter from the URL', () => {
    expect(
      monitoringListSearchSchema.parse({
        search: 'escalation ',
        type: 'rental_escalation_discrepancy',
        priority: 'high',
        status: 'action_required',
        propertyId: PROPERTY_ID,
        unitId: UNIT_ID,
        tenantId: TENANT_ID,
        leaseId: LEASE_ID,
        assignee: USER_ID,
        due: 'next_30_days',
        sort: 'dueDate',
        direction: 'asc',
        page: '2',
        pageSize: '50',
      }),
    ).toEqual({
      page: 2,
      pageSize: 50,
      search: 'escalation ',
      type: 'rental_escalation_discrepancy',
      priority: 'high',
      status: 'action_required',
      propertyId: PROPERTY_ID,
      unitId: UNIT_ID,
      tenantId: TENANT_ID,
      leaseId: LEASE_ID,
      assignee: USER_ID,
      due: 'next_30_days',
      sort: 'dueDate',
      direction: 'asc',
    })
  })

  it('defaults to the most recently identified events first', () => {
    expect(monitoringListSearchSchema.parse({})).toEqual({ ...MONITORING_LIST_DEFAULTS })
  })

  it('drops invalid values instead of failing the route', () => {
    const parsed = monitoringListSearchSchema.parse({
      type: 'payment',
      priority: 'urgent',
      status: 'paid',
      propertyId: 'prop_1',
      unitId: 'G12',
      assignee: 'someone',
      due: 'next_year',
      sort: 'title',
      page: '-1',
      pageSize: '1000',
    })
    expect(parsed).toEqual({ ...MONITORING_LIST_DEFAULTS })
  })

  it('accepts the unassigned filter', () => {
    expect(monitoringListSearchSchema.parse({ assignee: 'unassigned' }).assignee).toBe('unassigned')
  })
})

describe('monitoringListParamsFrom', () => {
  it('reads open and closed as the API open boolean, and one status as itself', () => {
    const base = monitoringListSearchSchema.parse({})
    expect(monitoringListParamsFrom({ ...base, status: 'open' })).toEqual({ ...base, open: true })
    expect(monitoringListParamsFrom({ ...base, status: 'closed' })).toEqual({ ...base, open: false })
    expect(monitoringListParamsFrom({ ...base, status: 'dismissed' })).toEqual({ ...base, status: 'dismissed' })
    expect(monitoringListParamsFrom(base)).toEqual(base)
  })
})
