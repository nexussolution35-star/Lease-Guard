import type { BankGuaranteeRow, LeaseRow } from './lease-rows'

export const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
export const VERIFIER = '6f1d2c1e-0000-4000-8000-0000000000b1'

/** A verified percentage-escalation lease with a deposit and a renewal option. */
export const leaseRow: LeaseRow = {
  id: '6f1d2c1e-0000-4000-8000-0000000000f1',
  company_id: COMPANY,
  reference: 'MSQ-L012',
  property_id: '6f1d2c1e-0000-4000-8000-0000000000aa',
  unit_id: '6f1d2c1e-0000-4000-8000-0000000000d1',
  tenant_id: '6f1d2c1e-0000-4000-8000-0000000000e1',
  commencement_date: '2024-03-01',
  expiry_date: '2029-02-28',
  initial_monthly_rental: 25000,
  current_monthly_rental: 27000,
  payment_due_day: 1,
  escalation_type: 'percentage',
  escalation_percentage: 8,
  escalation_fixed_amount: null,
  escalation_cpi_assumed_percentage: null,
  escalation_cpi_margin_percentage: null,
  escalation_frequency: 'annual',
  first_escalation_date: '2025-03-01',
  renewal_option_exists: true,
  renewal_term_months: 60,
  renewal_notice_period_months: 6,
  renewal_exercised: false,
  renewal_exercised_on: null,
  renewal_notes: null,
  deposit_amount: 50000,
  deposit_basis_months: 2,
  deposit_held_by: 'managing_agent',
  deposit_received_on: '2024-02-15',
  deposit_interest_bearing: true,
  deposit_notes: null,
  status: 'active',
  verified: true,
  verified_by_user_id: VERIFIER,
  verified_at: '2024-02-20T10:00:00+00:00',
  previous_lease_id: null,
  notes: null,
  created_at: '2024-02-10T08:00:00+00:00',
  updated_at: '2024-02-20T10:00:00+00:00',
}

/** The same lease awaiting verification. */
export const unverifiedLeaseRow: LeaseRow = {
  ...leaseRow,
  status: 'pending_verification',
  verified: false,
  verified_by_user_id: null,
  verified_at: null,
}

export const guaranteeRow: BankGuaranteeRow = {
  id: '6f1d2c1e-0000-4000-8000-0000000000a9',
  company_id: COMPANY,
  lease_id: leaseRow.id,
  bank: 'Standard Bank',
  reference_number: 'GTE-88341',
  amount: 75000,
  basis_months: 3,
  issued_on: '2024-02-15',
  expires_on: '2027-02-14',
  status: 'active',
  notes: null,
  created_at: '2024-02-15T08:00:00+00:00',
  updated_at: '2024-02-15T08:00:00+00:00',
}
