import { unwrap } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, check, gatewayAs, integration, serviceRole, world } from './support/clients.ts'

/**
 * Portfolio overview and occupancy (ticket R-01) on the local stack, through the gateway like the web app: the reports
 * service computes them from the reporting functions under the caller's RLS, and every figure equals the dashboard's
 * (the core API) and the database's for the same data, for every member role, never across companies.
 */

const OPEN = ['new', 'under_review', 'action_required', 'in_progress']

const portfolioOf = (company: 'a' | 'b', user: 'admin' | 'manager' | 'readOnly' | 'owner' = 'manager', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/portfolio_overview', { params: { query } }))
const occupancyOf = (company: 'a' | 'b', user: 'admin' | 'manager' | 'readOnly' | 'owner' = 'manager', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/occupancy', { params: { query } }))
const dashboardOf = (company: 'a' | 'b') => unwrap(apiAs('manager', company).GET('/api/v1/dashboard/summary'))

async function openEventCount(companyId: string): Promise<number> {
  const { count, error } = await serviceRole()
    .from('monitoring_events')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .in('status', OPEN)
  if (error) throw new Error(error.message)
  return count ?? 0
}

describe('GET /api/v1/reports/portfolio_overview', () => {
  it('matches the dashboard figures for the same data, in both companies', async () => {
    for (const company of ['a', 'b'] as const) {
      const [report, dashboard] = await Promise.all([portfolioOf(company), dashboardOf(company)])
      expect(report.reportId).toBe('portfolio_overview')
      expect(report.asOf).toBe(dashboard.asOf)
      expect(report.data, company).toMatchObject({
        propertyCount: dashboard.properties,
        unitCount: dashboard.units,
        occupiedUnits: dashboard.occupiedUnits,
        activeLeases: dashboard.activeLeases,
        totalOutstanding: dashboard.totalOutstanding,
        tenantsInArrears: dashboard.tenantsInArrears,
      })
      expect(report.data.openEvents, company).toBe(await openEventCount(world().companies[company].id))
      // The totals are the rows added up, so the CSV of the rows agrees with the strip above it.
      const rows = report.data.properties
      expect(rows.reduce((total, row) => total + row.unitCount, 0)).toBe(report.data.unitCount)
      expect(rows.reduce((total, row) => total + row.openEvents, 0)).toBe(report.data.openEvents)
    }
  })

  it('lists exactly the company\'s properties, with their units from the database', async () => {
    const a = world().companies.a
    const report = await portfolioOf('a')
    expect(report.data.properties.map((row) => row.propertyId).sort()).toEqual(a.properties.map((property) => property.id).sort())
    const units = check(await serviceRole().from('units').select('id, property_id').eq('company_id', a.id), 'units of A')
    for (const row of report.data.properties) {
      expect(row.unitCount, row.code).toBe(units.filter((unit: { property_id: string }) => unit.property_id === row.propertyId).length)
    }
    // Active leases as the dashboard counts them (status active), as the database holds them now: another file may
    // have verified one of the world's pending leases (leases.test.ts) before this one runs.
    const leases = check(await serviceRole().from('leases').select('id').eq('company_id', a.id).eq('status', 'active'), 'active leases of A')
    expect(report.data.activeLeases).toBe(leases.length)
  })

  it('narrows to the filtered property and states the filters back', async () => {
    const property = world().companies.a.properties[0]
    if (!property) throw new Error('company A has no property')
    const report = await portfolioOf('a', 'manager', { propertyId: [property.id] })
    expect(report.filters).toEqual({ propertyIds: [property.id] })
    expect(report.data.properties.map((row) => row.propertyId)).toEqual([property.id])
    expect(report.data.propertyCount).toBe(1)

    const archivedOnly = await portfolioOf('a', 'manager', { status: ['archived'] })
    expect(archivedOnly.data.properties.every((row) => row.status === 'archived')).toBe(true)
  })

  it('refuses a status it does not offer', async () => {
    const error = await apiErrorOf(portfolioOf('a', 'manager', { status: ['vacant'] }))
    expect(error.status).toBe(400)
  })
})

describe('GET /api/v1/reports/occupancy', () => {
  it('counts the dashboard\'s units and occupied units, each unit with its current tenant from the database', async () => {
    for (const company of ['a', 'b'] as const) {
      const [report, dashboard] = await Promise.all([occupancyOf(company), dashboardOf(company)])
      expect(report.data.totals.total, company).toBe(dashboard.units)
      expect(report.data.totals.occupied, company).toBe(dashboard.occupiedUnits)
      expect(report.data.byProperty.reduce((total, row) => total + row.total, 0)).toBe(report.data.totals.total)
      expect(report.data.byUnitType.reduce((total, row) => total + row.total, 0)).toBe(report.data.totals.total)

      const units = check(
        await serviceRole().from('units').select('id, current_tenant_id, current_lease_id, occupancy_status').eq('company_id', world().companies[company].id),
        'units',
      ) as { id: string; current_tenant_id: string | null; current_lease_id: string | null; occupancy_status: string }[]
      for (const row of report.data.units) {
        const unit = units.find((candidate) => candidate.id === row.unitId)
        expect(unit, row.unitNumber).toBeDefined()
        expect(row.occupancyStatus).toBe(unit?.occupancy_status)
        expect(row.tenantId ?? null).toBe(unit?.current_tenant_id ?? null)
        expect(row.tenantSource ?? null).toBe(unit?.current_lease_id ? 'lease' : unit?.current_tenant_id ? 'assignment' : null)
      }
    }
  })

  it('narrows to occupancy statuses', async () => {
    const report = await occupancyOf('a', 'manager', { status: ['vacant'] })
    expect(report.filters).toEqual({ statuses: ['vacant'] })
    expect(report.data.units.every((unit) => unit.occupancyStatus === 'vacant')).toBe(true)
    expect(report.data.totals.total).toBe(report.data.units.length)
  })
})

describe('reports access', () => {
  it('is read-only and the same for every member role of the company', async () => {
    const manager = await portfolioOf('a', 'manager')
    for (const user of ['admin', 'readOnly', 'owner'] as const) {
      expect((await portfolioOf('a', user)).data, user).toEqual(manager.data)
      expect((await occupancyOf('a', user)).data.totals, user).toEqual((await occupancyOf('a')).data.totals)
    }
    // There is nothing to write: the report paths answer reads only.
    const { gatewayBaseUrl, accessTokens, world: w } = integration()
    const write = await fetch(`${gatewayBaseUrl}/api/v1/reports/portfolio_overview`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessTokens.manager}`, 'x-company-id': w.companies.a.id },
    })
    expect(write.status).toBe(404)
  })

  it('never answers for another company', async () => {
    // The admin and the read-only member belong to company A only.
    expect((await apiErrorOf(portfolioOf('b', 'admin'))).status).toBe(403)
    expect((await apiErrorOf(occupancyOf('b', 'readOnly'))).status).toBe(403)
    // A member of both sees each company's own properties only.
    const b = await portfolioOf('b')
    const aIds = new Set(world().companies.a.properties.map((property) => property.id))
    expect(b.data.properties.some((row) => aIds.has(row.propertyId))).toBe(false)
  })

  it('requires a signed-in caller and the active company', async () => {
    expect((await apiErrorOf(unwrap(gatewayAs(null, 'a').GET('/api/v1/reports/occupancy')))).status).toBe(401)
    expect((await apiErrorOf(unwrap(gatewayAs('manager').GET('/api/v1/reports/occupancy')))).status).toBe(400)
  })
})
