import type { ISODate, PaymentArrangement, Statement, ZAR } from '../types/index.js'
import { activeArrangementsForTenant, shouldSuppressArrearsReminder } from './arrangements.js'
import {
  ageArrears,
  ageingBucketLabels,
  ageingSummary,
  DEFAULT_AGEING_BUCKETS,
  describeAgeingBucket,
  tenantCount,
  totalOutstanding,
  type AgeingBucketLabel,
  type TenantArrears,
} from './arrears.js'

/** What the overview reads from a statement (only VERIFIED ones count; the others are ignored). */
export type ArrearsOverviewStatement = Pick<
  Statement,
  'id' | 'tenantId' | 'propertyId' | 'leaseId' | 'status' | 'statementDate' | 'closingBalance' | 'totalDue'
> &
  Partial<Pick<Statement, 'unitId'>>

/** What the overview reads from a payment arrangement. */
export type ArrearsOverviewArrangement = Pick<PaymentArrangement, 'tenantId' | 'status' | 'agreedOn' | 'closedOn' | 'suppressArrearsReminders'>

/**
 * One account in arrears: a tenant's latest verified statement for one lease, its balance aged, and whether an
 * arrangement is in force for the tenant. A tenant with several leases has an entry per lease.
 */
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
  /** Distinct tenants with a balance in the bucket. */
  tenantCount: number
}

export interface ArrearsOverview {
  asOf: ISODate
  /** The ageing bucket boundaries in days (the company's arrears monitoring configuration). */
  ageingBuckets: number[]
  /** Across every tenant and lease. */
  totalOutstanding: ZAR
  /** Distinct tenants in arrears (on one lease or more). */
  tenantsInArrears: number
  /** Distinct tenants in arrears under an active payment arrangement. */
  tenantsUnderArrangement: number
  buckets: ArrearsOverviewBucket[]
  /** Largest balance first. */
  entries: ArrearsOverviewEntry[]
}

/**
 * What a company's verified statements say it is owed on `asOf`. Only the LATEST verified statement of each tenant's
 * lease counts (domain `ageArrears`), and the totals add up every lease: unverified, rejected and duplicate statements
 * never count, and a lease whose latest balance is zero or in credit is not in arrears. Balances are aged from the
 * statement date into the configured buckets. A tenant under an active payment arrangement is still in arrears (the
 * balance is owed) and is marked as such on each of its entries; arrangements are per tenant.
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
  return {
    asOf,
    ageingBuckets: buckets,
    totalOutstanding: totalOutstanding(entries),
    tenantsInArrears: tenantCount(entries),
    tenantsUnderArrangement: tenantCount(entries.filter((entry) => entry.underArrangement)),
    buckets: ageingBucketLabels(buckets).map((bucket) => ({
      bucket,
      description: describeAgeingBucket(bucket, buckets),
      outstanding: amounts[bucket] ?? 0,
      tenantCount: tenantCount(entries.filter((entry) => entry.bucket === bucket)),
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
