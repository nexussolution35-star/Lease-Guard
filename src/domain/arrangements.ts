import type {
  ArrangementInstallment,
  EntityId,
  InstallmentFrequency,
  InstallmentStatus,
  ISODate,
  PaymentArrangement,
  ZAR,
} from '@/types'
import { addDaysISO, addMonthsISO, compareISODate } from './dates'
import { roundZar } from './money'

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
