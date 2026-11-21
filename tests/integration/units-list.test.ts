import { unwrap } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apiAs, expectOk, serviceRole, world } from './support/clients.ts'

/**
 * The unit list (PRD module 3, `GET /units`) through the real API and the local database: each unit carries its
 * property and, while it has an active lease, that lease's tenant and reference, read through the company-scoped
 * foreign keys under the caller's RLS; filters combine; another company's units never appear.
 */

/** The world's first active lease in company A; its unit is let for this file and restored afterwards. */
const activeLease = () => {
  const lease = world().companies.a.leases.find((l) => l.status === 'active')
  if (!lease) throw new Error('The world has no active lease in company A')
  return lease
}

beforeAll(async () => {
  const lease = activeLease()
  expectOk(
    await serviceRole()
      .from('units')
      .update({ current_lease_id: lease.id, current_tenant_id: lease.tenantId, occupancy_status: 'occupied' })
      .eq('id', lease.unitId),
    'Let the unit of the active lease',
  )
})

afterAll(async () => {
  expectOk(
    await serviceRole().from('units').update({ current_lease_id: null, current_tenant_id: null }).eq('id', activeLease().unitId),
    'Restore the unit',
  )
})

describe('units: list with property, tenant and lease', () => {
  it('shows the tenant and lease of a let unit and the property of every unit', async () => {
    const a = world().companies.a
    const lease = activeLease()
    const page = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/units', { params: { query: { pageSize: 100 } } }))

    expect(page.total).toBe(a.units.length)
    const let_ = page.items.find((unit) => unit.id === lease.unitId)
    expect(let_).toMatchObject({
      occupancyStatus: 'occupied',
      currentTenantId: lease.tenantId,
      currentLeaseId: lease.id,
      currentTenant: { id: lease.tenantId, tradingName: a.tenants.find((t) => t.id === lease.tenantId)?.tradingName },
      currentLease: { id: lease.id, reference: lease.reference },
    })
    expect(let_?.currentLease?.expiryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    for (const unit of page.items) {
      const property = a.properties.find((p) => p.id === unit.propertyId)
      expect(unit.property).toEqual({ id: unit.propertyId, name: property?.name, code: property?.code })
      if (unit.id !== lease.unitId) {
        expect(unit).not.toHaveProperty('currentTenant')
        expect(unit).not.toHaveProperty('currentLease')
      }
    }
  })

  it('combines the property, type and occupancy filters with the unit-number search', async () => {
    const lease = activeLease()
    const unit = world().companies.a.units.find((u) => u.id === lease.unitId)!
    const page = await unwrap(
      apiAs('manager', 'a').GET('/api/v1/units', {
        params: { query: { propertyId: lease.propertyId, occupancyStatus: 'occupied', search: unit.unitNumber } },
      }),
    )
    expect(page.items.map((u) => u.id)).toEqual([lease.unitId])

    const vacant = await unwrap(
      apiAs('manager', 'a').GET('/api/v1/units', { params: { query: { propertyId: lease.propertyId, occupancyStatus: 'vacant', search: unit.unitNumber } } }),
    )
    expect(vacant.items).toEqual([])
  })

  it('never lists another company’s units', async () => {
    const b = world().companies.b
    const page = await unwrap(apiAs('manager', 'b').GET('/api/v1/units', { params: { query: { pageSize: 100 } } }))
    expect(page.total).toBe(b.units.length)
    expect(new Set(page.items.map((unit) => unit.companyId))).toEqual(new Set([b.id]))
    expect(page.items.some((unit) => unit.id === activeLease().unitId)).toBe(false)
  })
})
