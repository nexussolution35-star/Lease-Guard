import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { StatementArrearsService } from './statement-arrears.service'
import { COMPANY, PROPERTY, TENANT, USER } from './statements.test-helpers'

const OTHER_TENANT = '6f1d2c1e-0000-4000-8000-0000000000ef'
const UNIT = '6f1d2c1e-0000-4000-8000-0000000000f1'
// 2026-11-21 in South Africa.
const NOW = new Date('2026-11-21T08:00:00+02:00')

function verified(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenant_id: TENANT,
    property_id: PROPERTY,
    unit_id: UNIT,
    lease_id: null,
    status: 'verified',
    statement_date: '2026-10-31',
    closing_balance: 12_000,
    total_due: null,
    verified_by_user_id: USER,
    verified_at: '2026-11-02T09:00:00+00:00',
    property: { name: 'Mall Square' },
    tenant: { trading_name: 'Book Nook' },
    unit: { unit_number: 'Shop 12' },
    ...overrides,
  }
}

const companyRow = {
  id: COMPANY,
  status: 'active',
  lease_expiry_notice_days: [180],
  renewal_deadline_warning_days: [30],
  guarantee_expiry_notice_days: [60],
  installment_reminder_lead_days: 3,
}

function respondWith(tables: { statements?: unknown[]; arrangements?: unknown[]; rules?: unknown[]; pendingReview?: number }) {
  return (query: RecordedQuery) => {
    if (query.table === 'statements') {
      // The pending-review count is the head-only query.
      if (callsTo(query, 'select')[0]?.[1]) return { data: null, error: null, count: tables.pendingReview ?? 0 }
      return { data: tables.statements ?? [], error: null }
    }
    if (query.table === 'payment_arrangements') return { data: tables.arrangements ?? [], error: null }
    if (query.table === 'companies') return { data: companyRow, error: null }
    if (query.table === 'monitoring_rules') return { data: tables.rules ?? [], error: null }
    throw new Error(`Unexpected table ${query.table}`)
  }
}

describe('StatementArrearsService', () => {
  const service = new StatementArrearsService()

  it('figures come from the latest verified statement per tenant, aged into the default buckets', async () => {
    const { client, queries } = fakeDb(
      respondWith({
        statements: [
          verified('s-old', { statement_date: '2026-09-30', closing_balance: 30_000 }),
          verified('s-new'),
          verified('s-other', { tenant_id: OTHER_TENANT, tenant: { trading_name: 'Café Uno' }, unit_id: null, unit: null, statement_date: '2026-07-15', closing_balance: null, total_due: 4_500.5 }),
        ],
        pendingReview: 3,
      }),
    )

    const summary = await service.summary(client, COMPANY, NOW)

    expect(summary).toMatchObject({ asOf: '2026-11-21', ageingBuckets: [30, 60, 90, 120], totalOutstanding: 16_500.5, tenantsInArrears: 2, pendingReview: 3 })
    expect(summary.buckets.map((b) => [b.bucket, b.outstanding, b.tenantCount])).toEqual([
      ['current', 12_000, 1],
      ['30', 0, 0],
      ['60', 0, 0],
      ['90', 0, 0],
      ['120+', 4_500.5, 1],
    ])
    expect(summary.entries[0]).toEqual({
      tenantId: TENANT,
      tenantName: 'Book Nook',
      propertyId: PROPERTY,
      propertyName: 'Mall Square',
      unitId: UNIT,
      unitNumber: 'Shop 12',
      statementId: 's-new',
      statementDate: '2026-10-31',
      outstanding: 12_000,
      ageDays: 21,
      bucket: 'current',
      underArrangement: false,
      remindersSuppressed: false,
      verifiedByUserId: USER,
      verifiedAt: '2026-11-02T09:00:00+00:00',
    })
    expect(summary.entries[1]).toMatchObject({ statementId: 's-other', tenantName: 'Café Uno', bucket: '120+' })
    expect(summary.entries[1]).not.toHaveProperty('unitNumber')

    // Verified statements only, one company, matched to a tenant.
    const [statements] = queries
    expect(callsTo(statements!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['status', 'verified'],
    ])
    expect(callsTo(statements!, 'not')).toEqual([['tenant_id', 'is', null]])
    for (const query of queries) {
      const column = query.table === 'companies' ? 'id' : 'company_id'
      expect(callsTo(query, 'eq')[0]).toEqual([column, COMPANY])
    }
    const pending = queries.find((q) => q.table === 'statements' && callsTo(q, 'select')[0]?.[1])
    expect(callsTo(pending!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['status', 'review_required'],
    ])
  })

  it('totals the latest verified statement of every lease of a tenant, counting the tenant once', async () => {
    const LEASE_A = '6f1d2c1e-0000-4000-8000-0000000000a1'
    const LEASE_B = '6f1d2c1e-0000-4000-8000-0000000000b1'
    const UNIT_B = '6f1d2c1e-0000-4000-8000-0000000000f2'
    const { client } = fakeDb(
      respondWith({
        statements: [
          verified('a-old', { lease_id: LEASE_A, statement_date: '2026-09-30', closing_balance: 30_000 }),
          verified('a-new', { lease_id: LEASE_A }),
          // The tenant's other unit: its own latest statement counts too, however old.
          verified('b', { lease_id: LEASE_B, unit_id: UNIT_B, unit: { unit_number: 'Shop 14' }, statement_date: '2026-08-31', closing_balance: 3_000 }),
        ],
      }),
    )
    const summary = await service.summary(client, COMPANY, NOW)
    expect(summary).toMatchObject({ totalOutstanding: 15_000, tenantsInArrears: 1 })
    expect(summary.entries.map((e) => [e.statementId, e.leaseId, e.unitNumber, e.outstanding])).toEqual([
      ['a-new', LEASE_A, 'Shop 12', 12_000],
      ['b', LEASE_B, 'Shop 14', 3_000],
    ])
    expect(summary.buckets.find((b) => b.bucket === '60')).toMatchObject({ outstanding: 3_000, tenantCount: 1 })
  })

  it("ages with the company's arrears monitoring buckets", async () => {
    const { client } = fakeDb(
      respondWith({
        statements: [verified('s-new', { statement_date: '2026-11-01' })],
        rules: [{ id: 'r1', event_type: 'arrears', enabled: true, default_priority: 'medium', config: { kind: 'arrears', minimumBalanceRands: 0, ageingBucketsDays: [14, 45] }, default_assignee_user_id: null }],
      }),
    )
    const summary = await service.summary(client, COMPANY, NOW)
    expect(summary.ageingBuckets).toEqual([14, 45])
    expect(summary.buckets.map((b) => [b.bucket, b.description, b.outstanding])).toEqual([
      ['current', '0–13 days', 0],
      ['14', '14–44 days', 12_000],
      ['45+', '45 days or more', 0],
    ])
  })

  it('marks a tenant under an active payment arrangement and keeps counting the balance', async () => {
    const { client, queries } = fakeDb(
      respondWith({
        statements: [verified('s-new')],
        arrangements: [{ id: 'a1', tenant_id: TENANT, status: 'active', agreed_on: '2026-11-05', closed_on: null, suppress_arrears_reminders: true }],
      }),
    )
    const summary = await service.summary(client, COMPANY, NOW)
    expect(summary.entries[0]).toMatchObject({ underArrangement: true, remindersSuppressed: true })
    expect(summary).toMatchObject({ tenantsUnderArrangement: 1, totalOutstanding: 12_000 })
    expect(callsTo(queries.find((q) => q.table === 'payment_arrangements')!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['status', 'active'],
    ])
  })

  it('is empty, with every bucket at zero, when nothing is verified', async () => {
    const { client } = fakeDb(respondWith({ pendingReview: 2 }))
    const summary = await service.summary(client, COMPANY, NOW)
    expect(summary).toMatchObject({ totalOutstanding: 0, tenantsInArrears: 0, tenantsUnderArrangement: 0, pendingReview: 2, entries: [] })
    expect(summary.buckets).toHaveLength(5)
  })
})
