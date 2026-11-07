import type { EntityId, ISODate, Statement, ZAR } from '../types/index.js'
import { compareISODate, daysBetween } from './dates.js'
import { roundZar, sumZar } from './money.js'

export const DEFAULT_AGEING_BUCKETS: readonly number[] = [30, 60, 90, 120]

/** `'current'`, then one label per bucket boundary; the last boundary is open-ended (`'120+'`). */
export type AgeingBucketLabel = 'current' | `${number}` | `${number}+`

/** Labels for a bucket configuration, in ageing order. */
export function ageingBucketLabels(buckets: readonly number[] = DEFAULT_AGEING_BUCKETS): AgeingBucketLabel[] {
  const sorted = [...buckets].sort((a, b) => a - b)
  return ['current', ...sorted.map((b, i): AgeingBucketLabel => (i === sorted.length - 1 ? `${b}+` : `${b}`))]
}

/**
 * Age a balance by the days elapsed since `date` (statement date or due date) up to `today`.
 * days < first bucket → 'current'; otherwise the largest boundary ≤ days, the last one as `N+`.
 * With [30,60,90,120]: 0–29 current, 30–59 '30', 60–89 '60', 90–119 '90', ≥120 '120+'.
 */
export function ageingBucket(
  date: ISODate,
  today: ISODate,
  buckets: readonly number[] = DEFAULT_AGEING_BUCKETS,
): AgeingBucketLabel {
  const days = daysBetween(date, today)
  const sorted = [...buckets].sort((a, b) => a - b)
  let label: AgeingBucketLabel = 'current'
  for (let i = 0; i < sorted.length; i++) {
    if (days >= sorted[i]) label = i === sorted.length - 1 ? `${sorted[i]}+` : `${sorted[i]}`
  }
  return label
}

export interface TenantArrears {
  tenantId: EntityId
  propertyId: EntityId
  leaseId?: EntityId
  statementId: EntityId
  statementDate: ISODate
  outstanding: ZAR
  ageDays: number
  bucket: AgeingBucketLabel
}

type AgeableStatement = Pick<
  Statement,
  'id' | 'tenantId' | 'propertyId' | 'leaseId' | 'status' | 'statementDate' | 'closingBalance' | 'totalDue'
>

/** Outstanding balance a VERIFIED statement reports; closingBalance preferred, then totalDue. */
export function statementOutstanding(statement: Pick<Statement, 'closingBalance' | 'totalDue'>): ZAR {
  return roundZar(statement.closingBalance ?? statement.totalDue ?? 0)
}

/**
 * Per-tenant ageing. Only VERIFIED statements are considered (unverified / review_required /
 * duplicate are ignored). For each tenant the LATEST verified statement (by statementDate)
 * is authoritative; tenants whose latest balance is ≤ 0 are not in arrears and are omitted.
 * Balance is aged from that statement's date.
 */
export function ageArrears(
  statements: readonly AgeableStatement[],
  today: ISODate,
  buckets: readonly number[] = DEFAULT_AGEING_BUCKETS,
): TenantArrears[] {
  const latest = new Map<EntityId, AgeableStatement>()
  for (const s of statements) {
    if (s.status !== 'verified' || !s.tenantId) continue
    const prev = latest.get(s.tenantId)
    if (!prev || compareISODate(s.statementDate, prev.statementDate) > 0) latest.set(s.tenantId, s)
  }
  const out: TenantArrears[] = []
  for (const s of latest.values()) {
    const outstanding = statementOutstanding(s)
    if (outstanding <= 0) continue
    out.push({
      tenantId: s.tenantId as EntityId,
      propertyId: s.propertyId,
      leaseId: s.leaseId,
      statementId: s.id,
      statementDate: s.statementDate,
      outstanding,
      ageDays: daysBetween(s.statementDate, today),
      bucket: ageingBucket(s.statementDate, today, buckets),
    })
  }
  return out.sort((a, b) => b.outstanding - a.outstanding)
}

export function totalOutstanding(entries: readonly Pick<TenantArrears, 'outstanding'>[]): ZAR {
  return sumZar(entries.map((e) => e.outstanding))
}

/** Entries whose outstanding balance is ≥ `threshold` (strictly > 0 when threshold is 0). */
export function tenantsInArrears(entries: readonly TenantArrears[], threshold: ZAR = 0): TenantArrears[] {
  return entries.filter((e) => (threshold > 0 ? e.outstanding >= threshold : e.outstanding > 0))
}

/** Totals per bucket label (every label present, zero when empty). */
export function ageingSummary(
  entries: readonly Pick<TenantArrears, 'outstanding' | 'bucket'>[],
  buckets: readonly number[] = DEFAULT_AGEING_BUCKETS,
): Record<AgeingBucketLabel, ZAR> {
  const summary: Record<AgeingBucketLabel, ZAR> = {} as Record<AgeingBucketLabel, ZAR>
  for (const label of ageingBucketLabels(buckets)) summary[label] = 0
  for (const e of entries) summary[e.bucket] = roundZar((summary[e.bucket] ?? 0) + e.outstanding)
  return summary
}
