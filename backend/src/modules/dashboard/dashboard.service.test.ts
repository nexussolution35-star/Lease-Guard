import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, rpcArgs, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { DashboardService } from './dashboard.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-0000000000c1'
const NOW = new Date('2026-11-21T08:00:00+02:00')

const ARREARS_RPC = 'rpc:dashboard_arrears_totals'
/** What `dashboard_arrears_totals` answers: one row (PostgREST sends numeric as a JSON number). */
const ARREARS_ROW = { total_outstanding: 16_500.5, tenants_in_arrears: 2, pending_review: 3 }

const eqValue = (query: RecordedQuery, column: string) => callsTo(query, 'eq').find(([name]) => name === column)?.[1]

/** Answers each head count with a figure keyed by what it filters on, so a figure can only come from its own query. */
function counts(query: RecordedQuery) {
  if (query.table === ARREARS_RPC) return { data: ARREARS_ROW, error: null }
  const key = [query.table, eqValue(query, 'status'), eqValue(query, 'occupancy_status'), eqValue(query, 'decision'), eqValue(query, 'type')]
    .filter(Boolean)
    .join(':')
  const figures: Record<string, number> = {
    properties: 4,
    units: 30,
    'units:occupied': 21,
    'leases:active': 19,
    'payment_arrangements:active': 2,
    'message_approvals:pending': 5,
    'monitoring_events:rental_escalation_discrepancy': 1,
    'monitoring_events:lease_expiry': 6,
    'monitoring_events:renewal_notice_deadline': 7,
    'monitoring_events:guarantee_expiry': 8,
  }
  const count = figures[key]
  if (count === undefined) throw new Error(`Unexpected count ${key}`)
  return { data: null, error: null, count }
}

describe('DashboardService', () => {
  it('returns every PRD §7.1 figure, each from its own query, with the arrears figures from one database total', async () => {
    const { client, queries } = fakeDb(counts)

    const summary = await new DashboardService().summary(client, COMPANY, NOW)

    expect(summary).toEqual({
      asOf: '2026-11-21',
      properties: 4,
      units: 30,
      occupiedUnits: 21,
      activeLeases: 19,
      totalOutstanding: 16_500.5,
      tenantsInArrears: 2,
      activeArrangements: 2,
      escalationDiscrepancies: 1,
      upcomingExpiries: 6,
      renewalDeadlines: 7,
      expiringGuarantees: 8,
      pendingStatementReviews: 3,
      pendingApprovals: 5,
    })
    // The balances are one call for the company; no statement rows are loaded.
    const arrears = queries.filter((query) => query.table === ARREARS_RPC)
    expect(arrears).toHaveLength(1)
    expect(rpcArgs(arrears[0]!)).toEqual({ p_company_id: COMPANY })
    expect(callsTo(arrears[0]!, 'single')).toHaveLength(1)
    expect(queries.some((query) => query.table === 'statements')).toBe(false)
    // Every other query is scoped to the company and head-only: no rows travel for a count.
    for (const query of queries.filter((candidate) => candidate !== arrears[0])) {
      expect(eqValue(query, 'company_id')).toBe(COMPANY)
      expect(callsTo(query, 'select')[0]?.[1]).toEqual({ count: 'exact', head: true })
    }
  })

  it('leaves archived properties and their units out', async () => {
    const { client, queries } = fakeDb(counts)
    await new DashboardService().summary(client, COMPANY, NOW)

    const properties = queries.find((query) => query.table === 'properties')!
    expect(callsTo(properties, 'neq')).toEqual([['status', 'archived']])
    const units = queries.filter((query) => query.table === 'units')
    expect(units).toHaveLength(2)
    for (const query of units) {
      expect(String(callsTo(query, 'select')[0]?.[0])).toContain('!inner')
      expect(callsTo(query, 'neq')).toEqual([['property.status', 'archived']])
    }
  })

  it('counts only open monitoring events', async () => {
    const { client, queries } = fakeDb(counts)
    await new DashboardService().summary(client, COMPANY, NOW)

    const events = queries.filter((query) => query.table === 'monitoring_events')
    expect(events).toHaveLength(4)
    for (const query of events) {
      expect(callsTo(query, 'in')).toEqual([['status', ['new', 'under_review', 'action_required', 'in_progress']]])
    }
  })

  it('dates the figures by the South African day', async () => {
    const { client } = fakeDb(counts)
    // 22:30 UTC on 20 Nov is already 21 Nov in South Africa.
    expect((await new DashboardService().summary(client, COMPANY, new Date('2026-11-20T22:30:00Z'))).asOf).toBe('2026-11-21')
  })

  it('turns a failed arrears total into an API error instead of a zero', async () => {
    const { client } = fakeDb((query) =>
      query.table === ARREARS_RPC ? { data: null, error: { code: '42501', message: 'not a member' } } : counts(query),
    )
    await expect(new DashboardService().summary(client, COMPANY, NOW)).rejects.toMatchObject({ status: 403 })
  })

  it('turns a database failure into an API error instead of a zero', async () => {
    const { client } = fakeDb((query) =>
      query.table === 'leases' ? { data: null, error: { code: '42501', message: 'permission denied' }, count: null } : counts(query),
    )
    await expect(new DashboardService().summary(client, COMPANY, NOW)).rejects.toMatchObject({ status: expect.any(Number) })
  })
})
