import type { CompanyScoped, EntityId, ISODate, ISODateTime, ZAR } from './common.js'

export const ARRANGEMENT_STATUSES = ['proposed', 'active', 'completed', 'defaulted', 'cancelled'] as const
export type ArrangementStatus = (typeof ARRANGEMENT_STATUSES)[number]

export const INSTALLMENT_FREQUENCIES = ['weekly', 'fortnightly', 'monthly'] as const
export type InstallmentFrequency = (typeof INSTALLMENT_FREQUENCIES)[number]

export const INSTALLMENT_STATUSES = [
  'scheduled',
  'reminder_sent',
  'confirmed_paid',
  'missed',
  'waived',
] as const
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number]

/** What a property manager records about an instalment (LeaseGuard never verifies a payment). */
export const INSTALLMENT_OUTCOMES = ['confirmed_paid', 'missed', 'waived'] as const
export type InstallmentOutcome = (typeof INSTALLMENT_OUTCOMES)[number]

/** How an active arrangement is closed; cancelling is separate and needs a reason. */
export const ARRANGEMENT_CLOSE_OUTCOMES = ['completed', 'defaulted'] as const
export type ArrangementCloseOutcome = (typeof ARRANGEMENT_CLOSE_OUTCOMES)[number]

/** Statuses of an arrangement that has ended; it is read-only from then on. */
export const CLOSED_ARRANGEMENT_STATUSES = ['completed', 'defaulted', 'cancelled'] as const satisfies readonly ArrangementStatus[]

/** The most instalments one arrangement may have (also enforced by the database). */
export const MAX_ARRANGEMENT_INSTALLMENTS = 260

export interface ArrangementInstallment {
  id: EntityId
  arrangementId: EntityId
  sequence: number
  dueDate: ISODate
  amount: ZAR
  status: InstallmentStatus
  reminderSentAt?: ISODateTime
  /** Confirmation comes from updated statements or the property manager; LeaseGuard never verifies bank transactions. */
  confirmedByUserId?: EntityId
  confirmedOn?: ISODate
  /** Who recorded the outcome (paid, missed or waived) and when. */
  outcomeRecordedByUserId?: EntityId
  outcomeRecordedAt?: ISODateTime
  notes?: string
}

/** A recorded agreement between tenant and owner/manager. Records only; no payment processing. */
export interface PaymentArrangement extends CompanyScoped {
  tenantId: EntityId
  propertyId: EntityId
  unitId: EntityId
  leaseId: EntityId
  /** Outstanding balance at the time of agreement. */
  outstandingBalance: ZAR
  installmentAmount: ZAR
  frequency: InstallmentFrequency
  firstInstallmentDate: ISODate
  finalInstallmentDate: ISODate
  status: ArrangementStatus
  /** While active, normal arrears reminders are paused for this tenant. */
  suppressArrearsReminders: boolean
  agreedByUserId: EntityId
  agreedOn: ISODate
  closedOn?: ISODate
  /** Who closed or cancelled it, and why (required to cancel). */
  closedByUserId?: EntityId
  closeReason?: string
  notes: string
  installments: readonly ArrangementInstallment[]
}

/**
 * A payment arrangement as the API returns it: the record plus the names of its tenant, property, unit and lease, so
 * the arrangements list and detail read without a lookup per record. Still a monitoring record; nothing is paid here.
 */
export interface PaymentArrangementListItem extends PaymentArrangement {
  /** The tenant's trading name. */
  tenantName: string
  propertyName: string
  unitNumber: string
  leaseReference: string
}
