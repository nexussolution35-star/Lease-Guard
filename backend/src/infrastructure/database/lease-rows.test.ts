import { describe, expect, it } from 'vitest'

import { toLease, toLeaseFromQuery } from './lease-rows'
import { guaranteeRow, leaseRow, unverifiedLeaseRow, VERIFIER } from './lease-rows.test-helpers'

describe('lease rows', () => {
  it('maps every lease term, including escalation, renewal, deposit and bank guarantee', () => {
    expect(toLease(leaseRow, guaranteeRow)).toEqual({
      id: leaseRow.id,
      companyId: leaseRow.company_id,
      reference: 'MSQ-L012',
      propertyId: leaseRow.property_id,
      unitId: leaseRow.unit_id,
      tenantId: leaseRow.tenant_id,
      commencementDate: '2024-03-01',
      expiryDate: '2029-02-28',
      initialMonthlyRental: 25000,
      currentMonthlyRental: 27000,
      paymentDueDay: 1,
      escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2025-03-01' },
      renewalOption: { exists: true, renewalTermMonths: 60, noticePeriodMonths: 6, exercised: false },
      deposit: {
        amount: 50000,
        basisMonths: 2,
        heldBy: 'managing_agent',
        receivedOn: '2024-02-15',
        interestBearing: true,
      },
      bankGuarantee: {
        bank: 'Standard Bank',
        referenceNumber: 'GTE-88341',
        amount: 75000,
        basisMonths: 3,
        issuedOn: '2024-02-15',
        expiresOn: '2027-02-14',
        status: 'active',
      },
      status: 'active',
      verified: true,
      verifiedByUserId: VERIFIER,
      verifiedAt: '2024-02-20T10:00:00+00:00',
      createdAt: leaseRow.created_at,
      updatedAt: leaseRow.updated_at,
    })
  })

  it('keeps zero-valued terms and maps CPI-linked escalation', () => {
    const lease = toLease(
      {
        ...leaseRow,
        escalation_type: 'cpi_linked',
        escalation_percentage: null,
        escalation_cpi_assumed_percentage: 5.2,
        escalation_cpi_margin_percentage: 0,
        renewal_notice_period_months: 0,
      },
      null,
    )
    expect(lease.escalation).toEqual({
      type: 'cpi_linked',
      cpiAssumedPercentage: 5.2,
      cpiMarginPercentage: 0,
      frequency: 'annual',
      firstEscalationDate: '2025-03-01',
    })
    expect(lease.renewalOption.noticePeriodMonths).toBe(0)
  })

  it('omits the deposit, guarantee and verification stamp when absent', () => {
    const lease = toLease(
      {
        ...unverifiedLeaseRow,
        deposit_amount: null,
        deposit_basis_months: null,
        deposit_held_by: null,
        deposit_received_on: null,
        deposit_interest_bearing: null,
      },
      undefined,
    )
    expect(lease).toMatchObject({ verified: false, status: 'pending_verification' })
    expect(lease).not.toHaveProperty('deposit')
    expect(lease).not.toHaveProperty('bankGuarantee')
    expect(lease).not.toHaveProperty('verifiedByUserId')
    expect(lease).not.toHaveProperty('verifiedAt')
  })

  it('maps an exercised renewal, a renewed-from lease and notes', () => {
    const lease = toLease(
      {
        ...leaseRow,
        renewal_exercised: true,
        renewal_exercised_on: '2028-08-01',
        renewal_notes: 'Exercised by letter',
        previous_lease_id: '6f1d2c1e-0000-4000-8000-0000000000f0',
        notes: 'Anchor tenant',
      },
      null,
    )
    expect(lease.renewalOption).toMatchObject({ exercised: true, exercisedOn: '2028-08-01', notes: 'Exercised by letter' })
    expect(lease).toMatchObject({ previousLeaseId: '6f1d2c1e-0000-4000-8000-0000000000f0', notes: 'Anchor tenant' })
  })

  it('takes the guarantee from the embedded relation and drops the relation itself', () => {
    const withGuarantee = toLeaseFromQuery({ ...leaseRow, lease_bank_guarantees: [guaranteeRow] })
    const without = toLeaseFromQuery({ ...leaseRow, lease_bank_guarantees: [] })

    expect(withGuarantee.bankGuarantee?.referenceNumber).toBe('GTE-88341')
    expect(withGuarantee).not.toHaveProperty('lease_bank_guarantees')
    expect(without).not.toHaveProperty('bankGuarantee')
  })
})
