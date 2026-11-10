import { COMPANY_ID_HEADER, unwrap } from '@leaseguard/api-client'
import { beforeAll, describe, expect, it } from 'vitest'

import { apiAs, check, integration, serviceRole, world } from './support/clients.ts'

interface LeaseRow {
  id: string
  reference: string
  property_id: string
  verified: boolean
  expiry_date: string
}

/** Every lease of company A (created by the world, possibly changed by other files), ordered exactly as the API orders by reference (reference, then id). */
let expected: LeaseRow[]

beforeAll(async () => {
  expected = check(
    await serviceRole()
      .from('leases')
      .select('id, reference, property_id, verified, expiry_date')
      .eq('company_id', world().companies.a.id)
      .order('reference', { ascending: true })
      .order('id', { ascending: true })
      .overrideTypes<LeaseRow[], { merge: false }>(),
    'List company A leases',
  )
  if (expected.length < 6) throw new Error(`The paging test needs at least 6 leases in company A, found ${expected.length}`)
})

describe('list endpoints: paging, filters, sorting and validation (GET /leases)', () => {
  it('pages through the company leases in a stable order', async () => {
    const api = apiAs('manager', 'a')
    const query = { pageSize: 5, sort: 'reference', direction: 'asc' } as const
    const first = await unwrap(api.GET('/api/v1/leases', { params: { query: { ...query, page: 1 } } }))
    const second = await unwrap(api.GET('/api/v1/leases', { params: { query: { ...query, page: 2 } } }))

    expect(first).toMatchObject({ page: 1, pageSize: 5, total: expected.length })
    expect(second).toMatchObject({ page: 2, pageSize: 5, total: expected.length })
    expect(first.items).toHaveLength(5)
    expect(second.items).toHaveLength(Math.min(5, expected.length - 5))
    const ids = [...first.items, ...second.items].map((lease) => lease.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expected.slice(0, ids.length).map((row) => row.id))
    expect(new Set([...first.items, ...second.items].map((lease) => lease.companyId))).toEqual(new Set([world().companies.a.id]))
  })

  // PostgREST answers a page past the end with 416 / PGRST103 and no count; the API turns that into an
  // empty page that still reports the real total (common/http/pagination.ts emptyPageWithTotal).
  it('returns an empty page past the end, with the total intact', async () => {
    const page = await unwrap(
      apiAs('manager', 'a').GET('/api/v1/leases', { params: { query: { page: 1000, pageSize: 10 } } }),
    )
    expect(page.items).toEqual([])
    expect(page.total).toBe(expected.length)
  })

  it('combines filters (property and verification) and search', async () => {
    const sample = expected.find((row) => row.verified)
    if (!sample) throw new Error('The world has no verified lease in company A')
    const matching = expected.filter((row) => row.property_id === sample.property_id && row.verified)

    const filtered = await unwrap(
      apiAs('manager', 'a').GET('/api/v1/leases', {
        params: { query: { propertyId: sample.property_id, verified: true, pageSize: 100 } },
      }),
    )
    expect(filtered.total).toBe(matching.length)
    expect(filtered.items.map((lease) => lease.id).sort()).toEqual(matching.map((row) => row.id).sort())
    for (const lease of filtered.items) {
      expect(lease.propertyId).toBe(sample.property_id)
      expect(lease.verified).toBe(true)
    }

    const term = sample.reference.slice(0, 5)
    const searched = await unwrap(
      apiAs('manager', 'a').GET('/api/v1/leases', { params: { query: { search: term.toLowerCase(), pageSize: 100 } } }),
    )
    expect(searched.total).toBe(expected.filter((row) => row.reference.includes(term)).length)
    for (const lease of searched.items) expect(lease.reference).toContain(term)
  })

  it('sorts by another allow-listed field in descending order', async () => {
    const page = await unwrap(
      apiAs('manager', 'a').GET('/api/v1/leases', {
        params: { query: { sort: 'expiryDate', direction: 'desc', pageSize: 100 } },
      }),
    )
    expect(page.items).toHaveLength(expected.length)
    const dates = page.items.map((lease) => lease.expiryDate)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  it('rejects invalid list parameters with 400', async () => {
    // The typed client cannot express these values, so they are sent as raw query strings.
    const { apiBaseUrl, accessTokens } = integration()
    const headers = { Authorization: `Bearer ${accessTokens.manager}`, [COMPANY_ID_HEADER]: world().companies.a.id }
    for (const query of ['sort=bogus', 'direction=sideways', 'pageSize=101', 'page=0', 'status=not_a_status', 'verified=yes']) {
      const response = await fetch(`${apiBaseUrl}/api/v1/leases?${query}`, { headers })
      expect(response.status, query).toBe(400)
      expect(await response.json(), query).toMatchObject({ statusCode: 400, error: 'Bad Request' })
    }
  })
})
