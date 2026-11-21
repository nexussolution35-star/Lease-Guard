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

/**
 * The days a bucket covers, in words: with [30,60,90,120], 'current' is "0–29 days", '30' is "30–59 days" and '120+'
 * is "120 days or more".
 */
export function describeAgeingBucket(label: AgeingBucketLabel, buckets: readonly number[] = DEFAULT_AGEING_BUCKETS): string {
  const sorted = [...buckets].sort((a, b) => a - b)
  if (label === 'current') return sorted.length > 0 ? `0–${sorted[0] - 1} days` : 'Any age'
  const from = Number.parseInt(label, 10)
  const next = sorted.find((boundary) => boundary > from)
  return label.endsWith('+') || next === undefined ? `${from} days or more` : `${from}–${next - 1} days`
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
> &
  Partial<Pick<Statement, 'unitId'>>

/** Outstanding balance a VERIFIED statement reports; closingBalance preferred, then totalDue. */
export function statementOutstanding(statement: Pick<Statement, 'closingBalance' | 'totalDue'>): ZAR {
  return roundZar(statement.closingBalance ?? statement.totalDue ?? 0)
}

/**
 * Ageing per tenant and lease. Only VERIFIED statements are considered (unverified / review_required /
 * duplicate are ignored). A tenant with several leases (units) gets a statement per lease, so for each
 * account the LATEST verified statement (by statementDate) is authoritative, and a tenant owes the total across
 * its accounts (`arrearsByTenant`). An account is the tenant's unit (the lease when the unit is not given): a
 * renewal replaces the lease of the same unit and its statements carry the balance forward, so the replaced
 * lease's last statement is superseded rather than counted twice. Accounts whose latest balance is ≤ 0 are not in arrears and are
 * omitted. Balance is aged from that statement's date. A verified statement always has a date and a lease (the
 * database requires them); a statement without a date is ignored rather than aged from a guess.
 */
export function ageArrears(
  statements: readonly AgeableStatement[],
  today: ISODate,
  buckets: readonly number[] = DEFAULT_AGEING_BUCKETS,
): TenantArrears[] {
  const latest = new Map<string, AgeableStatement & { statementDate: ISODate }>()
  for (const s of statements) {
    if (s.status !== 'verified' || !s.tenantId || !s.statementDate) continue
    const account = `${s.tenantId}|${s.unitId ? `unit:${s.unitId}` : `lease:${s.leaseId ?? ''}`}`
    const prev = latest.get(account)
    if (!prev || compareISODate(s.statementDate, prev.statementDate) > 0) latest.set(account, { ...s, statementDate: s.statementDate })
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

/** One tenant's arrears: the total across its leases and the entry of each lease in arrears (largest first). */
export interface TenantArrearsTotal<E extends Pick<TenantArrears, 'tenantId' | 'outstanding'> = TenantArrears> {
  tenantId: EntityId
  outstanding: ZAR
  entries: E[]
}

/** Entries grouped by tenant, each with its total across leases; largest total first. */
export function arrearsByTenant<E extends Pick<TenantArrears, 'tenantId' | 'outstanding'>>(entries: readonly E[]): TenantArrearsTotal<E>[] {
  const byTenant = new Map<EntityId, E[]>()
  for (const entry of entries) byTenant.set(entry.tenantId, [...(byTenant.get(entry.tenantId) ?? []), entry])
  return [...byTenant.entries()]
    .map(([tenantId, own]) => ({
      tenantId,
      outstanding: totalOutstanding(own),
      entries: [...own].sort((a, b) => b.outstanding - a.outstanding),
    }))
    .sort((a, b) => b.outstanding - a.outstanding)
}

/** The number of distinct tenants among the entries. */
export function tenantCount(entries: readonly Pick<TenantArrears, 'tenantId'>[]): number {
  return new Set(entries.map((entry) => entry.tenantId)).size
}

/**
 * The entries of tenants whose total outstanding across their leases is ≥ `threshold` (strictly > 0 when threshold
 * is 0). The threshold applies to what the tenant owes, not to each lease on its own.
 */
export function tenantsInArrears(entries: readonly TenantArrears[], threshold: ZAR = 0): TenantArrears[] {
  const owing = new Set(
    arrearsByTenant(entries)
      .filter((tenant) => (threshold > 0 ? tenant.outstanding >= threshold : tenant.outstanding > 0))
      .map((tenant) => tenant.tenantId),
  )
  return entries.filter((entry) => owing.has(entry.tenantId))
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
