import { unwrap } from '@leaseguard/api-client'
import { currentLease, type LeaseStatus } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, check, serviceRole, world } from './support/clients.ts'

/**
 * The tenant list (PRD module 4, ticket M4-02, `GET /tenants`) through the real API and the local database: each tenant
 * carries its current lease with the unit and property (embedded through the company-scoped foreign keys under the
 * caller's RLS) and its lease count; the property filter keeps tenants with a lease there; another company's tenants
 * never appear.
 */

interface LeaseRow {
  id: string
  reference: string
  status: LeaseStatus
  commencement_date: string
  tenant_id: string
  property_id: string
  unit_id: string
}

/** Company A's leases as they are now (other files may verify or change some), straight from the database. */
async function leasesOfCompanyA(): Promise<LeaseRow[]> {
  return check(
    await serviceRole()
      .from('leases')
      .select('id, reference, status, commencement_date, tenant_id, property_id, unit_id')
      .eq('company_id', world().companies.a.id)
      .overrideTypes<LeaseRow[], { merge: false }>(),
    'List company A leases',
  )
}

const worldTenantIds = () => new Set(world().companies.a.tenants.map((t) => t.id))

describe('tenants: list with current lease, unit and property', () => {
  it('shows each world tenant with its current lease, unit, property and lease count', async () => {
    const a = world().companies.a
    const leases = await leasesOfCompanyA()
    const page = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/tenants', { params: { query: { pageSize: 100 } } }))

    const listed = page.items.filter((tenant) => worldTenantIds().has(tenant.id))
    expect(listed).toHaveLength(a.tenants.length)
    for (const tenant of listed) {
      const own = leases.filter((lease) => lease.tenant_id === tenant.id)
      const expected = currentLease(own.map((lease) => ({ ...lease, commencementDate: lease.commencement_date })))
      expect(tenant.leaseCount).toBe(own.length)
      expect(tenant.currentLease?.leaseId).toBe(expected?.id)
      if (!expected) continue
      const property = a.properties.find((p) => p.id === expected.property_id)
      const unit = a.units.find((u) => u.id === expected.unit_id)
      expect(tenant.currentLease).toMatchObject({
        reference: expected.reference,
        status: expected.status,
        unitId: expected.unit_id,
        unitNumber: unit?.unitNumber,
        propertyId: expected.property_id,
        propertyName: property?.name,
      })
      expect(typeof tenant.currentLease?.verified).toBe('boolean')
    }
    expect(new Set(page.items.map((tenant) => tenant.companyId))).toEqual(new Set([a.id]))
  })

  it('filters by property: only tenants with a lease there, with that property’s lease as current', async () => {
    const a = world().companies.a
    const property = a.properties.find((p) => p.code === 'CRV')
    if (!property) throw new Error('The world has no CRV property in company A')
    const leasesThere = (await leasesOfCompanyA()).filter((lease) => lease.property_id === property.id)

    const page = await unwrap(
      apiAs('manager', 'a').GET('/api/v1/tenants', { params: { query: { pageSize: 100, propertyId: property.id } } }),
    )

    expect(page.total).toBe(new Set(leasesThere.map((lease) => lease.tenant_id)).size)
    expect(page.items.map((tenant) => tenant.id).sort()).toEqual([...new Set(leasesThere.map((lease) => lease.tenant_id))].sort())
    for (const tenant of page.items) {
      expect(tenant.currentLease?.propertyId).toBe(property.id)
      expect(tenant.leaseCount).toBe(leasesThere.filter((lease) => lease.tenant_id === tenant.id).length)
    }
  })

  it('combines the property filter with search and paging', async () => {
    const a = world().companies.a
    const property = a.properties.find((p) => p.code === 'ACP')!
    const first = a.tenants[0]!
    const page = await unwrap(
      apiAs('manager', 'a').GET('/api/v1/tenants', {
        params: { query: { propertyId: property.id, search: first.tradingName, page: 1, pageSize: 1 } },
      }),
    )
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 1 })
    expect(page.items[0]).toMatchObject({ id: first.id, currentLease: { propertyId: property.id } })
  })

  it('never lists another company’s tenants, even filtered by its property', async () => {
    const a = world().companies.a
    const b = world().companies.b
    const bPage = await unwrap(apiAs('manager', 'b').GET('/api/v1/tenants', { params: { query: { pageSize: 100 } } }))
    expect(bPage.items.some((tenant) => worldTenantIds().has(tenant.id))).toBe(false)
    expect(new Set(bPage.items.map((tenant) => tenant.companyId))).toEqual(new Set([b.id]))

    const crossed = await unwrap(
      apiAs('manager', 'b').GET('/api/v1/tenants', { params: { query: { propertyId: a.properties[0]!.id } } }),
    )
    expect(crossed).toMatchObject({ items: [], total: 0 })
  })

  it('refuses a property filter that is not a UUID', async () => {
    const error = await apiErrorOf(unwrap(apiAs('manager', 'a').GET('/api/v1/tenants', { params: { query: { propertyId: 'ACP' } } })))
    expect(error.status).toBe(400)
  })
})
