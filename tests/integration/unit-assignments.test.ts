import { unwrap, type CreateLeaseDto } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { localSql } from '../fixtures/local-db.ts'
import { apiAs, apiErrorOf, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Assigning a tenant to a unit without a lease (ticket M4-04) through the real API and the local database: writers
 * assign (a tenant may hold several units, a unit one current tenant) and unassign (kept as history, the unit vacant
 * again); conflicts name who holds the unit; members who only read and other companies are refused; the unit, unit
 * list and tenant list show the assigned tenant; a lease of an assigned unit must be for the assigned tenant; every
 * assign and unassign reaches the audit log.
 */

const property = () => world().companies.a.properties.find((p) => p.code === 'ACP')!
const tenant = (index: number) => world().companies.a.tenants[index]!
/** The world's ACP-001 unit, let to tenant 0 under an active lease. */
const letUnit = () => world().companies.a.units.find((u) => u.unitNumber === 'ACP-001')!

const number = (suffix: string) => `ZA${suffix}-${integration().runId}`.slice(0, 30)
const unitIds: string[] = []
/** Units added by single tests (not the shared X and Y). */
const extraUnitIds: string[] = []
const unitId = (index: number) => unitIds[index]!
let assignmentId: string | undefined

beforeAll(async () => {
  for (const suffix of ['X', 'Y']) {
    const unit = await unwrap(
      apiAs('manager', 'a').POST('/api/v1/units', { body: { propertyId: property().id, unitNumber: number(suffix), type: 'kiosk', floorAreaSqm: 10 } }),
    )
    unitIds.push(unit.id)
  }
})

afterAll(async () => {
  const a = world().companies.a.id
  const allUnitIds = [...unitIds, ...extraUnitIds]
  if (allUnitIds.length === 0) return
  expectOk(await serviceRole().from('leases').delete().eq('company_id', a).in('unit_id', allUnitIds), 'Delete this file’s leases')
  expectOk(await serviceRole().from('unit_tenant_assignments').delete().eq('company_id', a).in('unit_id', allUnitIds), 'Delete this file’s assignments')
  expectOk(await serviceRole().from('units').delete().eq('company_id', a).in('id', allUnitIds), 'Delete this file’s units')
})

/** Every audit summary for one record, oldest first, read as the database owner. */
async function auditSummaries(entityId: string): Promise<string[]> {
  if (!/^[0-9a-f-]{36}$/.test(entityId)) throw new Error(`Not a uuid: ${entityId}`)
  const rows = (await localSql(`select summary from public.audit_logs where entity_id = '${entityId}' order by occurred_at, id`)) as { summary: string }[]
  return rows.map((row) => row.summary)
}

const SLOW = 90_000

describe('unit assignments: assign', () => {
  it('lets a property manager assign a tenant to a vacant unit, which becomes occupied by that tenant', async () => {
    const assignment = await unwrap(apiAs('manager', 'a').POST('/api/v1/unit-assignments', { body: { tenantId: tenant(2).id, unitId: unitId(0) } }))
    expect(assignment).toMatchObject({
      companyId: world().companies.a.id,
      propertyId: property().id,
      unitId: unitId(0),
      tenantId: tenant(2).id,
      tenantName: tenant(2).tradingName,
      unitNumber: number('X'),
      propertyName: property().name,
      assignedByUserId: world().users.manager.id,
    })
    expect(assignment).not.toHaveProperty('endedAt')
    assignmentId = assignment.id

    const unit = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/units/{unitId}', { params: { path: { unitId: unitId(0) } } }))
    expect(unit).toMatchObject({
      occupancyStatus: 'occupied',
      currentTenantId: tenant(2).id,
      currentAssignment: { id: assignment.id, tenantId: tenant(2).id, tenantName: tenant(2).tradingName },
    })
    expect(unit).not.toHaveProperty('currentLeaseId')
  })

  it('shows the assigned tenant in the unit list and the unit in the tenant list', async () => {
    const units = await unwrap(
      apiAs('readOnly', 'a').GET('/api/v1/units', { params: { query: { propertyId: property().id, search: number('X'), pageSize: 100 } } }),
    )
    expect(units.items.find((u) => u.id === unitId(0))).toMatchObject({ currentTenant: { id: tenant(2).id }, currentAssignment: { tenantId: tenant(2).id } })

    const tenants = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/tenants', { params: { query: { search: tenant(2).tradingName, pageSize: 100 } } }))
    const listed = tenants.items.find((t) => t.id === tenant(2).id)
    expect(listed?.currentUnits).toContainEqual({ unitId: unitId(0), unitNumber: number('X'), propertyId: property().id, propertyName: property().name })
  })

  it('returns the current assignment when the holder is assigned again', async () => {
    const again = await unwrap(apiAs('manager', 'a').POST('/api/v1/unit-assignments', { body: { tenantId: tenant(2).id, unitId: unitId(0) } }))
    expect(again.id).toBe(assignmentId)
  })

  it('lets a tenant hold several units', async () => {
    await unwrap(apiAs('admin', 'a').POST('/api/v1/unit-assignments', { body: { tenantId: tenant(2).id, unitId: unitId(1) } }))
    const page = await unwrap(
      apiAs('readOnly', 'a').GET('/api/v1/unit-assignments', { params: { query: { tenantId: tenant(2).id, current: true } } }),
    )
    expect(page.items.map((a) => a.unitId).sort()).toEqual([...unitIds].sort())
  })

  it('refuses a unit assigned to another tenant, naming who holds it', async () => {
    const error = await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/unit-assignments', { body: { tenantId: tenant(3).id, unitId: unitId(0) } })))
    expect(error.status).toBe(409)
    expect(error.messages).toEqual([`Unit ${number('X')} is assigned to ${tenant(2).tradingName}. Unassign it before assigning it to another tenant.`])
  })

  it('refuses a unit let to another tenant under an active lease, naming the tenant and lease', async () => {
    const error = await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/unit-assignments', { body: { tenantId: tenant(3).id, unitId: letUnit().id } })))
    expect(error.status).toBe(409)
    expect(error.messages[0]).toMatch(new RegExp(`^Unit ACP-001 is let to ${tenant(0).tradingName} under lease `))
  })

  it('lets only one of two writers assigning the same unit at once succeed', async () => {
    const unit = await unwrap(
      apiAs('manager', 'a').POST('/api/v1/units', { body: { propertyId: property().id, unitNumber: number('Z'), type: 'kiosk', floorAreaSqm: 10 } }),
    )
    extraUnitIds.push(unit.id)
    const results = await Promise.allSettled([
      unwrap(apiAs('manager', 'a').POST('/api/v1/unit-assignments', { body: { tenantId: tenant(1).id, unitId: unit.id } })),
      unwrap(apiAs('admin', 'a').POST('/api/v1/unit-assignments', { body: { tenantId: tenant(3).id, unitId: unit.id } })),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const refused = results.find((result) => result.status === 'rejected')
    expect(refused).toBeDefined()
    const error = await apiErrorOf(Promise.reject((refused as PromiseRejectedResult).reason))
    expect(error.status).toBe(409)
    const current = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/unit-assignments', { params: { query: { unitId: unit.id, current: true } } }))
    expect(current.items).toHaveLength(1)
  })

  it('refuses members who only read and property owners', async () => {
    for (const user of ['readOnly', 'owner'] as const) {
      const error = await apiErrorOf(unwrap(apiAs(user, 'a').POST('/api/v1/unit-assignments', { body: { tenantId: tenant(3).id, unitId: unitId(0) } })))
      expect(error.status).toBe(403)
    }
  })

  it('does not find another company’s unit or tenant', async () => {
    const otherUnit = world().companies.b.units[0]!
    const unitError = await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/unit-assignments', { body: { tenantId: tenant(3).id, unitId: otherUnit.id } })))
    expect(unitError.status).toBe(404)
    const otherTenant = world().companies.b.tenants[0]!
    const tenantError = await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/unit-assignments', { body: { tenantId: otherTenant.id, unitId: unitId(0) } })))
    expect(tenantError.status).toBe(404)
    const list = await unwrap(apiAs('manager', 'b').GET('/api/v1/unit-assignments', { params: { query: { unitId: unitId(0) } } }))
    expect(list.total).toBe(0)
  })
})

describe('unit assignments: leases of an assigned unit', () => {
  const lease = (tenantId: string): CreateLeaseDto => ({
    reference: `ZA-${integration().runId}-${tenantId.slice(0, 4)}`.slice(0, 40),
    tenantId,
    propertyId: property().id,
    unitId: unitId(1),
    commencementDate: '2027-01-01',
    expiryDate: '2031-12-31',
    initialMonthlyRental: 20000,
    paymentDueDay: 1,
    escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2028-01-01' },
    renewalOption: { exists: false },
    deposit: { amount: 40000, heldBy: 'landlord', interestBearing: false },
  })

  it('refuses a lease of an assigned unit for another tenant, in words', async () => {
    const error = await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/leases', { body: lease(tenant(3).id) })))
    expect(error.status).toBe(422)
    expect(error.messages.join(' ')).toContain(`is assigned to ${tenant(2).tradingName}, so its lease must be for ${tenant(2).tradingName}`)
  })

  it('accepts a lease of an assigned unit for the assigned tenant', async () => {
    const created = await unwrap(apiAs('manager', 'a').POST('/api/v1/leases', { body: lease(tenant(2).id) }))
    expect(created).toMatchObject({ tenantId: tenant(2).id, unitId: unitId(1), verified: false })
  })
})

describe('unit assignments: unassign', () => {
  it('ends the assignment, keeps it as history and returns the unit to vacant', { timeout: SLOW }, async () => {
    const ended = await unwrap(apiAs('manager', 'a').POST('/api/v1/unit-assignments/{assignmentId}/end', { params: { path: { assignmentId: assignmentId! } } }))
    expect(ended).toMatchObject({ id: assignmentId, endedByUserId: world().users.manager.id })
    expect(ended.endedAt).toBeDefined()

    const unit = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/units/{unitId}', { params: { path: { unitId: unitId(0) } } }))
    expect(unit.occupancyStatus).toBe('vacant')
    expect(unit).not.toHaveProperty('currentTenantId')
    expect(unit).not.toHaveProperty('currentAssignment')

    const history = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/unit-assignments', { params: { query: { unitId: unitId(0), current: false } } }))
    expect(history.items.map((a) => a.id)).toEqual([assignmentId])

    const summaries = await auditSummaries(unitId(0))
    expect(summaries).toContain(`${tenant(2).tradingName} assigned to unit ${number('X')} in ${property().name}`)
    expect(summaries).toContain(`${tenant(2).tradingName} unassigned from unit ${number('X')} in ${property().name}`)
  })

  it('refuses to end an assignment twice', async () => {
    const error = await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/unit-assignments/{assignmentId}/end', { params: { path: { assignmentId: assignmentId! } } })))
    expect(error.status).toBe(409)
    expect(error.messages).toEqual(['This assignment has already ended.'])
  })

  it('refuses members who only read', async () => {
    const current = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/unit-assignments', { params: { query: { unitId: unitId(1), current: true } } }))
    const error = await apiErrorOf(unwrap(apiAs('readOnly', 'a').POST('/api/v1/unit-assignments/{assignmentId}/end', { params: { path: { assignmentId: current.items[0]!.id } } })),
    )
    expect(error.status).toBe(403)
  })
})
