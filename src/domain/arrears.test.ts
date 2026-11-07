import { describe, expect, it } from 'vitest'
import { makeStatement } from './__fixtures__/lease'
import { ageArrears, ageingBucket, ageingBucketLabels, ageingSummary, tenantsInArrears, totalOutstanding } from './arrears'

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
  ]
  it('uses latest verified statement per tenant', () => {
    const result = ageArrears(statements, today)
    expect(result.map((r) => r.tenantId)).toEqual(['t2', 't1', 't4'])
    expect(result.find((r) => r.tenantId === 't1')).toMatchObject({ statementId: 's2', outstanding: 8000, ageDays: 36, bucket: '30' })
    expect(result.find((r) => r.tenantId === 't2')).toMatchObject({ statementId: 's4', outstanding: 20000, bucket: '120+' })
    expect(result.find((r) => r.tenantId === 't4')?.outstanding).toBe(1500.56)
  })
  it('totals and thresholds', () => {
    const result = ageArrears(statements, today)
    expect(totalOutstanding(result)).toBe(29500.56)
    expect(tenantsInArrears(result, 5000).map((r) => r.tenantId)).toEqual(['t2', 't1'])
    expect(tenantsInArrears(result)).toHaveLength(3)
    expect(ageingSummary(result)).toEqual({ current: 0, '30': 9500.56, '60': 0, '90': 0, '120+': 20000 })
  })
})
