import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import {
  fakeApiClient,
  fakeFetch,
  forbiddenFetch,
  notFoundFetch,
  requestAt,
  sampleRecord,
  TEST_COMPANY_ID,
  TEST_FILTER_ID,
  TEST_RECORD_ID,
  urlOf,
  type FakeFetch,
} from '@/test/fakeApi'

import { createApiUnitSource } from './apiSource'

const unit = sampleRecord('units')
const listed = { ...unit, property: { id: unit.propertyId, name: 'Meadowlands Square', code: 'MSQ' } }

function sourceWith(fetch: FakeFetch) {
  return createApiUnitSource(fakeApiClient(fetch))
}

describe('createApiUnitSource', () => {
  it('lists with the explicit company and every set parameter, exactly as the endpoint accepts them', async () => {
    const fetch = fakeFetch(200, { items: [listed], total: 1, page: 2, pageSize: 10 })
    const page = await sourceWith(fetch).list(TEST_COMPANY_ID, { page: 2, pageSize: 10, search: ' needle ', sort: 'floorAreaSqm', direction: 'desc', propertyId: TEST_FILTER_ID, occupancyStatus: 'vacant', type: 'line_shop' })

    expect(page).toEqual({ items: [listed], total: 1, page: 2, pageSize: 10 })
    expect(urlOf(fetch)).toEqual({
      pathname: '/api/v1/units',
      query: { page: '2', pageSize: '10', search: 'needle', sort: 'floorAreaSqm', direction: 'desc', propertyId: TEST_FILTER_ID, occupancyStatus: 'vacant', type: 'line_shop' },
    })
    // The company in the query key wins over the client's default company.
    expect(requestAt(fetch).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(requestAt(fetch).headers.get('Authorization')).toBe('Bearer token')
  })

  it('sends only paging when no search, sort or filter is set', async () => {
    const fetch = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 25 })
    await sourceWith(fetch).list(TEST_COMPANY_ID, { page: 1, pageSize: 25, search: '  ' })
    expect(urlOf(fetch).query).toEqual({ page: '1', pageSize: '25' })
  })

  it('gets one record by id and maps 404 to null', async () => {
    const found = fakeFetch(200, unit)
    expect(await sourceWith(found).get(TEST_COMPANY_ID, TEST_RECORD_ID)).toEqual(unit)
    expect(urlOf(found).pathname).toBe(`/api/v1/units/${TEST_RECORD_ID}`)
    expect(requestAt(found).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)

    expect(await sourceWith(notFoundFetch()).get(TEST_COMPANY_ID, TEST_RECORD_ID)).toBeNull()
  })

  it('answers not found for non-UUID ids without calling the API', async () => {
    const fetch = fakeFetch(200, unit)
    expect(await sourceWith(fetch).get(TEST_COMPANY_ID, 'demo_record_id')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rethrows other API errors', async () => {
    const error = await sourceWith(forbiddenFetch()).get(TEST_COMPANY_ID, TEST_RECORD_ID).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(403)
    const listError = await sourceWith(forbiddenFetch()).list(TEST_COMPANY_ID, { page: 1, pageSize: 25 }).catch((e: unknown) => e)
    expect((listError as ApiError).status).toBe(403)
  })

  it('creates and edits a unit in the explicit company with exactly the body given', async () => {
    const created = fakeFetch(201, unit)
    const body = { propertyId: TEST_FILTER_ID, unitNumber: 'G14', type: 'kiosk' as const, floorAreaSqm: 12.5 }
    expect(await sourceWith(created).create(TEST_COMPANY_ID, body)).toEqual(unit)
    expect(requestAt(created).method).toBe('POST')
    expect(urlOf(created).pathname).toBe('/api/v1/units')
    expect(requestAt(created).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(created).json()).toEqual(body)

    const edited = fakeFetch(200, unit)
    await sourceWith(edited).update(TEST_COMPANY_ID, TEST_RECORD_ID, { occupancyStatus: 'vacant', floor: null })
    expect(requestAt(edited).method).toBe('PATCH')
    expect(urlOf(edited).pathname).toBe(`/api/v1/units/${TEST_RECORD_ID}`)
    expect(requestAt(edited).headers.get('x-company-id')).toBe(TEST_COMPANY_ID)
    expect(await requestAt(edited).json()).toEqual({ occupancyStatus: 'vacant', floor: null })
  })

  it('rejects a taken unit number with the API error', async () => {
    const conflict = fakeFetch(409, { statusCode: 409, error: 'Conflict', message: 'A unit numbered G14 already exists in this property', requestId: null })
    const error = await sourceWith(conflict)
      .create(TEST_COMPANY_ID, { propertyId: TEST_FILTER_ID, unitNumber: 'G14', type: 'kiosk', floorAreaSqm: 12.5 })
      .catch((e: unknown) => e)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).messages).toEqual(['A unit numbered G14 already exists in this property'])
  })
})
