import { unwrap, type operations } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, check, expectOk, serviceRole, world } from './support/clients.ts'

/**
 * The monitoring list (ticket M7-01): every PRD §7.2 field reaches the list, named from the database, and each filter
 * narrows it. Two events are added to company A with the service role (one on an active lease, assigned and due soon;
 * one on a property only, unassigned and overdue) and removed in `afterAll`. Each request searches this run's tag so
 * other events in the world never count.
 */

const SA_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })
const saDate = (offsetDays: number) => SA_DATE.format(new Date(Date.now() + offsetDays * 86_400_000))

let lease: WorldLease
let tag = ''
let leaseEventId = ''
let propertyEventId = ''

beforeAll(async () => {
  const a = world().companies.a
  const candidate = a.leases.find((l) => l.status === 'active' && l.verified)
  if (!candidate) throw new Error('The world has no active verified lease in company A')
  lease = candidate
  tag = `M7-01 list ${world().runId}`
  const otherProperty = a.properties.find((p) => p.id !== lease.propertyId)!
  const rows = check(
    await serviceRole()
      .from('monitoring_events')
      .insert([
        {
          company_id: a.id,
          type: 'rental_escalation_discrepancy',
          property_id: lease.propertyId,
          unit_id: lease.unitId,
          tenant_id: lease.tenantId,
          lease_id: lease.id,
          lease_reference: lease.reference,
          title: `${tag}: escalation not applied`,
          description: 'October rental does not include the 8% escalation.',
          calculation: { expectedAmount: 37_800, actualAmount: 35_000, difference: 2_800, steps: ['R35 000 × 1.08 = R37 800'] },
          identified_on: saDate(0),
          due_date: saDate(10),
          priority: 'critical',
          recommended_action: 'Ask the accountant to correct the rental charge.',
          assigned_to_user_id: world().users.manager.id,
          status: 'action_required',
        },
        {
          company_id: a.id,
          type: 'statement_review_required',
          property_id: otherProperty.id,
          title: `${tag}: statement needs review`,
          description: 'A statement value could not be read.',
          identified_on: saDate(-5),
          due_date: saDate(-2),
          priority: 'low',
          recommended_action: 'Review the statement.',
          status: 'new',
        },
      ])
      .select('id, type'),
    'insert list events',
  )
  leaseEventId = rows.find((row) => row.type === 'rental_escalation_discrepancy')!.id
  propertyEventId = rows.find((row) => row.type === 'statement_review_required')!.id
})

afterAll(async () => {
  if (leaseEventId || propertyEventId) {
    expectOk(await serviceRole().from('monitoring_events').delete().in('id', [leaseEventId, propertyEventId].filter(Boolean)), 'remove list events')
  }
})

type ListQuery = NonNullable<operations['listMonitoringEvents']['parameters']['query']>

async function listIds(query: ListQuery = {}, user: 'manager' | 'readOnly' = 'manager'): Promise<string[]> {
  const page = await unwrap(
    apiAs(user, 'a').GET('/api/v1/monitoring/events', { params: { query: { search: tag, pageSize: 100, ...query } } }),
  )
  return page.items.map((item) => item.id).sort()
}

describe('monitoring list (GET /monitoring/events)', () => {
  it('names the property, unit, tenant, lease and assignee of each event, for any member', async () => {
    const page = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/monitoring/events', { params: { query: { search: tag, sort: 'priority', direction: 'desc' } } }))
    expect(page.total).toBe(2)
    const [first, second] = page.items
    const property = world().companies.a.properties.find((p) => p.id === lease.propertyId)!
    const unit = world().companies.a.units.find((u) => u.id === lease.unitId)!
    const tenant = world().companies.a.tenants.find((t) => t.id === lease.tenantId)!
    expect(first).toMatchObject({
      id: leaseEventId,
      type: 'rental_escalation_discrepancy',
      priority: 'critical',
      status: 'action_required',
      propertyName: property.name,
      unitNumber: unit.unitNumber,
      tenantName: tenant.tradingName,
      leaseId: lease.id,
      leaseReference: lease.reference,
      assignedToUserId: world().users.manager.id,
      assigneeName: world().users.manager.fullName,
      recommendedAction: 'Ask the accountant to correct the rental charge.',
      dueDate: saDate(10),
    })
    expect(second).toMatchObject({ id: propertyEventId, priority: 'low', status: 'new' })
    for (const absent of ['unitNumber', 'tenantName', 'assigneeName', 'leaseId']) expect(second).not.toHaveProperty(absent)
  })

  it('filters by unit, tenant and lease', async () => {
    expect(await listIds({ unitId: lease.unitId })).toEqual([leaseEventId])
    expect(await listIds({ tenantId: lease.tenantId })).toEqual([leaseEventId])
    expect(await listIds({ leaseId: lease.id })).toEqual([leaseEventId])
  })

  it('filters by one assignee or the unassigned', async () => {
    expect(await listIds({ assignee: world().users.manager.id })).toEqual([leaseEventId])
    expect(await listIds({ assignee: 'unassigned' })).toEqual([propertyEventId])
    expect(await listIds({ assignee: world().users.admin.id })).toEqual([])
  })

  it('filters by due-date window on the South African date', async () => {
    expect(await listIds({ due: 'overdue' })).toEqual([propertyEventId])
    expect(await listIds({ due: 'next_30_days' })).toEqual([leaseEventId])
    expect(await listIds({ due: 'next_7_days' })).toEqual([])
  })

  it('combines with type, priority and the open flag', async () => {
    expect(await listIds({ type: 'statement_review_required', open: true })).toEqual([propertyEventId])
    expect(await listIds({ priority: 'critical', propertyId: lease.propertyId })).toEqual([leaseEventId])
    expect(await listIds({ open: false })).toEqual([])
  })

  it('refuses a malformed filter (400)', async () => {
    for (const query of [{ assignee: 'someone' }, { due: 'next_year' }, { unitId: 'G12' }]) {
      const error = await apiErrorOf(unwrap(apiAs('manager', 'a').GET('/api/v1/monitoring/events', { params: { query: query as never } })))
      expect(error.status).toBe(400)
    }
  })

  it("never lists another company's events", async () => {
    const page = await unwrap(apiAs('manager', 'b').GET('/api/v1/monitoring/events', { params: { query: { search: tag } } }))
    expect(page.total).toBe(0)
  })
})
