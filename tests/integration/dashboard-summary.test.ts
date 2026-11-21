import { unwrap } from '@leaseguard/api-client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, check, expectOk, serviceRole, world } from './support/clients.ts'

/**
 * The dashboard summary (ticket M7-05): every PRD §7.1 figure in one request, each equal to what the database holds for
 * the active company, counted the way its filtered list is. Two lease monitoring events are added to company A with the
 * service role (an open escalation discrepancy and a dismissed lease expiry) and removed in `afterAll`.
 */

const OPEN = ['new', 'under_review', 'action_required', 'in_progress']
const SA_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })

let lease: WorldLease
const eventIds: string[] = []

const summaryOf = (company: 'a' | 'b', user: 'manager' | 'readOnly' = 'manager') =>
  unwrap(apiAs(user, company).GET('/api/v1/dashboard/summary'))

async function countOf(what: string, request: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await request
  if (error) throw new Error(`${what} failed: ${error.message}`)
  return count ?? 0
}

/** The same figures straight from the database (service role, filtered to the company), to compare with. */
async function databaseFigures(db: SupabaseClient, companyId: string) {
  const head = { count: 'exact', head: true } as const
  const events = (type: string) =>
    countOf(type, db.from('monitoring_events').select('id', head).eq('company_id', companyId).eq('type', type).in('status', OPEN))
  const [properties, units, occupiedUnits, activeLeases, activeArrangements, pendingStatementReviews, pendingApprovals] = await Promise.all([
    countOf('properties', db.from('properties').select('id', head).eq('company_id', companyId).neq('status', 'archived')),
    countOf(
      'units',
      db.from('units').select('id, property:properties!units_property_fk!inner(status)', head).eq('company_id', companyId).neq('property.status', 'archived'),
    ),
    countOf(
      'occupied units',
      db
        .from('units')
        .select('id, property:properties!units_property_fk!inner(status)', head)
        .eq('company_id', companyId)
        .eq('occupancy_status', 'occupied')
        .neq('property.status', 'archived'),
    ),
    countOf('leases', db.from('leases').select('id', head).eq('company_id', companyId).eq('status', 'active')),
    countOf('arrangements', db.from('payment_arrangements').select('id', head).eq('company_id', companyId).eq('status', 'active')),
    countOf('statements', db.from('statements').select('id', head).eq('company_id', companyId).eq('status', 'review_required')),
    countOf('approvals', db.from('message_approvals').select('id', head).eq('company_id', companyId).eq('decision', 'pending')),
  ])
  return {
    properties,
    units,
    occupiedUnits,
    activeLeases,
    activeArrangements,
    pendingStatementReviews,
    pendingApprovals,
    escalationDiscrepancies: await events('rental_escalation_discrepancy'),
    upcomingExpiries: await events('lease_expiry'),
    renewalDeadlines: await events('renewal_notice_deadline'),
    expiringGuarantees: await events('guarantee_expiry'),
  }
}

beforeAll(async () => {
  const a = world().companies.a
  const candidate = a.leases.find((l) => l.status === 'active' && l.verified)
  if (!candidate) throw new Error('The world has no active verified lease in company A')
  lease = candidate
})

afterAll(async () => {
  if (eventIds.length > 0) expectOk(await serviceRole().from('monitoring_events').delete().in('id', eventIds), 'remove dashboard events')
})

describe('GET /api/v1/dashboard/summary', () => {
  it('returns every figure as the database holds it for the active company', async () => {
    const companyId = world().companies.a.id
    const summary = await summaryOf('a')
    const arrears = await unwrap(apiAs('manager', 'a').GET('/api/v1/statements/arrears'))

    expect(summary).toMatchObject(await databaseFigures(serviceRole(), companyId))
    // The balances are the Statements screen's own figures, so the two never disagree.
    expect(summary.asOf).toBe(SA_DATE.format(new Date()))
    expect(summary.totalOutstanding).toBe(arrears.totalOutstanding)
    expect(summary.tenantsInArrears).toBe(arrears.tenantsInArrears)
    expect(summary.pendingStatementReviews).toBe(arrears.pendingReview)
    // The world has a portfolio, so the figures are not all zero by accident.
    expect(summary.properties).toBeGreaterThan(0)
    expect(summary.units).toBeGreaterThan(0)
  })

  it('counts open lease monitoring events only', async () => {
    const before = await summaryOf('a')
    const a = world().companies.a
    const today = SA_DATE.format(new Date())
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
            title: `M7-05 ${world().runId}: escalation not applied`,
            description: 'October rental does not include the 8% escalation.',
            identified_on: today,
            priority: 'critical',
            recommended_action: 'Ask the accountant to correct the rental charge.',
            status: 'action_required',
          },
          {
            company_id: a.id,
            type: 'lease_expiry',
            property_id: lease.propertyId,
            unit_id: lease.unitId,
            tenant_id: lease.tenantId,
            lease_id: lease.id,
            lease_reference: lease.reference,
            title: `M7-05 ${world().runId}: lease expires`,
            description: 'The lease expires soon.',
            identified_on: today,
            priority: 'medium',
            recommended_action: 'Start the renewal conversation.',
            status: 'dismissed',
            dismissal_reason: 'Renewal already signed.',
            dismissed_by_user_id: world().users.manager.id,
            dismissed_at: new Date().toISOString(),
          },
        ])
        .select('id'),
      'insert dashboard events',
    )
    eventIds.push(...rows.map((row: { id: string }) => row.id))

    const after = await summaryOf('a')
    expect(after.escalationDiscrepancies).toBe(before.escalationDiscrepancies + 1)
    expect(after.upcomingExpiries).toBe(before.upcomingExpiries)
  })

  it('never counts another company, and every member may read it', async () => {
    const b = await summaryOf('b')
    expect(b).toMatchObject(await databaseFigures(serviceRole(), world().companies.b.id))

    const manager = await summaryOf('a')
    expect(await summaryOf('a', 'readOnly')).toEqual(manager)
    // A member of company A only cannot ask for company B's figures.
    expect((await apiErrorOf(summaryOf('b', 'readOnly'))).status).toBe(403)
  })

  it('requires the active company', async () => {
    const error = await apiErrorOf(unwrap(apiAs('manager').GET('/api/v1/dashboard/summary')))
    expect(error.status).toBe(400)
  })
})
