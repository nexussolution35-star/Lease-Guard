import { ApiError } from '@leaseguard/api-client'
import type { UnitTenantAssignmentListItem } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { fakeApiClient, fakeFetch, requestAt, TEST_COMPANY_ID, TEST_FILTER_ID, TEST_RECORD_ID, urlOf, type FakeFetch } from '@/test/fakeApi'

import { createApiUnitAssignmentSource } from './apiSource'

const assignment: UnitTenantAssignmentListItem = {
  id: TEST_RECORD_ID,
  companyId: TEST_COMPANY_ID,
  propertyId: TEST_FILTER_ID,
  unitId: '0b6f1f43-6d5c-4f8e-9d43-3f1a2b7c9e11',
  tenantId: '0b6f1f43-6d5c-4f8e-9d43-3f1a2b7c9e12',
  assignedAt: '2026-11-21T08:00:00Z',
  tenantName: 'Kasi Flame Grill',
  unitNumber: 'S02',
  propertyName: 'Maponya Square',
  createdAt: '2026-11-21T08:00:00Z',
  updatedAt: '2026-11-21T08:00:00Z',
}

const sourceWith = (fetch: FakeFetch) => createApiUnitAssignmentSource(fakeApiClient(fetch))

describe('createApiUnitAssignmentSource', () => {
  it('lists with the explicit company and every set filter', async () => {
    const fetch = fakeFetch(200, { items: [assignment], total: 1, page: 1, pageSize: 100 })
    const page = await sourceWith(fetch).list(TEST_COMPANY_ID, { page: 1, pageSize: 100, tenantId: assignment.tenantId, current: true })
    expect(page.items).toEqual([assignment])
    expect(urlOf(fetch)).toEqual({
      pathname: '/api/v1/unit-assignments',
      query: { page: '1', pageSize: '100', tenantId: assignment.tenantId, current: 'true' },
    })
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('assigns with exactly the tenant and unit', async () => {
    const fetch = fakeFetch(201, assignment)
    expect(await sourceWith(fetch).assign(TEST_COMPANY_ID, { tenantId: assignment.tenantId, unitId: assignment.unitId })).toEqual(assignment)
    expect(requestAt(fetch).method).toBe('POST')
    expect(urlOf(fetch).pathname).toBe('/api/v1/unit-assignments')
    expect(await requestAt(fetch).json()).toEqual({ tenantId: assignment.tenantId, unitId: assignment.unitId })
  })

  it('unassigns by ending the assignment', async () => {
    const fetch = fakeFetch(200, { ...assignment, endedAt: '2026-11-22T08:00:00Z' })
    await sourceWith(fetch).end(TEST_COMPANY_ID, TEST_RECORD_ID)
    expect(requestAt(fetch).method).toBe('POST')
    expect(urlOf(fetch).pathname).toBe(`/api/v1/unit-assignments/${TEST_RECORD_ID}/end`)
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
  })

  it('rejects a unit someone else holds with the API’s words', async () => {
    const message = 'Unit S02 is assigned to Kasi Flame Grill. Unassign it before assigning it to another tenant.'
    const fetch = fakeFetch(409, { statusCode: 409, error: 'Conflict', message, requestId: null })
    const error = await sourceWith(fetch).assign(TEST_COMPANY_ID, { tenantId: assignment.tenantId, unitId: assignment.unitId }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).messages).toEqual([message])
  })
})
