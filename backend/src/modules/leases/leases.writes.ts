import type { TablesInsert, TablesUpdate } from '../../infrastructure/database/database.types'
import type { CreateLeaseBody, UpdateLeaseBody } from './leases.schemas'

/**
 * Lease columns a person writes through `public.save_lease`. The company, timestamps, verification (flag, verifier,
 * time) and the renewal exercise are not among them: verification has its own route and the database stamps it.
 */
type FixedColumns =
  | 'id'
  | 'company_id'
  | 'created_at'
  | 'updated_at'
  | 'verified'
  | 'verified_by_user_id'
  | 'verified_at'
  | 'renewal_exercised'
  | 'renewal_exercised_on'
  | 'previous_lease_id'
  | 'tenant_search_text'
export type LeaseColumns = Omit<TablesUpdate<'leases'>, FixedColumns>

type GuaranteeColumns = Pick<
  TablesInsert<'lease_bank_guarantees'>,
  'bank' | 'reference_number' | 'amount' | 'basis_months' | 'issued_on' | 'expires_on' | 'notes'
>

type Escalation = NonNullable<UpdateLeaseBody['escalation']>
type Renewal = NonNullable<UpdateLeaseBody['renewalOption']>
type Deposit = UpdateLeaseBody['deposit']
type Guarantee = NonNullable<UpdateLeaseBody['bankGuarantee']>

/** The escalation replaces the whole group: the amount fields its type does not use are cleared. */
function escalationColumns(escalation: Escalation): LeaseColumns {
  return {
    escalation_type: escalation.type,
    escalation_percentage: escalation.percentage ?? null,
    escalation_fixed_amount: escalation.fixedAmount ?? null,
    escalation_cpi_assumed_percentage: escalation.cpiAssumedPercentage ?? null,
    escalation_cpi_margin_percentage: escalation.cpiMarginPercentage ?? null,
    escalation_frequency: escalation.frequency,
    first_escalation_date: escalation.firstEscalationDate,
  }
}

function renewalColumns(renewal: Renewal): LeaseColumns {
  return {
    renewal_option_exists: renewal.exists,
    renewal_term_months: renewal.renewalTermMonths ?? null,
    renewal_notice_period_months: renewal.noticePeriodMonths ?? null,
    renewal_notes: renewal.notes || null,
  }
}

/** null (or no deposit on create) clears every deposit column; the database requires them all or none. */
function depositColumns(deposit: Deposit): LeaseColumns {
  return {
    deposit_amount: deposit?.amount ?? null,
    deposit_basis_months: deposit?.basisMonths ?? null,
    deposit_held_by: deposit?.heldBy ?? null,
    deposit_received_on: deposit?.receivedOn ?? null,
    deposit_interest_bearing: deposit?.interestBearing ?? null,
    deposit_notes: deposit?.notes || null,
  }
}

export function guaranteeColumns(guarantee: Guarantee): GuaranteeColumns {
  return {
    bank: guarantee.bank,
    reference_number: guarantee.referenceNumber,
    amount: guarantee.amount,
    basis_months: guarantee.basisMonths,
    issued_on: guarantee.issuedOn,
    expires_on: guarantee.expiresOn,
    notes: guarantee.notes || null,
  }
}

/** POST /leases body (without the guarantee) → columns. The current rental is the initial rental unless given. */
export function leaseInsertFrom(body: CreateLeaseBody): LeaseColumns {
  return {
    reference: body.reference,
    tenant_id: body.tenantId,
    property_id: body.propertyId,
    unit_id: body.unitId,
    commencement_date: body.commencementDate,
    expiry_date: body.expiryDate,
    initial_monthly_rental: body.initialMonthlyRental,
    current_monthly_rental: body.currentMonthlyRental ?? body.initialMonthlyRental,
    payment_due_day: body.paymentDueDay,
    ...escalationColumns(body.escalation),
    ...renewalColumns(body.renewalOption),
    ...depositColumns(body.deposit ?? null),
    status: body.status ?? 'pending_verification',
    notes: body.notes ?? null,
  }
}

/** PATCH /leases/:leaseId body (without the guarantee) → only the columns it changes. */
export function leaseChangesFrom(body: UpdateLeaseBody): LeaseColumns {
  return {
    ...(body.reference !== undefined ? { reference: body.reference } : {}),
    ...(body.tenantId !== undefined ? { tenant_id: body.tenantId } : {}),
    ...(body.propertyId !== undefined ? { property_id: body.propertyId } : {}),
    ...(body.unitId !== undefined ? { unit_id: body.unitId } : {}),
    ...(body.commencementDate !== undefined ? { commencement_date: body.commencementDate } : {}),
    ...(body.expiryDate !== undefined ? { expiry_date: body.expiryDate } : {}),
    ...(body.initialMonthlyRental !== undefined ? { initial_monthly_rental: body.initialMonthlyRental } : {}),
    ...(body.currentMonthlyRental !== undefined ? { current_monthly_rental: body.currentMonthlyRental } : {}),
    ...(body.paymentDueDay !== undefined ? { payment_due_day: body.paymentDueDay } : {}),
    ...(body.escalation !== undefined ? escalationColumns(body.escalation) : {}),
    ...(body.renewalOption !== undefined ? renewalColumns(body.renewalOption) : {}),
    ...(body.deposit !== undefined ? depositColumns(body.deposit) : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
  }
}
