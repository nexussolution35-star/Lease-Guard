import type { BankGuarantee, Deposit, Lease, LeaseStatus } from '../types/index.js'

/**
 * Lease terms: the parts of a lease that drive financial monitoring, so a change to any of them makes verified
 * terms unverified again (PRD §5.5: lease terms are verified before they are used). The database enforces the
 * same list (`private.lease_term_columns` and `private.guarantee_term_columns`,
 * supabase/migrations/20261121003917_lease_management.sql); this copy lets a form warn before saving.
 * The reference, notes, deposit receipt date, renewal notes and the guarantee's status are records, not terms.
 */
type TermsOf<L extends Lease> = {
  parties: Pick<L, 'tenantId' | 'propertyId' | 'unitId'>
  term: Pick<L, 'commencementDate' | 'expiryDate'>
  rental: Pick<L, 'initialMonthlyRental' | 'currentMonthlyRental' | 'paymentDueDay'>
  escalation: L['escalation']
  renewal: Pick<L['renewalOption'], 'exists' | 'renewalTermMonths' | 'noticePeriodMonths'>
  deposit: Pick<Deposit, 'amount' | 'basisMonths' | 'heldBy' | 'interestBearing'> | null
  guarantee: Pick<BankGuarantee, 'bank' | 'referenceNumber' | 'amount' | 'basisMonths' | 'issuedOn' | 'expiresOn'> | null
}

/** The lease's terms, with absent optional values left out so `undefined` and missing compare equal. */
function termsOf(lease: Lease): TermsOf<Lease> {
  const { escalation, renewalOption: renewal, deposit, bankGuarantee: guarantee } = lease
  return {
    parties: { tenantId: lease.tenantId, propertyId: lease.propertyId, unitId: lease.unitId },
    term: { commencementDate: lease.commencementDate, expiryDate: lease.expiryDate },
    rental: {
      initialMonthlyRental: lease.initialMonthlyRental,
      currentMonthlyRental: lease.currentMonthlyRental,
      paymentDueDay: lease.paymentDueDay,
    },
    escalation: {
      type: escalation.type,
      ...(escalation.percentage !== undefined ? { percentage: escalation.percentage } : {}),
      ...(escalation.fixedAmount !== undefined ? { fixedAmount: escalation.fixedAmount } : {}),
      ...(escalation.cpiAssumedPercentage !== undefined ? { cpiAssumedPercentage: escalation.cpiAssumedPercentage } : {}),
      ...(escalation.cpiMarginPercentage !== undefined ? { cpiMarginPercentage: escalation.cpiMarginPercentage } : {}),
      frequency: escalation.frequency,
      firstEscalationDate: escalation.firstEscalationDate,
    },
    renewal: {
      exists: renewal.exists,
      ...(renewal.renewalTermMonths !== undefined ? { renewalTermMonths: renewal.renewalTermMonths } : {}),
      ...(renewal.noticePeriodMonths !== undefined ? { noticePeriodMonths: renewal.noticePeriodMonths } : {}),
    },
    deposit: deposit
      ? {
          amount: deposit.amount,
          ...(deposit.basisMonths !== undefined ? { basisMonths: deposit.basisMonths } : {}),
          heldBy: deposit.heldBy,
          interestBearing: deposit.interestBearing,
        }
      : null,
    guarantee: guarantee
      ? {
          bank: guarantee.bank,
          referenceNumber: guarantee.referenceNumber,
          amount: guarantee.amount,
          basisMonths: guarantee.basisMonths,
          issuedOn: guarantee.issuedOn,
          expiresOn: guarantee.expiresOn,
        }
      : null,
  }
}

/** Groups of lease terms, in the order a lease form shows them. */
export const LEASE_TERM_GROUPS = ['parties', 'term', 'rental', 'escalation', 'renewal', 'deposit', 'guarantee'] as const
export type LeaseTermGroup = (typeof LEASE_TERM_GROUPS)[number]

/** The term groups that differ between two versions of a lease, in `LEASE_TERM_GROUPS` order. */
export function changedLeaseTerms(before: Lease, after: Lease): LeaseTermGroup[] {
  const a = termsOf(before)
  const b = termsOf(after)
  return LEASE_TERM_GROUPS.filter((group) => JSON.stringify(a[group]) !== JSON.stringify(b[group]))
}

/** True when saving `after` over the verified `before` will return the lease to pending verification. */
export function editRequiresReverification(before: Lease, after: Lease): boolean {
  return before.verified && changedLeaseTerms(before, after).length > 0
}

/**
 * Status of a verified lease whose terms changed: a lease in force (active or expiring) is pending verification
 * again; any other status is kept. The inverse of `leaseStatusAfterVerification`.
 */
export function leaseStatusAfterTermChange(status: LeaseStatus): LeaseStatus {
  return status === 'active' || status === 'expiring' ? 'pending_verification' : status
}
