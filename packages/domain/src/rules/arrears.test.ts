import { describe, expect, it } from 'vitest'
import { makeStatement } from './__fixtures__/lease.js'
import {
  ageArrears,
  ageingBucket,
  ageingBucketLabels,
  ageingSummary,
  arrearsByTenant,
  describeAgeingBucket,
  tenantCount,
  tenantsInArrears,
  totalOutstanding,
} from './arrears.js'

const today = '2026-11-06'

describe('ageingBucket', () => {
  it('uses default 30/60/90/120 buckets', () => {
    expect(ageingBucket('2026-11-06', today)).toBe('current')
    expect(ageingBucket('2026-10-08', today)).toBe('current') // 29
    expect(ageingBucket('2026-10-07', today)).toBe('30') // 30
    expect(ageingBucket('2026-09-07', today)).toBe('60') // 60
    expect(ageingBucket('2026-08-08', today)).toBe('90') // 90
    expect(ageingBucket('2026-07-09', today)).toBe('120+') // 120
    expect(ageingBucket('2025-01-01', today)).toBe('120+')
  })
  it('supports custom buckets', () => {
    expect(ageingBucket('2026-10-20', today, [7, 14])).toBe('14+')
    expect(ageingBucketLabels([7, 14])).toEqual(['current', '7', '14+'])
  })
})

describe('ageArrears', () => {
  const statements = [
    makeStatement({ id: 's1', tenantId: 't1', statementDate: '2026-09-01', closingBalance: 12000 }),
    makeStatement({ id: 's2', tenantId: 't1', statementDate: '2026-10-01', closingBalance: 8000 }), // latest for t1
    makeStatement({ id: 's3', tenantId: 't2', statementDate: '2026-10-01', closingBalance: 50000, status: 'review_required' }), // ignored
    makeStatement({ id: 's4', tenantId: 't2', statementDate: '2026-07-01', closingBalance: 20000 }),
    makeStatement({ id: 's5', tenantId: 't3', statementDate: '2026-10-01', closingBalance: 0 }), // not in arrears
    makeStatement({ id: 's6', tenantId: 't4', statementDate: '2026-10-01', closingBalance: undefined, totalDue: 1500.555 }),
    makeStatement({ id: 's7', tenantId: undefined, statementDate: '2026-10-01', closingBalance: 999 }), // unmatched
    makeStatement({ id: 's8', tenantId: 't5', statementDate: undefined, closingBalance: 999 }), // undated: never aged from a guess
  ]
  it('uses latest verified statement per tenant', () => {
    const result = ageArrears(statements, today)
    expect(result.map((r) => r.tenantId)).toEqual(['t2', 't1', 't4'])
    expect(result.find((r) => r.tenantId === 't1')).toMatchObject({ statementId: 's2', outstanding: 8000, ageDays: 36, bucket: '30' })
    expect(result.find((r) => r.tenantId === 't2')).toMatchObject({ statementId: 's4', outstanding: 20000, bucket: '120+' })
    expect(result.find((r) => r.tenantId === 't4')?.outstanding).toBe(1500.56)
  })
  it('keeps the latest verified statement of each lease of a tenant and totals across them', () => {
    const twoLeases = [
      makeStatement({ id: 'a-old', tenantId: 't1', leaseId: 'lease-a', statementDate: '2026-09-01', closingBalance: 12000 }),
      makeStatement({ id: 'a-new', tenantId: 't1', leaseId: 'lease-a', statementDate: '2026-10-01', closingBalance: 8000 }),
      // An older statement of the tenant's other lease still counts: it is that lease's latest.
      makeStatement({ id: 'b', tenantId: 't1', leaseId: 'lease-b', statementDate: '2026-08-01', closingBalance: 4000 }),
      makeStatement({ id: 'c', tenantId: 't2', leaseId: 'lease-c', statementDate: '2026-10-01', closingBalance: 5000 }),
    ]
    const result = ageArrears(twoLeases, today)
    expect(result.map((r) => r.statementId)).toEqual(['a-new', 'c', 'b'])
    expect(totalOutstanding(result)).toBe(17000)
    expect(tenantCount(result)).toBe(2)
    expect(arrearsByTenant(result)).toEqual([
      { tenantId: 't1', outstanding: 12000, entries: [expect.objectContaining({ statementId: 'a-new' }), expect.objectContaining({ statementId: 'b' })] },
      { tenantId: 't2', outstanding: 5000, entries: [expect.objectContaining({ statementId: 'c' })] },
    ])
    // The threshold applies to what the tenant owes across leases: R 8 000 + R 4 000 reaches R 10 000.
    expect(tenantsInArrears(result, 10_000).map((r) => r.statementId)).toEqual(['a-new', 'b'])
  })
  it('supersedes a renewed lease by the next lease of the same unit, never counting the carried-forward balance twice', () => {
    const renewed = [
      // The replaced lease's last statement; its balance is carried into the renewal's first statement.
      makeStatement({ id: 'old-lease', tenantId: 't1', unitId: 'u1', leaseId: 'lease-1', statementDate: '2026-08-01', closingBalance: 6000 }),
      makeStatement({ id: 'renewal', tenantId: 't1', unitId: 'u1', leaseId: 'lease-2', statementDate: '2026-10-01', closingBalance: 9000 }),
      // A second unit is a separate account and still counts.
      makeStatement({ id: 'other-unit', tenantId: 't1', unitId: 'u2', leaseId: 'lease-3', statementDate: '2026-09-01', closingBalance: 1000 }),
    ]
    const result = ageArrears(renewed, today)
    expect(result.map((r) => r.statementId)).toEqual(['renewal', 'other-unit'])
    expect(totalOutstanding(result)).toBe(10000)
  })
  it('totals and thresholds', () => {
    const result = ageArrears(statements, today)
    expect(totalOutstanding(result)).toBe(29500.56)
    expect(tenantsInArrears(result, 5000).map((r) => r.tenantId)).toEqual(['t2', 't1'])
    expect(tenantsInArrears(result)).toHaveLength(3)
    expect(ageingSummary(result)).toEqual({ current: 0, '30': 9500.56, '60': 0, '90': 0, '120+': 20000 })
  })
})

describe('describeAgeingBucket', () => {
  it('puts each bucket of the default configuration in words', () => {
    expect(describeAgeingBucket('current')).toBe('0–29 days')
    expect(describeAgeingBucket('30')).toBe('30–59 days')
    expect(describeAgeingBucket('90')).toBe('90–119 days')
    expect(describeAgeingBucket('120+')).toBe('120 days or more')
  })
  it('follows a custom configuration', () => {
    expect(describeAgeingBucket('current', [60, 30])).toBe('0–29 days')
    expect(describeAgeingBucket('30', [30, 60])).toBe('30–59 days')
    expect(describeAgeingBucket('60+', [30, 60])).toBe('60 days or more')
  })
})
