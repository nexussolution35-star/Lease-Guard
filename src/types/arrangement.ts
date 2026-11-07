import type { CompanyScoped, EntityId, ISODate, ISODateTime, ZAR } from './common'

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
  notes: string
  installments: readonly ArrangementInstallment[]
}
