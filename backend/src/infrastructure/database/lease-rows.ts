import type { BankGuarantee, Deposit, Lease, LeaseEscalation, RenewalOption } from '@leaseguard/domain'

import type { Tables } from './database.types'

// The adapter from the `leases` table shape to the domain `Lease`. It lives here, not in modules/leases,
// because the API (modules/) and lease monitoring (workers/) both read leases and must not import each
// other: one mapping keeps locality for every lease column.

export type LeaseRow = Tables<'leases'>
export type BankGuaranteeRow = Tables<'lease_bank_guarantees'>

/** A lease row with its embedded bank guarantee (at most one: `lease_id` is unique). */
export type LeaseWithGuaranteeRow = LeaseRow & { lease_bank_guarantees: BankGuaranteeRow[] }

function toEscalation(row: LeaseRow): LeaseEscalation {
  return {
    type: row.escalation_type,
    ...(row.escalation_percentage !== null ? { percentage: row.escalation_percentage } : {}),
    ...(row.escalation_fixed_amount !== null ? { fixedAmount: row.escalation_fixed_amount } : {}),
    ...(row.escalation_cpi_assumed_percentage !== null
      ? { cpiAssumedPercentage: row.escalation_cpi_assumed_percentage }
      : {}),
    ...(row.escalation_cpi_margin_percentage !== null
      ? { cpiMarginPercentage: row.escalation_cpi_margin_percentage }
      : {}),
    frequency: row.escalation_frequency,
    firstEscalationDate: row.first_escalation_date,
  }
}

function toRenewalOption(row: LeaseRow): RenewalOption {
  return {
    exists: row.renewal_option_exists,
    ...(row.renewal_term_months !== null ? { renewalTermMonths: row.renewal_term_months } : {}),
    ...(row.renewal_notice_period_months !== null ? { noticePeriodMonths: row.renewal_notice_period_months } : {}),
    exercised: row.renewal_exercised,
    ...(row.renewal_exercised_on ? { exercisedOn: row.renewal_exercised_on } : {}),
    ...(row.renewal_notes ? { notes: row.renewal_notes } : {}),
  }
}

/**
 * The deposit exists when its amount is recorded. The `leases_deposit_complete_check` constraint makes
 * amount, holder and interest-bearing flag all present or all absent.
 */
function toDeposit(row: LeaseRow): Deposit | undefined {
  if (row.deposit_amount === null || row.deposit_held_by === null || row.deposit_interest_bearing === null) {
    return undefined
  }
  return {
    amount: row.deposit_amount,
    ...(row.deposit_basis_months !== null ? { basisMonths: row.deposit_basis_months } : {}),
    heldBy: row.deposit_held_by,
    ...(row.deposit_received_on ? { receivedOn: row.deposit_received_on } : {}),
    interestBearing: row.deposit_interest_bearing,
    ...(row.deposit_notes ? { notes: row.deposit_notes } : {}),
  }
}

/** `lease_bank_guarantees` row → domain `BankGuarantee`. */
export function toBankGuarantee(row: BankGuaranteeRow): BankGuarantee {
  return {
    bank: row.bank,
    referenceNumber: row.reference_number,
    amount: row.amount,
    basisMonths: row.basis_months,
    issuedOn: row.issued_on,
    expiresOn: row.expires_on,
    status: row.status,
    ...(row.notes ? { notes: row.notes } : {}),
  }
}

/**
 * Lease row plus its bank guarantee (if any) → domain `Lease`. Escalation, renewal option and deposit are
 * columns of the lease; nullable columns become absent optional fields. Numeric zero values (e.g. a 0%
 * escalation) are kept, only SQL NULL is treated as absent.
 */
export function toLease(row: LeaseRow, guarantee: BankGuaranteeRow | null | undefined): Lease {
  const deposit = toDeposit(row)
  return {
    id: row.id,
    companyId: row.company_id,
    reference: row.reference,
    propertyId: row.property_id,
    unitId: row.unit_id,
    tenantId: row.tenant_id,
    commencementDate: row.commencement_date,
    expiryDate: row.expiry_date,
    initialMonthlyRental: row.initial_monthly_rental,
    currentMonthlyRental: row.current_monthly_rental,
    paymentDueDay: row.payment_due_day,
    escalation: toEscalation(row),
    renewalOption: toRenewalOption(row),
    ...(deposit ? { deposit } : {}),
    ...(guarantee ? { bankGuarantee: toBankGuarantee(guarantee) } : {}),
    status: row.status,
    verified: row.verified,
    ...(row.verified_by_user_id ? { verifiedByUserId: row.verified_by_user_id } : {}),
    ...(row.verified_at ? { verifiedAt: row.verified_at } : {}),
    ...(row.previous_lease_id ? { previousLeaseId: row.previous_lease_id } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Lease query row with the guarantee embedded as a to-many relation → domain `Lease`. */
export function toLeaseFromQuery({ lease_bank_guarantees, ...row }: LeaseWithGuaranteeRow): Lease {
  return toLease(row, lease_bank_guarantees[0])
}
