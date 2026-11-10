import { unwrap } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, world } from './support/clients.ts'

describe('company isolation', () => {
  it('refuses a company the caller is not a member of (403)', async () => {
    // The admin belongs to company A only.
    const error = await apiErrorOf(unwrap(apiAs('admin', 'b').GET('/api/v1/properties', { params: { query: {} } })))
    expect(error.status).toBe(403)
  })

  it('requires a well-formed X-Company-Id header (400)', async () => {
    const missing = await apiErrorOf(unwrap(apiAs('admin').GET('/api/v1/properties', { params: { query: {} } })))
    expect(missing.status).toBe(400)
    const malformed = await apiErrorOf(unwrap(apiAs('admin', 'not-a-uuid').GET('/api/v1/properties', { params: { query: {} } })))
    expect(malformed.status).toBe(400)
  })

  it("hides another company's records by id (404), even when asked under the caller's own company", async () => {
    const b = world().companies.b
    const api = apiAs('admin', 'a')
    const property = await apiErrorOf(
      unwrap(api.GET('/api/v1/properties/{propertyId}', { params: { path: { propertyId: b.properties[0]!.id } } })),
    )
    expect(property.status).toBe(404)
    const lease = await apiErrorOf(unwrap(api.GET('/api/v1/leases/{leaseId}', { params: { path: { leaseId: b.leases[0]!.id } } })))
    expect(lease.status).toBe(404)
  })

  it('scopes a member of both companies to the active company only', async () => {
    // The manager is a property manager in both companies.
    const { a, b } = world().companies
    const bPropertyId = b.properties[0]!.id
    const underA = await apiErrorOf(
      unwrap(apiAs('manager', 'a').GET('/api/v1/properties/{propertyId}', { params: { path: { propertyId: bPropertyId } } })),
    )
    expect(underA.status).toBe(404)

    const underB = await unwrap(
      apiAs('manager', 'b').GET('/api/v1/properties/{propertyId}', { params: { path: { propertyId: bPropertyId } } }),
    )
    expect(underB.companyId).toBe(b.id)

    const aList = await unwrap(apiAs('manager', 'a').GET('/api/v1/properties', { params: { query: { pageSize: 100 } } }))
    expect(aList.items.map((p) => p.id).sort()).toEqual(a.properties.map((p) => p.id).sort())
    expect(aList.items.map((p) => p.name).sort()).toEqual(a.properties.map((p) => p.name).sort())
    expect(aList.items.map((p) => p.id)).not.toContain(bPropertyId)
    expect(new Set(aList.items.map((p) => p.companyId))).toEqual(new Set([a.id]))
  })
})
