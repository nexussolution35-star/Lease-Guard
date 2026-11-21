import type { ISODate, PaymentArrangement, Statement, ZAR } from '../types/index.js'
import { activeArrangementsForTenant, shouldSuppressArrearsReminder } from './arrangements.js'
import {
  ageArrears,
  ageingBucketLabels,
  ageingSummary,
  DEFAULT_AGEING_BUCKETS,
  describeAgeingBucket,
  totalOutstanding,
  type AgeingBucketLabel,
  type TenantArrears,
} from './arrears.js'

/** What the overview reads from a statement (only VERIFIED ones count; the others are ignored). */
export type ArrearsOverviewStatement = Pick<
  Statement,
  'id' | 'tenantId' | 'propertyId' | 'leaseId' | 'status' | 'statementDate' | 'closingBalance' | 'totalDue'
>

/** What the overview reads from a payment arrangement. */
export type ArrearsOverviewArrangement = Pick<PaymentArrangement, 'tenantId' | 'status' | 'agreedOn' | 'closedOn' | 'suppressArrearsReminders'>

/** One tenant in arrears: their latest verified statement's balance, aged, and whether an arrangement is in force. */
export interface ArrearsOverviewEntry extends TenantArrears {
  /** An active payment arrangement is in force for the tenant on `asOf`. */
  underArrangement: boolean
  /** That arrangement pauses the tenant's normal arrears reminders. */
  remindersSuppressed: boolean
}

/** The outstanding amount in one ageing bucket. Every bucket of the configuration is listed, zero when empty. */
export interface ArrearsOverviewBucket {
  bucket: AgeingBucketLabel
  /** The days the bucket covers, in words ("30–59 days"). */
  description: string
  outstanding: ZAR
  tenantCount: number
}

export interface ArrearsOverview {
  asOf: ISODate
  /** The ageing bucket boundaries in days (the company's arrears monitoring configuration). */
  ageingBuckets: number[]
  totalOutstanding: ZAR
  tenantsInArrears: number
  tenantsUnderArrangement: number
  buckets: ArrearsOverviewBucket[]
  /** Largest balance first. */
  entries: ArrearsOverviewEntry[]
}

/**
 * What a company's verified statements say it is owed on `asOf`. Only each tenant's LATEST verified statement counts
 * (domain `ageArrears`): unverified, rejected and duplicate statements never do, and a tenant whose latest balance is
 * zero or in credit is not in arrears. Balances are aged from the statement date into the configured buckets. A tenant
 * under an active payment arrangement is still in arrears (the balance is owed) and is marked as such.
 */
export function arrearsOverview(input: {
  statements: readonly ArrearsOverviewStatement[]
  arrangements: readonly ArrearsOverviewArrangement[]
  asOf: ISODate
  buckets?: readonly number[]
}): ArrearsOverview {
  const { asOf } = input
  const buckets = [...(input.buckets ?? DEFAULT_AGEING_BUCKETS)].sort((a, b) => a - b)
  const entries = ageArrears(input.statements, asOf, buckets).map(
    (entry): ArrearsOverviewEntry => ({
      ...entry,
      underArrangement: activeArrangementsForTenant(entry.tenantId, input.arrangements, asOf).length > 0,
      remindersSuppressed: shouldSuppressArrearsReminder(entry.tenantId, input.arrangements, asOf),
    }),
  )
  const amounts = ageingSummary(entries, buckets)
  const counts = new Map<AgeingBucketLabel, number>()
  for (const entry of entries) counts.set(entry.bucket, (counts.get(entry.bucket) ?? 0) + 1)
  return {
    asOf,
    ageingBuckets: buckets,
    totalOutstanding: totalOutstanding(entries),
    tenantsInArrears: entries.length,
    tenantsUnderArrangement: entries.filter((entry) => entry.underArrangement).length,
    buckets: ageingBucketLabels(buckets).map((bucket) => ({
      bucket,
      description: describeAgeingBucket(bucket, buckets),
      outstanding: amounts[bucket] ?? 0,
      tenantCount: counts.get(bucket) ?? 0,
    })),
    entries,
  }
}


/** A tenant in arrears as `GET /api/v1/statements/arrears` returns it: the overview entry with the names it shows. */
export interface StatementArrearsEntry extends ArrearsOverviewEntry {
  tenantName: string
  propertyName: string
  unitId?: string
  unitNumber?: string
  /** Who verified the statement the balance comes from, and when. */
  verifiedByUserId?: string
  verifiedAt?: string
}

/** The Statements page's arrears figures (`GET /api/v1/statements/arrears`). */
export interface StatementArrearsSummary extends Omit<ArrearsOverview, 'entries'> {
  /** Statements waiting for a person to review them (status `review_required`); none of them count above. */
  pendingReview: number
  entries: StatementArrearsEntry[]
}

/** True for an ageing bucket label: `'current'`, a boundary in days (`'30'`) or the open-ended last one (`'120+'`). */
export function isAgeingBucketLabel(value: string): value is AgeingBucketLabel {
  return value === 'current' || /^[1-9]\d*\+?$/.test(value)
}
