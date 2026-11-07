import { useMemo } from 'react'

import { activeArrangementsForTenant, finalInstallmentDate, generateInstallmentSchedule, shouldSuppressArrearsReminder } from '@leaseguard/domain'
import { nowISO, todayISO } from '@/store/ids'
import type {
  ArrangementInstallment,
  ArrangementStatus,
  EntityId,
  InstallmentFrequency,
  ISODate,
  PaymentArrangement,
  ZAR,
} from '@leaseguard/domain'

import { leasesRepo } from '@/services/leases'
import type { ListQuery, PagedResult } from '@/services/query'
import { createRepository, getCurrentUserId } from '@/services/repository'

export const arrangementsRepo = createRepository('paymentArrangements', {
  entityType: 'payment_arrangement',
  label: 'Payment arrangement',
  idPrefix: 'arr',
  searchFields: ['notes'],
})

export const listArrangements = arrangementsRepo.list
export const listAllArrangements = arrangementsRepo.listAll
export const getArrangement = arrangementsRepo.getById

export interface CreateArrangementInput {
  tenantId: EntityId
  leaseId: EntityId
  outstandingBalance: ZAR
  installmentAmount: ZAR
  frequency: InstallmentFrequency
  firstInstallmentDate: ISODate
  notes?: string
  /** Defaults to `active`; use `proposed` while the tenant has not yet agreed. */
  status?: Extract<ArrangementStatus, 'proposed' | 'active'>
  agreedOn?: ISODate
}

/**
 * Record a payment arrangement and generate its instalment schedule (via `@/domain`).
 * While active it suppresses normal arrears reminders for the tenant.
 */
export function createArrangement(input: CreateArrangementInput): PaymentArrangement {
  const lease = leasesRepo.require(input.leaseId)
  if (lease.tenantId !== input.tenantId) throw new Error('Lease does not belong to the given tenant')
  const existing = arrangementsRepo.listAll().find((a) => a.tenantId === input.tenantId && a.status === 'active')
  if (existing && (input.status ?? 'active') === 'active') {
    throw new Error(`Tenant already has an active arrangement (${existing.id})`)
  }

  const status = input.status ?? 'active'
  // Validate the schedule inputs before writing anything (throws on non-positive amounts).
  const preview = generateInstallmentSchedule({
    arrangementId: 'preview',
    outstandingBalance: input.outstandingBalance,
    installmentAmount: input.installmentAmount,
    frequency: input.frequency,
    firstInstallmentDate: input.firstInstallmentDate,
  })
  const created = arrangementsRepo.create(
    {
      tenantId: input.tenantId,
      propertyId: lease.propertyId,
      unitId: lease.unitId,
      leaseId: lease.id,
      outstandingBalance: input.outstandingBalance,
      installmentAmount: input.installmentAmount,
      frequency: input.frequency,
      firstInstallmentDate: input.firstInstallmentDate,
      finalInstallmentDate: finalInstallmentDate(preview) ?? input.firstInstallmentDate,
      status,
      suppressArrearsReminders: status === 'active',
      agreedByUserId: getCurrentUserId(),
      agreedOn: input.agreedOn ?? todayISO(),
      notes: input.notes ?? '',
      installments: [],
    },
    { summary: `Payment arrangement of ${preview.length} instalments recorded` },
  )
  // Instalment ids embed the arrangement id, so the real schedule is generated once the id exists.
  const installments = generateInstallmentSchedule({
    arrangementId: created.id,
    outstandingBalance: input.outstandingBalance,
    installmentAmount: input.installmentAmount,
    frequency: input.frequency,
    firstInstallmentDate: input.firstInstallmentDate,
  })
  return arrangementsRepo.update(created.id, { installments }, { summary: 'Instalment schedule generated' })
}

function updateInstallment(
  arrangementId: EntityId,
  installmentId: EntityId,
  patch: Partial<ArrangementInstallment>,
  summary: string,
): PaymentArrangement {
  const arrangement = arrangementsRepo.require(arrangementId)
  const installment = arrangement.installments.find((i) => i.id === installmentId)
  if (!installment) throw new Error(`Instalment ${installmentId} not found on arrangement ${arrangementId}`)
  const installments = arrangement.installments.map((i) => (i.id === installmentId ? { ...i, ...patch } : i))
  return arrangementsRepo.update(arrangementId, { installments }, { summary })
}

/** Confirm an instalment as paid (from an updated statement or the manager; never from a bank feed). */
export function confirmInstallment(arrangementId: EntityId, installmentId: EntityId, confirmedOn: ISODate = todayISO()): PaymentArrangement {
  const updated = updateInstallment(
    arrangementId,
    installmentId,
    { status: 'confirmed_paid', confirmedByUserId: getCurrentUserId(), confirmedOn },
    'Instalment confirmed as paid',
  )
  const allSettled = updated.installments.every((i) => i.status === 'confirmed_paid' || i.status === 'waived')
  return allSettled && updated.status === 'active' ? closeArrangement(arrangementId, 'completed') : updated
}

export function markInstallmentMissed(arrangementId: EntityId, installmentId: EntityId, notes?: string): PaymentArrangement {
  return updateInstallment(
    arrangementId,
    installmentId,
    { status: 'missed', ...(notes !== undefined ? { notes } : {}) },
    'Instalment marked as missed',
  )
}

export function markInstallmentReminderSent(arrangementId: EntityId, installmentId: EntityId): PaymentArrangement {
  return updateInstallment(
    arrangementId,
    installmentId,
    { status: 'reminder_sent', reminderSentAt: nowISO() },
    'Instalment reminder sent',
  )
}

export function activateArrangement(arrangementId: EntityId, agreedOn: ISODate = todayISO()): PaymentArrangement {
  const arrangement = arrangementsRepo.require(arrangementId)
  if (arrangement.status !== 'proposed') throw new Error('Only proposed arrangements can be activated')
  return arrangementsRepo.update(
    arrangementId,
    { status: 'active', suppressArrearsReminders: true, agreedOn, agreedByUserId: getCurrentUserId() },
    { summary: 'Payment arrangement activated' },
  )
}

export function closeArrangement(
  arrangementId: EntityId,
  status: Extract<ArrangementStatus, 'completed' | 'defaulted' | 'cancelled'>,
  notes?: string,
): PaymentArrangement {
  const arrangement = arrangementsRepo.require(arrangementId)
  if (arrangement.status === 'completed' || arrangement.status === 'defaulted' || arrangement.status === 'cancelled') {
    throw new Error(`Arrangement is already ${arrangement.status}`)
  }
  return arrangementsRepo.update(
    arrangementId,
    {
      status,
      suppressArrearsReminders: false,
      closedOn: todayISO(),
      ...(notes !== undefined ? { notes: [arrangement.notes, notes].filter(Boolean).join('\n') } : {}),
    },
    { summary: `Payment arrangement ${status}` },
  )
}

export function getActiveArrangementForTenant(tenantId: EntityId): PaymentArrangement | undefined {
  return arrangementsRepo.listAll().find((a) => a.tenantId === tenantId && a.status === 'active')
}

export interface ReminderSuppressionStatus {
  tenantId: EntityId
  /** True while an active arrangement pauses normal arrears reminders (per @/domain). */
  suppressed: boolean
  /** The active arrangement causing the suppression, if any. */
  arrangementId?: EntityId
  /** Human-readable explanation, empty when not suppressed. */
  reason: string
}

export function buildReminderSuppressionStatus(
  tenantId: EntityId,
  arrangements: readonly PaymentArrangement[],
  today: ISODate,
): ReminderSuppressionStatus {
  const suppressed = shouldSuppressArrearsReminder(tenantId, arrangements, today)
  const arrangement = suppressed
    ? activeArrangementsForTenant(tenantId, arrangements, today).find((a) => a.suppressArrearsReminders)
    : undefined
  return {
    tenantId,
    suppressed,
    ...(arrangement ? { arrangementId: arrangement.id } : {}),
    reason: suppressed ? 'Arrears reminders are paused by an active payment arrangement' : '',
  }
}

/** Whether normal arrears reminders are currently suppressed for a tenant of the active company. */
export function getReminderSuppressionStatus(tenantId: EntityId, today: ISODate = todayISO()): ReminderSuppressionStatus {
  return buildReminderSuppressionStatus(tenantId, arrangementsRepo.listAll(), today)
}

// Hooks --------------------------------------------------------------------

export function useArrangements(query?: ListQuery<PaymentArrangement>): PagedResult<PaymentArrangement> {
  return arrangementsRepo.useList(query)
}

export const useAllArrangements = arrangementsRepo.useAll
export const useArrangement = arrangementsRepo.useById

export function useActiveArrangementForTenant(tenantId: EntityId | undefined): PaymentArrangement | undefined {
  const all = arrangementsRepo.useAll()
  return useMemo(
    () => (tenantId ? all.find((a) => a.tenantId === tenantId && a.status === 'active') : undefined),
    [all, tenantId],
  )
}

export function useReminderSuppressionStatus(tenantId: EntityId | undefined, today: ISODate = todayISO()): ReminderSuppressionStatus | undefined {
  const all = arrangementsRepo.useAll()
  return useMemo(() => (tenantId ? buildReminderSuppressionStatus(tenantId, all, today) : undefined), [all, tenantId, today])
}
