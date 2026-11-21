import { unwrap } from '@leaseguard/api-client'
import { nextEventStatuses, type MonitoringEventStatus } from '@leaseguard/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, check, expectOk, serviceRole, world } from './support/clients.ts'

/**
 * The monitoring event detail and its status workflow (ticket M7-02): the detail names the event's records and keeps
 * its calculation; a writer walks the domain workflow to a dismissal with a reason; every move, with the note given,
 * is in the event's history (the audit log, filtered by the event). One event is added to company A with the service
 * role and removed in `afterAll`.
 */

const SA_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })
const today = SA_DATE.format(new Date())
const CALCULATION = { expectedAmount: 37_800, actualAmount: 35_000, difference: 2_800, steps: ['R35 000 × 1.08 = R37 800', 'Billed R35 000'] }

let lease: WorldLease
let eventId = ''

const detailPath = '/api/v1/monitoring/events/{eventId}'
const statusPath = '/api/v1/monitoring/events/{eventId}/status'

beforeAll(async () => {
  const a = world().companies.a
  const candidate = a.leases.find((l) => l.status === 'active' && l.verified)
  if (!candidate) throw new Error('The world has no active verified lease in company A')
  lease = candidate
  const [row] = check(
    await serviceRole()
      .from('monitoring_events')
      .insert({
        company_id: a.id,
        type: 'rental_escalation_discrepancy',
        property_id: lease.propertyId,
        unit_id: lease.unitId,
        tenant_id: lease.tenantId,
        lease_id: lease.id,
        lease_reference: lease.reference,
        title: `M7-02 detail ${world().runId}: escalation not applied`,
        description: 'October rental does not include the 8% escalation.',
        calculation: CALCULATION,
        identified_on: today,
        priority: 'high',
        recommended_action: 'Ask the accountant to correct the rental charge.',
        assigned_to_user_id: world().users.manager.id,
        status: 'new',
      })
      .select('id'),
    'insert detail event',
  )
  eventId = row!.id
})

afterAll(async () => {
  if (eventId) expectOk(await serviceRole().from('monitoring_events').delete().eq('id', eventId), 'remove detail event')
})

async function history(user: 'manager' | 'readOnly' = 'manager') {
  return unwrap(
    apiAs(user, 'a').GET('/api/v1/audit-logs', { params: { query: { entityType: 'monitoring_event', entityId: eventId, pageSize: 50 } } }),
  )
}

describe('monitoring event detail (GET /monitoring/events/{id})', () => {
  it('names the property, unit, tenant and assignee and keeps the calculation, for any member', async () => {
    const a = world().companies.a
    for (const user of ['readOnly', 'owner'] as const) {
      const event = await unwrap(apiAs(user, 'a').GET(detailPath, { params: { path: { eventId } } }))
      expect(event).toMatchObject({
        id: eventId,
        propertyName: a.properties.find((p) => p.id === lease.propertyId)!.name,
        unitNumber: a.units.find((u) => u.id === lease.unitId)!.unitNumber,
        tenantName: a.tenants.find((t) => t.id === lease.tenantId)!.tradingName,
        assigneeName: world().users.manager.fullName,
        leaseId: lease.id,
        calculation: CALCULATION,
      })
    }
  })

  it("is not found from another company's workspace", async () => {
    const error = await apiErrorOf(unwrap(apiAs('manager', 'b').GET(detailPath, { params: { path: { eventId } } })))
    expect(error.status).toBe(404)
  })
})

describe('monitoring event workflow and history', () => {
  it('walks the domain workflow to a dismissal, recording each move and its note in the history', async () => {
    const moves = [
      { status: 'under_review', note: 'Integration: asked the accountant for the ledger' },
      { status: 'action_required' },
      { status: 'in_progress', note: 'Integration: correction requested' },
    ] as const
    let current: MonitoringEventStatus = 'new'
    for (const move of moves) {
      expect(nextEventStatuses(current)).toContain(move.status)
      const moved = await unwrap(apiAs('manager', 'a').PATCH(statusPath, { params: { path: { eventId } }, body: move }))
      expect(moved.status).toBe(move.status)
      // The move answers with the event as the detail shows it, names included.
      expect(moved.tenantName).toBeDefined()
      current = move.status
    }

    const dismissed = await unwrap(
      apiAs('manager', 'a').PATCH(statusPath, {
        params: { path: { eventId } },
        body: { status: 'dismissed', note: 'Integration: billed correctly under the addendum' },
      }),
    )
    expect(dismissed.dismissal).toMatchObject({ reason: 'Integration: billed correctly under the addendum', dismissedByUserId: world().users.manager.id })

    const page = await history()
    expect(page.total).toBe(4)
    expect(page.items.every((entry) => entry.actorUserId === world().users.manager.id)).toBe(true)
    const byTarget = new Map(page.items.map((entry) => [entry.changes?.find((c) => c.field === 'status')?.after, entry]))
    expect(byTarget.get('under_review')?.changes).toContainEqual({ field: 'resolution_notes', before: null, after: 'Integration: asked the accountant for the ledger' })
    expect(byTarget.get('action_required')?.changes).toEqual([{ field: 'status', before: 'under_review', after: 'action_required' }])
    expect(byTarget.get('dismissed')).toMatchObject({ action: 'dismiss' })
    expect(byTarget.get('dismissed')?.changes).toContainEqual({ field: 'dismissal_reason', before: null, after: 'Integration: billed correctly under the addendum' })
  })

  it('never moves a dismissed event again (409)', async () => {
    expect(nextEventStatuses('dismissed')).toEqual([])
    const error = await apiErrorOf(
      unwrap(apiAs('manager', 'a').PATCH(statusPath, { params: { path: { eventId } }, body: { status: 'resolved' } })),
    )
    expect(error.status).toBe(409)
  })

  it('shows the history to read-only members but not to property owners (403)', async () => {
    expect((await history('readOnly')).total).toBe(4)
    const error = await apiErrorOf(
      unwrap(apiAs('owner', 'a').GET('/api/v1/audit-logs', { params: { query: { entityType: 'monitoring_event', entityId: eventId } } })),
    )
    expect(error.status).toBe(403)
  })
})
