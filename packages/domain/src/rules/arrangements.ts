import {
  CLOSED_ARRANGEMENT_STATUSES,
  INSTALLMENT_OUTCOMES,
  MAX_ARRANGEMENT_INSTALLMENTS,
  type ArrangementInstallment,
  type ArrangementStatus,
  type EntityId,
  type InstallmentFrequency,
  type InstallmentOutcome,
  type InstallmentStatus,
  type ISODate,
  type PaymentArrangement,
  type Statement,
  type ZAR,
} from '../types/index.js'
import type { TenantArrears } from './arrears.js'
import { addDaysISO, addMonthsISO, compareISODate, formatSADate, isWithinISO } from './dates.js'
import { roundZar, sumZar } from './money.js'

export interface InstallmentScheduleInput {
  arrangementId: EntityId
  outstandingBalance: ZAR
  installmentAmount: ZAR
  frequency: InstallmentFrequency
  firstInstallmentDate: ISODate
}

/** Next due date for a frequency. Monthly keeps the day-of-month (clamped to month end). */
export function nextDueDate(fromDate: ISODate, frequency: InstallmentFrequency, firstDate: ISODate, sequence: number): ISODate {
  switch (frequency) {
    case 'weekly':
      return addDaysISO(firstDate, 7 * (sequence - 1))
    case 'fortnightly':
      return addDaysISO(firstDate, 14 * (sequence - 1))
    case 'monthly':
      return addMonthsISO(firstDate, sequence - 1)
    default:
      return fromDate
  }
}

/**
 * Build the instalment schedule covering `outstandingBalance`. Each instalment is
 * `installmentAmount` except the last, which is the remainder. All start as `scheduled`.
 * Throws when amount ≤ 0 or balance ≤ 0 (nothing to schedule).
 */
export function generateInstallmentSchedule(input: InstallmentScheduleInput): ArrangementInstallment[] {
  const balance = roundZar(input.outstandingBalance)
  const amount = roundZar(input.installmentAmount)
  if (amount <= 0) throw new Error('installmentAmount must be positive')
  if (balance <= 0) throw new Error('outstandingBalance must be positive')
  const count = Math.ceil(balance / amount)
  const installments: ArrangementInstallment[] = []
  let remaining = balance
  for (let seq = 1; seq <= count; seq++) {
    const thisAmount = seq === count ? roundZar(remaining) : amount
    remaining = roundZar(remaining - thisAmount)
    installments.push({
      id: `${input.arrangementId}_inst_${String(seq).padStart(3, '0')}`,
      arrangementId: input.arrangementId,
      sequence: seq,
      dueDate: nextDueDate(input.firstInstallmentDate, input.frequency, input.firstInstallmentDate, seq),
      amount: thisAmount,
      status: 'scheduled',
    })
  }
  return installments
}

/** Final instalment date for a generated schedule (convenience for `finalInstallmentDate`). */
export function finalInstallmentDate(installments: readonly Pick<ArrangementInstallment, 'dueDate'>[]): ISODate | null {
  if (installments.length === 0) return null
  return installments.reduce((max, i) => (compareISODate(i.dueDate, max) > 0 ? i.dueDate : max), installments[0].dueDate)
}

type ActiveCheck = Pick<PaymentArrangement, 'status' | 'agreedOn' | 'closedOn'>

/** Active = status `active`, agreed on or before `today`, and not closed on or before `today`. */
export function isArrangementActive(arrangement: ActiveCheck, today: ISODate): boolean {
  if (arrangement.status !== 'active') return false
  if (compareISODate(arrangement.agreedOn, today) > 0) return false
  if (arrangement.closedOn && compareISODate(arrangement.closedOn, today) <= 0) return false
  return true
}

type SuppressionCheck = ActiveCheck & Pick<PaymentArrangement, 'tenantId' | 'suppressArrearsReminders'>

/** True when the tenant has an active arrangement that pauses normal arrears reminders. */
export function shouldSuppressArrearsReminder(
  tenantId: EntityId,
  arrangements: readonly SuppressionCheck[],
  today: ISODate,
): boolean {
  return arrangements.some(
    (a) => a.tenantId === tenantId && a.suppressArrearsReminders && isArrangementActive(a, today),
  )
}

export function activeArrangementsForTenant<A extends SuppressionCheck>(
  tenantId: EntityId,
  arrangements: readonly A[],
  today: ISODate,
): A[] {
  return arrangements.filter((a) => a.tenantId === tenantId && isArrangementActive(a, today))
}

const OPEN_STATUSES: readonly InstallmentStatus[] = ['scheduled', 'reminder_sent']

export function isInstallmentOpen(installment: Pick<ArrangementInstallment, 'status'>): boolean {
  return OPEN_STATUSES.includes(installment.status)
}

/** Open instalments whose due date + graceDays is before `today`. */
export function overdueInstallments(
  arrangement: Pick<PaymentArrangement, 'installments'>,
  today: ISODate,
  graceDays = 0,
): ArrangementInstallment[] {
  return arrangement.installments.filter(
    (i) => isInstallmentOpen(i) && compareISODate(addDaysISO(i.dueDate, graceDays), today) < 0,
  )
}

/** Earliest open instalment due on or after `today`, or undefined. */
export function nextInstallment(
  arrangement: Pick<PaymentArrangement, 'installments'>,
  today: ISODate,
): ArrangementInstallment | undefined {
  return [...arrangement.installments]
    .filter((i) => isInstallmentOpen(i) && compareISODate(i.dueDate, today) >= 0)
    .sort((a, b) => compareISODate(a.dueDate, b.dueDate) || a.sequence - b.sequence)[0]
}

/** Sum of confirmed-paid instalments vs. the agreed balance. */
export function arrangementProgress(
  arrangement: Pick<PaymentArrangement, 'installments' | 'outstandingBalance'>,
): { paid: ZAR; remaining: ZAR; paidCount: number; totalCount: number } {
  let paid = 0
  let paidCount = 0
  for (const i of arrangement.installments) {
    if (i.status === 'confirmed_paid') {
      paid += i.amount
      paidCount++
    }
  }
  paid = roundZar(paid)
  return {
    paid,
    remaining: roundZar(Math.max(0, arrangement.outstandingBalance - paid)),
    paidCount,
    totalCount: arrangement.installments.length,
  }
}

// ---------------------------------------------------------------------------------- recording and editing

export interface ArrangementTerms {
  outstandingBalance: ZAR
  installmentAmount: ZAR
  frequency: InstallmentFrequency
  firstInstallmentDate: ISODate
  /** Optional: when given it must be the schedule's last due date. */
  finalInstallmentDate?: ISODate
  agreedOn: ISODate
}

/**
 * Every reason the terms cannot be recorded, in words (empty when they can). The database checks the same rules
 * (`private.arrangement_terms_problem`) and words them the same way, so a form can show them before saving.
 */
export function arrangementTermsProblems(terms: ArrangementTerms, today: ISODate): string[] {
  const problems: string[] = []
  const balance = roundZar(terms.outstandingBalance)
  const amount = roundZar(terms.installmentAmount)
  if (!(balance > 0)) problems.push('The outstanding balance must be more than R 0,00.')
  if (!(amount > 0)) problems.push('The instalment amount must be more than R 0,00.')
  if (balance > 0 && amount > balance) problems.push('The instalment amount cannot be more than the outstanding balance.')
  if (compareISODate(terms.agreedOn, today) > 0) problems.push('The agreement date cannot be in the future.')
  if (compareISODate(terms.firstInstallmentDate, terms.agreedOn) < 0) {
    problems.push(`The first instalment cannot be before the agreement date (${formatSADate(terms.agreedOn)}).`)
  }
  if (balance > 0 && amount > 0 && amount <= balance) {
    const count = Math.ceil(balance / amount)
    if (count > MAX_ARRANGEMENT_INSTALLMENTS) {
      problems.push(`This schedule has ${count} instalments; at most ${MAX_ARRANGEMENT_INSTALLMENTS} are allowed. Raise the instalment amount.`)
    } else if (terms.finalInstallmentDate !== undefined) {
      const final = nextDueDate(terms.firstInstallmentDate, terms.frequency, terms.firstInstallmentDate, count)
      if (final !== terms.finalInstallmentDate) {
        problems.push(
          `The final instalment of this schedule is due on ${formatSADate(final)} (${count} ${count === 1 ? 'instalment' : 'instalments'}), not ${formatSADate(terms.finalInstallmentDate)}.`,
        )
      }
    }
  }
  return problems
}

type ArrearsAccount = Pick<TenantArrears, 'tenantId' | 'leaseId' | 'outstanding'>

/**
 * What the tenant owes on the lease an arrangement is being recorded for, according to that lease's latest verified
 * statement (an entry of `ageArrears` / `arrearsOverview`), or undefined when no verified statement shows a balance on
 * it. The figure a new arrangement's outstanding balance starts from; nothing is guessed when there is none.
 */
export function arrearsForArrangementLease<E extends ArrearsAccount>(
  entries: readonly E[],
  tenantId: EntityId,
  leaseId: EntityId,
): E | undefined {
  return entries.find((entry) => entry.tenantId === tenantId && entry.leaseId === leaseId && entry.outstanding > 0)
}

/**
 * The instalment schedule the terms would give (what the database generates when they are saved), for showing before
 * saving; empty while the terms cannot be scheduled (see `arrangementTermsProblems`).
 */
export function previewInstallmentSchedule(
  terms: Pick<ArrangementTerms, 'outstandingBalance' | 'installmentAmount' | 'frequency' | 'firstInstallmentDate'>,
): ArrangementInstallment[] {
  const balance = roundZar(terms.outstandingBalance)
  const amount = roundZar(terms.installmentAmount)
  if (!(balance > 0) || !(amount > 0) || amount > balance) return []
  if (Math.ceil(balance / amount) > MAX_ARRANGEMENT_INSTALLMENTS) return []
  return generateInstallmentSchedule({ arrangementId: 'preview', ...terms })
}

export function isArrangementClosed(arrangement: Pick<PaymentArrangement, 'status'>): boolean {
  return (CLOSED_ARRANGEMENT_STATUSES as readonly ArrangementStatus[]).includes(arrangement.status)
}

export function isInstallmentOutcome(status: InstallmentStatus): status is InstallmentOutcome {
  return (INSTALLMENT_OUTCOMES as readonly InstallmentStatus[]).includes(status)
}

/** What a writer may do with an arrangement in its status (the database enforces the same transitions). */
export interface ArrangementActions {
  edit: boolean
  /** proposed -> active */
  activate: boolean
  /** active -> completed | defaulted */
  close: boolean
  /** proposed | active -> cancelled (a reason is required) */
  cancel: boolean
  /** The terms (balance, amount, frequency, first date) change only while no instalment outcome is recorded. */
  editSchedule: boolean
  recordInstallmentOutcomes: boolean
}

export function arrangementActions(arrangement: Pick<PaymentArrangement, 'status' | 'installments'>): ArrangementActions {
  const open = arrangement.status === 'proposed' || arrangement.status === 'active'
  return {
    edit: open,
    activate: arrangement.status === 'proposed',
    close: arrangement.status === 'active',
    cancel: open,
    editSchedule: open && !arrangement.installments.some((i) => isInstallmentOutcome(i.status)),
    recordInstallmentOutcomes: arrangement.status === 'active',
  }
}

/** Why the outcome cannot be recorded for the instalment, or null. 'scheduled' clears a recorded outcome. */
export function installmentOutcomeProblem(
  arrangement: Pick<PaymentArrangement, 'status'>,
  installment: Pick<ArrangementInstallment, 'sequence' | 'dueDate'>,
  outcome: InstallmentOutcome | 'scheduled',
  today: ISODate,
): string | null {
  if (arrangement.status !== 'active') {
    return `Instalment outcomes are recorded while the arrangement is active; this one is ${arrangement.status}.`
  }
  if (outcome === 'missed' && compareISODate(installment.dueDate, today) > 0) {
    return `Instalment ${installment.sequence} is due on ${formatSADate(installment.dueDate)}, so it cannot be missed yet.`
  }
  return null
}

// ---------------------------------------------------------------------------------- missed instalments on statements

export type ArrangementStatementFigures = Pick<
  Statement,
  'id' | 'leaseId' | 'status' | 'statementDate' | 'periodStart' | 'periodEnd' | 'rentalCharged' | 'additionalCharges' | 'paymentsReceived'
>

/** An open instalment that a verified statement shows was not covered by the payments received in its period. */
export interface StatementInstallmentShortfall {
  installment: ArrangementInstallment
  statementId: EntityId
  periodStart: ISODate
  periodEnd: ISODate
  rentalCharged: ZAR
  additionalCharges: ZAR
  /** Instalments due in the statement period (waived ones excluded). */
  installmentsDue: ZAR
  /** rentalCharged + additionalCharges + installmentsDue */
  expected: ZAR
  paymentsReceived: ZAR
  shortfall: ZAR
}

/**
 * Open instalments that a verified statement of the arrangement's lease suggests were missed: the statement period
 * holds the instalment's due date and the payments received in it are less than that period's charges plus the
 * instalments due in it. A flag for the property manager to confirm, never a recorded outcome: LeaseGuard does not
 * verify payments. A statement without all three figures or its period is ignored (nothing is guessed); when several
 * statements cover an instalment, the latest one decides.
 */
export function installmentShortfallsOnStatements(
  arrangement: Pick<PaymentArrangement, 'leaseId' | 'installments'>,
  statements: readonly ArrangementStatementFigures[],
): StatementInstallmentShortfall[] {
  interface Usable {
    id: EntityId
    date: ISODate
    periodStart: ISODate
    periodEnd: ISODate
    rentalCharged: ZAR
    additionalCharges: ZAR
    paymentsReceived: ZAR
  }
  const usable: Usable[] = []
  for (const s of statements) {
    const { periodStart, periodEnd, rentalCharged, additionalCharges, paymentsReceived } = s
    if (s.status !== 'verified' || s.leaseId !== arrangement.leaseId) continue
    if (periodStart === undefined || periodEnd === undefined) continue
    if (rentalCharged === undefined || additionalCharges === undefined || paymentsReceived === undefined) continue
    usable.push({
      id: s.id,
      date: s.statementDate ?? periodEnd,
      periodStart,
      periodEnd,
      rentalCharged: roundZar(rentalCharged),
      additionalCharges: roundZar(additionalCharges),
      paymentsReceived: roundZar(paymentsReceived),
    })
  }
  // Latest first, so the latest statement covering an instalment decides.
  usable.sort((a, b) => compareISODate(b.date, a.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const shortfalls: StatementInstallmentShortfall[] = []
  for (const installment of arrangement.installments) {
    if (!isInstallmentOpen(installment)) continue
    const statement = usable.find((s) => isWithinISO(installment.dueDate, s.periodStart, s.periodEnd))
    if (!statement) continue
    const { periodStart, periodEnd, rentalCharged, additionalCharges, paymentsReceived } = statement
    const installmentsDue = sumZar(
      arrangement.installments
        .filter((i) => i.status !== 'waived' && isWithinISO(i.dueDate, periodStart, periodEnd))
        .map((i) => i.amount),
    )
    const expected = sumZar([rentalCharged, additionalCharges, installmentsDue])
    if (paymentsReceived >= expected) continue
    shortfalls.push({
      installment,
      statementId: statement.id,
      periodStart,
      periodEnd,
      rentalCharged,
      additionalCharges,
      installmentsDue,
      expected,
      paymentsReceived,
      shortfall: roundZar(expected - paymentsReceived),
    })
  }
  return shortfalls
}
