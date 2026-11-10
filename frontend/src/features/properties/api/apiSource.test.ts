import { ApiError, createApiClient } from '@leaseguard/api-client'
import { describe, expect, it, vi } from 'vitest'

import { createApiPropertySource } from './apiSource'

const COMPANY = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
const PROPERTY_ID = 'f922b1e8-d0cd-5a20-8393-829bec4dbc49'

const property = {
  id: PROPERTY_ID,
  companyId: COMPANY,
  name: 'Meadowlands Square Shopping Centre',
  code: 'MSQ',
  type: 'shopping_centre',
  address: { line1: '1 Main Rd', suburb: 'Meadowlands', city: 'Soweto', province: 'Gauteng', postalCode: '1852', country: 'South Africa' },
  description: 'Community centre',
  status: 'active',
  grossLettableAreaSqm: 18000,
  managerUserId: '7d9f3c2a-0000-5000-8000-000000000001',
  accountingSystem: 'MRI',
  createdAt: '2026-01-01T08:00:00+02:00',
  updatedAt: '2026-01-01T08:00:00+02:00',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function firstRequest(fetch: { mock: { calls: unknown[][] } }): Request {
  const request = fetch.mock.calls[0]?.[0]
  if (!(request instanceof Request)) throw new Error('expected a Request')
  return request
}

function sourceWith(fetch: typeof globalThis.fetch) {
  return createApiPropertySource(createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'token', getCompanyId: () => 'other', fetch }))
}

describe('createApiPropertySource', () => {
  it('lists properties with the explicit company and only the set query parameters', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(200, { items: [property], total: 1, page: 2, pageSize: 10 }))
    const page = await sourceWith(fetch).list(COMPANY, { page: 2, pageSize: 10, search: ' square ', sort: 'name', direction: 'desc', status: 'active' })

    expect(page).toEqual({ items: [property], total: 1, page: 2, pageSize: 10 })
    const request = firstRequest(fetch)
    const url = new URL(request.url)
    expect(url.pathname).toBe('/api/v1/properties')
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '2', pageSize: '10', search: 'square', sort: 'name', direction: 'desc', status: 'active' })
    // The company in the query key wins over the client's default company.
    expect(request.headers.get('x-company-id')).toBe(COMPANY)
    expect(request.headers.get('Authorization')).toBe('Bearer token')
  })

  it('trims the search and caps it at the API search limit', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(200, { items: [], total: 0, page: 1, pageSize: 25 }))
    await sourceWith(fetch).list(COMPANY, { page: 1, pageSize: 25, search: ` ${'m'.repeat(150)} ` })
    expect(new URL(firstRequest(fetch).url).searchParams.get('search')).toBe('m'.repeat(100))

    const blank = vi.fn<typeof globalThis.fetch>(async () => json(200, { items: [], total: 0, page: 1, pageSize: 25 }))
    await sourceWith(blank).list(COMPANY, { page: 1, pageSize: 25, search: '   ' })
    expect(new URL(firstRequest(blank).url).searchParams.has('search')).toBe(false)
  })

  it('gets one property and maps 404 to null', async () => {
    const found = vi.fn<typeof globalThis.fetch>(async () => json(200, property))
    expect(await sourceWith(found).get(COMPANY, PROPERTY_ID)).toEqual(property)
    expect(new URL(firstRequest(found).url).pathname).toBe(`/api/v1/properties/${PROPERTY_ID}`)

    const missing = vi.fn<typeof globalThis.fetch>(async () =>
      json(404, { statusCode: 404, error: 'Not Found', message: 'Property not found', requestId: 'r1' }),
    )
    expect(await sourceWith(missing).get(COMPANY, PROPERTY_ID)).toBeNull()
  })

  it('answers not found for non-UUID ids without calling the API', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    expect(await sourceWith(fetch).get(COMPANY, 'prop_demo_id')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rethrows other API errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json(403, { statusCode: 403, error: 'Forbidden', message: 'Not a member of this company', requestId: null }),
    )
    const error = await sourceWith(fetch).get(COMPANY, PROPERTY_ID).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(403)
  })
})
