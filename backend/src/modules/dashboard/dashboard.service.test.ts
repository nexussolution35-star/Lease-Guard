import type { StatementArrearsSummary } from '@leaseguard/domain'
import { describe, expect, it, vi } from 'vitest'

import { callsTo, fakeDb, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { StatementArrearsService } from '../statements/statement-arrears.service'
import { DashboardService } from './dashboard.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-0000000000c1'
const NOW = new Date('2026-11-21T08:00:00+02:00')

const ARREARS: StatementArrearsSummary = {
  asOf: '2026-11-21',
  ageingBuckets: [30, 60, 90, 120],
  totalOutstanding: 16_500.5,
  tenantsInArrears: 2,
  tenantsUnderArrangement: 1,
  pendingReview: 3,
  buckets: [],
  entries: [],
}

function arrearsService(summary: StatementArrearsSummary = ARREARS) {
  const service = { summary: vi.fn().mockResolvedValue(summary) }
  return service as typeof service & StatementArrearsService
}

const eqValue = (query: RecordedQuery, column: string) => callsTo(query, 'eq').find(([name]) => name === column)?.[1]

/** Answers each head count with a figure keyed by what it filters on, so a figure can only come from its own query. */
function counts(query: RecordedQuery) {
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
  it('returns every PRD §7.1 figure, each from its own query, with the arrears figures from the statements summary', async () => {
    const arrears = arrearsService()
    const { client, queries } = fakeDb(counts)

    const summary = await new DashboardService(arrears).summary(client, COMPANY, NOW)

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
    expect(arrears.summary).toHaveBeenCalledWith(client, COMPANY, NOW)
    // Every query is scoped to the company and head-only: no rows travel for a count.
    for (const query of queries) {
      expect(eqValue(query, 'company_id')).toBe(COMPANY)
      expect(callsTo(query, 'select')[0]?.[1]).toEqual({ count: 'exact', head: true })
    }
  })

  it('leaves archived properties and their units out', async () => {
    const { client, queries } = fakeDb(counts)
    await new DashboardService(arrearsService()).summary(client, COMPANY, NOW)

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
    await new DashboardService(arrearsService()).summary(client, COMPANY, NOW)

    const events = queries.filter((query) => query.table === 'monitoring_events')
    expect(events).toHaveLength(4)
    for (const query of events) {
      expect(callsTo(query, 'in')).toEqual([['status', ['new', 'under_review', 'action_required', 'in_progress']]])
    }
  })

  it('turns a database failure into an API error instead of a zero', async () => {
    const { client } = fakeDb((query) =>
      query.table === 'leases' ? { data: null, error: { code: '42501', message: 'permission denied' }, count: null } : counts(query),
    )
    await expect(new DashboardService(arrearsService()).summary(client, COMPANY, NOW)).rejects.toMatchObject({ status: expect.any(Number) })
  })
})
