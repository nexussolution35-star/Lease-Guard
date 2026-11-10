import type { ArrangementInstallment, PaymentArrangement } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

export type PaymentArrangementRow = Tables<'payment_arrangements'>
export type ArrangementInstallmentRow = Tables<'arrangement_installments'>

export function toArrangementInstallment(row: ArrangementInstallmentRow): ArrangementInstallment {
  return {
    id: row.id,
    arrangementId: row.arrangement_id,
    sequence: row.sequence,
    dueDate: row.due_date,
    amount: row.amount,
    status: row.status,
    ...(row.reminder_sent_at ? { reminderSentAt: row.reminder_sent_at } : {}),
    ...(row.confirmed_by_user_id ? { confirmedByUserId: row.confirmed_by_user_id } : {}),
    ...(row.confirmed_on ? { confirmedOn: row.confirmed_on } : {}),
    ...(row.notes !== null ? { notes: row.notes } : {}),
  }
}

/**
 * Database rows → domain `PaymentArrangement` (a monitoring record of an agreement; LeaseGuard never
 * processes payments). `installments` must be ordered by sequence.
 */
export function toPaymentArrangement(
  row: PaymentArrangementRow,
  installments: readonly ArrangementInstallmentRow[] = [],
): PaymentArrangement {
  return {
    id: row.id,
    companyId: row.company_id,
    tenantId: row.tenant_id,
    propertyId: row.property_id,
    unitId: row.unit_id,
    leaseId: row.lease_id,
    outstandingBalance: row.outstanding_balance,
    installmentAmount: row.installment_amount,
    frequency: row.frequency,
    firstInstallmentDate: row.first_installment_date,
    finalInstallmentDate: row.final_installment_date,
    status: row.status,
    suppressArrearsReminders: row.suppress_arrears_reminders,
    agreedByUserId: row.agreed_by_user_id,
    agreedOn: row.agreed_on,
    ...(row.closed_on ? { closedOn: row.closed_on } : {}),
    notes: row.notes,
    installments: installments.map(toArrangementInstallment),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
