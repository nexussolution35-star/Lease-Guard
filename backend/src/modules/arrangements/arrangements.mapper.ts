import type { ArrangementInstallment, PaymentArrangement, PaymentArrangementListItem } from '@leaseguard/domain'

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
    ...(row.outcome_recorded_by_user_id ? { outcomeRecordedByUserId: row.outcome_recorded_by_user_id } : {}),
    ...(row.outcome_recorded_at ? { outcomeRecordedAt: row.outcome_recorded_at } : {}),
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
    ...(row.closed_by_user_id ? { closedByUserId: row.closed_by_user_id } : {}),
    ...(row.close_reason !== null ? { closeReason: row.close_reason } : {}),
    notes: row.notes,
    installments: installments.map(toArrangementInstallment),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Every arrangement read names its tenant, unit (with its property) and lease: to-one embeds over the composite foreign
 * keys, so a row reads without a lookup per record.
 */
export const ARRANGEMENT_SELECT =
  '*, tenant:tenants!payment_arrangements_tenant_fk(trading_name), unit:units!payment_arrangements_unit_fk(unit_number, property:properties!units_property_fk(name)), lease:leases!payment_arrangements_lease_fk(reference)'

export type PaymentArrangementNamedRow = PaymentArrangementRow & {
  tenant?: { trading_name: string } | null
  unit?: { unit_number: string; property: { name: string } | null } | null
  lease?: { reference: string } | null
}

/** A row read with `ARRANGEMENT_SELECT` → the arrangement and the names of its tenant, property, unit and lease. */
export function toPaymentArrangementListItem(
  { tenant, unit, lease, ...row }: PaymentArrangementNamedRow,
  installments: readonly ArrangementInstallmentRow[] = [],
): PaymentArrangementListItem {
  return {
    ...toPaymentArrangement(row, installments),
    tenantName: tenant?.trading_name ?? '',
    propertyName: unit?.property?.name ?? '',
    unitNumber: unit?.unit_number ?? '',
    leaseReference: lease?.reference ?? '',
  }
}
