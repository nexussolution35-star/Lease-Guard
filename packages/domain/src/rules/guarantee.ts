import type { BankGuarantee, ISODate, Lease, ZAR } from '../types/index.js'
import { daysBetween } from './dates.js'
import { expectedRental } from './escalation.js'
import { crossedThreshold } from './leaseExpiry.js'
import { roundZar } from './money.js'

type CoverageLease = Pick<Lease, 'initialMonthlyRental' | 'escalation' | 'expiryDate' | 'commencementDate' | 'bankGuarantee' | 'deposit'>

export interface Coverage {
  /** basisMonths × expected rental as of `asOf`. */
  required: ZAR
  /** Amount actually held / guaranteed. */
  actual: ZAR
  /** max(0, required − actual). */
  shortfall: ZAR
  /** actual ÷ expected monthly rental (months of cover actually held). */
  coverageMonths: number
  /** actual ÷ required (1 = fully covered). */
  coverageRatio: number
  basisMonths: number
  expectedMonthlyRental: ZAR
}

function buildCoverage(lease: CoverageLease, asOf: ISODate, basisMonths: number, actual: ZAR): Coverage {
  const rental = expectedRental(lease, asOf)
  const required = roundZar(basisMonths * rental)
  return {
    required,
    actual: roundZar(actual),
    shortfall: roundZar(Math.max(0, required - actual)),
    coverageMonths: rental > 0 ? roundZar(actual / rental) : 0,
    coverageRatio: required > 0 ? Math.round((actual / required) * 10000) / 10000 : 1,
    basisMonths,
    expectedMonthlyRental: rental,
  }
}

/** Guarantee the lease SHOULD carry as of `asOf`; `null` when the lease has no guarantee. */
export function requiredGuaranteeAmount(lease: CoverageLease, asOf: ISODate, basisMonths?: number): ZAR | null {
  const months = basisMonths ?? lease.bankGuarantee?.basisMonths
  if (months === undefined) return null
  return roundZar(months * expectedRental(lease, asOf))
}

export function guaranteeCoverage(lease: CoverageLease, asOf: ISODate): Coverage | null {
  const g = lease.bankGuarantee
  if (!g) return null
  return buildCoverage(lease, asOf, g.basisMonths, g.amount)
}

/** Same as guaranteeCoverage but for the deposit; requires `deposit.basisMonths`. */
export function depositCoverage(lease: CoverageLease, asOf: ISODate): Coverage | null {
  const d = lease.deposit
  if (!d || d.basisMonths === undefined) return null
  return buildCoverage(lease, asOf, d.basisMonths, d.amount)
}

export const GUARANTEE_EXPIRY_STATES = ['released', 'called', 'expired', 'expiring', 'active'] as const
export type GuaranteeExpiryState = (typeof GUARANTEE_EXPIRY_STATES)[number]

export interface GuaranteeExpiryStatus {
  state: GuaranteeExpiryState
  daysUntilExpiry: number
  /** Company notice threshold (days) most recently crossed, if any. */
  thresholdCrossed: number | null
}

/**
 * Released / called guarantees are terminal. Otherwise: expired when the date has passed,
 * expiring once inside any `noticeDays` threshold, else active.
 */
export function guaranteeExpiryStatus(
  guarantee: Pick<BankGuarantee, 'expiresOn' | 'status'>,
  today: ISODate,
  noticeDays: readonly number[],
): GuaranteeExpiryStatus {
  const days = daysBetween(today, guarantee.expiresOn)
  if (guarantee.status === 'released' || guarantee.status === 'called') {
    return { state: guarantee.status, daysUntilExpiry: days, thresholdCrossed: null }
  }
  if (days < 0) return { state: 'expired', daysUntilExpiry: days, thresholdCrossed: null }
  const threshold = crossedThreshold(days, noticeDays)
  return { state: threshold === null ? 'active' : 'expiring', daysUntilExpiry: days, thresholdCrossed: threshold }
}
