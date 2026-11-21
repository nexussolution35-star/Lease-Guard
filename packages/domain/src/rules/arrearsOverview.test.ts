import { describe, expect, it } from 'vitest'
import { makeStatement } from './__fixtures__/lease.js'
import { arrearsOverview, isAgeingBucketLabel, type ArrearsOverviewArrangement } from './arrearsOverview.js'

const asOf = '2026-11-06'

const statements = [
  makeStatement({ id: 's1', tenantId: 't1', statementDate: '2026-09-01', closingBalance: 12000 }),
  makeStatement({ id: 's2', tenantId: 't1', statementDate: '2026-10-01', closingBalance: 8000 }), // latest for t1: 36 days
  makeStatement({ id: 's3', tenantId: 't2', statementDate: '2026-11-01', closingBalance: 50000, status: 'review_required' }), // never counts
  makeStatement({ id: 's4', tenantId: 't2', statementDate: '2026-07-01', closingBalance: 20000 }), // 128 days
  makeStatement({ id: 's5', tenantId: 't3', statementDate: '2026-10-01', closingBalance: -500 }), // in credit
  makeStatement({ id: 's6', tenantId: 't4', statementDate: '2026-11-01', closingBalance: 1500.25 }), // current
  makeStatement({ id: 's7', tenantId: 't5', statementDate: '2026-10-01', closingBalance: 999, status: 'rejected' }),
]

const arrangement = (over: Partial<ArrearsOverviewArrangement>): ArrearsOverviewArrangement => ({
  tenantId: 't2',
  status: 'active',
  agreedOn: '2026-10-01',
  suppressArrearsReminders: true,
  ...over,
})

describe('arrearsOverview', () => {
  it('totals and ages only each tenant’s latest verified statement', () => {
    const overview = arrearsOverview({ statements, arrangements: [], asOf })
    expect(overview.totalOutstanding).toBe(29500.25)
    expect(overview.tenantsInArrears).toBe(3)
    expect(overview.entries.map((e) => [e.tenantId, e.statementId, e.bucket])).toEqual([
      ['t2', 's4', '120+'],
      ['t1', 's2', '30'],
      ['t4', 's6', 'current'],
    ])
    expect(overview.buckets).toEqual([
      { bucket: 'current', description: '0–29 days', outstanding: 1500.25, tenantCount: 1 },
      { bucket: '30', description: '30–59 days', outstanding: 8000, tenantCount: 1 },
      { bucket: '60', description: '60–89 days', outstanding: 0, tenantCount: 0 },
      { bucket: '90', description: '90–119 days', outstanding: 0, tenantCount: 0 },
      { bucket: '120+', description: '120 days or more', outstanding: 20000, tenantCount: 1 },
    ])
    expect(overview.ageingBuckets).toEqual([30, 60, 90, 120])
  })

  it('counts every lease of a tenant once in the totals and the tenant once in the counts', () => {
    const overview = arrearsOverview({
      statements: [
        makeStatement({ id: 'a', tenantId: 't1', leaseId: 'lease-a', statementDate: '2026-10-01', closingBalance: 8000 }),
        makeStatement({ id: 'b', tenantId: 't1', leaseId: 'lease-b', statementDate: '2026-10-15', closingBalance: 2000 }),
        makeStatement({ id: 'c', tenantId: 't1', leaseId: 'lease-c', statementDate: '2026-11-01', closingBalance: 500 }),
      ],
      arrangements: [arrangement({ tenantId: 't1' })],
      asOf,
    })
    expect(overview.totalOutstanding).toBe(10500)
    expect(overview.tenantsInArrears).toBe(1)
    expect(overview.tenantsUnderArrangement).toBe(1)
    expect(overview.entries.map((e) => [e.statementId, e.underArrangement, e.remindersSuppressed])).toEqual([
      ['a', true, true],
      ['b', true, true],
      ['c', true, true],
    ])
    expect(overview.buckets.find((b) => b.bucket === 'current')).toMatchObject({ outstanding: 2500, tenantCount: 1 })
    expect(overview.buckets.find((b) => b.bucket === '30')).toMatchObject({ outstanding: 8000, tenantCount: 1 })
  })

  it('uses the company’s buckets, in ageing order whatever order they were given in', () => {
    const overview = arrearsOverview({ statements, arrangements: [], asOf, buckets: [60, 14] })
    expect(overview.ageingBuckets).toEqual([14, 60])
    expect(overview.buckets.map((b) => [b.bucket, b.outstanding])).toEqual([
      ['current', 1500.25],
      ['14', 8000],
      ['60+', 20000],
    ])
  })

  it('marks tenants under an active arrangement and whether it pauses reminders, still counting what they owe', () => {
    const overview = arrearsOverview({
      statements,
      asOf,
      arrangements: [
        arrangement({}),
        arrangement({ tenantId: 't1', suppressArrearsReminders: false }),
        arrangement({ tenantId: 't4', status: 'completed', closedOn: '2026-10-15' }),
        arrangement({ tenantId: 't4', agreedOn: '2026-12-01' }), // not in force yet
      ],
    })
    const byTenant = new Map(overview.entries.map((e) => [e.tenantId, e]))
    expect(byTenant.get('t2')).toMatchObject({ underArrangement: true, remindersSuppressed: true })
    expect(byTenant.get('t1')).toMatchObject({ underArrangement: true, remindersSuppressed: false })
    expect(byTenant.get('t4')).toMatchObject({ underArrangement: false, remindersSuppressed: false })
    expect(overview.tenantsUnderArrangement).toBe(2)
    expect(overview.totalOutstanding).toBe(29500.25)
  })

  it('is empty without verified statements', () => {
    const overview = arrearsOverview({ statements: [statements[2]!, statements[6]!], arrangements: [], asOf })
    expect(overview.totalOutstanding).toBe(0)
    expect(overview.tenantsInArrears).toBe(0)
    expect(overview.entries).toEqual([])
    expect(overview.buckets.every((b) => b.outstanding === 0 && b.tenantCount === 0)).toBe(true)
  })
})

describe('isAgeingBucketLabel', () => {
  it('accepts current, a boundary and the open-ended last boundary only', () => {
    expect(['current', '30', '120+'].every(isAgeingBucketLabel)).toBe(true)
    expect(['', 'Current', '0', '30 days', '+', '-30'].some(isAgeingBucketLabel)).toBe(false)
  })
})
