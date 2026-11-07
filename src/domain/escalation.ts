import type { EventCalculation, ISODate, Lease, LeaseEscalation, ZAR } from '@/types'
import { addMonthsISO, compareISODate } from './dates'
import { formatZAR, roundZar } from './money'

type EscalationLease = Pick<Lease, 'initialMonthlyRental' | 'escalation' | 'expiryDate' | 'commencementDate'>

/** Months between escalations for a frequency. */
export function escalationIntervalMonths(frequency: LeaseEscalation['frequency']): number {
  return frequency === 'biennial' ? 24 : 12
}

/** Effective percentage per interval: percentage, or CPI assumed + margin. 0 for fixed/none. */
export function escalationRatePercent(escalation: LeaseEscalation): number {
  switch (escalation.type) {
    case 'percentage':
      return escalation.percentage ?? 0
    case 'cpi_linked':
      return (escalation.cpiAssumedPercentage ?? 0) + (escalation.cpiMarginPercentage ?? 0)
    case 'fixed_amount':
    case 'none':
      return 0
  }
}

/**
 * All escalation effective dates on or after `from` and on or before `to` (inclusive), never
 * beyond the lease expiry. Dates are computed as firstEscalationDate + k·interval so month-end
 * clamping never drifts. Empty for `type: 'none'`.
 */
export function escalationDatesBetween(lease: EscalationLease, from: ISODate, to: ISODate): ISODate[] {
  const { escalation } = lease
  if (escalation.type === 'none') return []
  if (compareISODate(from, to) > 0) return []
  const interval = escalationIntervalMonths(escalation.frequency)
  const upper = compareISODate(to, lease.expiryDate) <= 0 ? to : lease.expiryDate
  const dates: ISODate[] = []
  for (let k = 0; k < 1000; k++) {
    const d = addMonthsISO(escalation.firstEscalationDate, k * interval)
    if (compareISODate(d, upper) > 0) break
    if (compareISODate(d, from) >= 0) dates.push(d)
  }
  return dates
}

/** Number of escalations whose effective date is on or before `asOf` (capped at expiry). */
export function appliedEscalationCount(lease: EscalationLease, asOf: ISODate): number {
  return escalationDatesBetween(lease, lease.escalation.firstEscalationDate, asOf).length
}

/** Rental after `count` escalations, before rounding. */
function rentalAfter(initial: ZAR, escalation: LeaseEscalation, count: number): number {
  switch (escalation.type) {
    case 'percentage':
    case 'cpi_linked': {
      const rate = escalationRatePercent(escalation) / 100
      return initial * Math.pow(1 + rate, count)
    }
    case 'fixed_amount':
      return initial + (escalation.fixedAmount ?? 0) * count
    case 'none':
      return initial
  }
}

/**
 * Contractual monthly rental expected as of `asOf`.
 * percentage / cpi_linked compound per interval; fixed_amount adds per interval; none = initial.
 */
export function expectedRental(lease: EscalationLease, asOf: ISODate): ZAR {
  const count = appliedEscalationCount(lease, asOf)
  return roundZar(rentalAfter(lease.initialMonthlyRental, lease.escalation, count))
}

/** Explainable calculation: one step per applied escalation plus the result. */
export function buildEscalationCalculation(lease: EscalationLease, asOf: ISODate): EventCalculation {
  const { escalation, initialMonthlyRental } = lease
  const dates = escalationDatesBetween(lease, escalation.firstEscalationDate, asOf)
  const steps: string[] = [`Initial rental ${formatZAR(initialMonthlyRental)}`]
  let running = initialMonthlyRental
  for (let i = 0; i < dates.length; i++) {
    const before = running
    running = rentalAfter(initialMonthlyRental, escalation, i + 1)
    const after = roundZar(running)
    switch (escalation.type) {
      case 'percentage':
        steps.push(`Escalation ${i + 1} on ${dates[i]}: ${formatZAR(before)} × ${1 + (escalation.percentage ?? 0) / 100} = ${formatZAR(after)}`)
        break
      case 'cpi_linked':
        steps.push(
          `Escalation ${i + 1} on ${dates[i]}: ${formatZAR(before)} × ${1 + escalationRatePercent(escalation) / 100} (CPI ${escalation.cpiAssumedPercentage ?? 0}% + ${escalation.cpiMarginPercentage ?? 0}%) = ${formatZAR(after)}`,
        )
        break
      case 'fixed_amount':
        steps.push(`Escalation ${i + 1} on ${dates[i]}: ${formatZAR(before)} + ${formatZAR(escalation.fixedAmount ?? 0)} = ${formatZAR(after)}`)
        break
      case 'none':
        break
    }
  }
  if (escalation.type === 'none') steps.push('No escalation clause; rental unchanged')
  else if (dates.length === 0) steps.push(`No escalation effective on or before ${asOf}`)
  const expected = roundZar(running)
  steps.push(`Expected rental as of ${asOf}: ${formatZAR(expected)}`)
  return { expectedAmount: expected, steps }
}

/** Tolerance shape matches the `rental_escalation_discrepancy` monitoring rule config. */
export interface EscalationTolerance {
  toleranceRands: ZAR
  tolerancePercent: number
}

export interface BilledRentalComparison {
  expected: ZAR
  billed: ZAR
  /** expected − billed: positive means the tenant was UNDER-billed (lost rental). */
  difference: ZAR
  withinTolerance: boolean
  calculation: EventCalculation
}

/**
 * Compare the rental actually billed on a statement with the contractual expectation.
 * Spec example: R35 000 at 8% → R37 800; billed R35 000 → difference R2 800.
 * Within tolerance when |difference| ≤ max(toleranceRands, expected × tolerancePercent / 100).
 */
export function compareBilledRental(
  lease: EscalationLease,
  billed: ZAR,
  asOf: ISODate,
  tolerance: EscalationTolerance = { toleranceRands: 0, tolerancePercent: 0 },
): BilledRentalComparison {
  const base = buildEscalationCalculation(lease, asOf)
  const expected = base.expectedAmount ?? expectedRental(lease, asOf)
  const billedRounded = roundZar(billed)
  const difference = roundZar(expected - billedRounded)
  const allowed = Math.max(tolerance.toleranceRands, (expected * tolerance.tolerancePercent) / 100)
  const withinTolerance = Math.abs(difference) <= allowed + 1e-9
  const steps = [
    ...base.steps,
    `Billed rental: ${formatZAR(billedRounded)}`,
    `Difference (expected − billed): ${formatZAR(difference)}`,
    withinTolerance
      ? `Within tolerance of ${formatZAR(roundZar(allowed))}`
      : `Exceeds tolerance of ${formatZAR(roundZar(allowed))}`,
  ]
  return {
    expected,
    billed: billedRounded,
    difference,
    withinTolerance,
    calculation: { expectedAmount: expected, actualAmount: billedRounded, difference, steps },
  }
}
