import type { CompanyScoped, EntityId, ISODate, ISODateTime, StoredFile, ZAR } from './common.js'

export const LEASE_STATUSES = [
  'draft',
  'pending_verification',
  'active',
  'expiring',
  'expired',
  'renewed',
  'terminated',
] as const
export type LeaseStatus = (typeof LEASE_STATUSES)[number]

export const ESCALATION_TYPES = ['percentage', 'fixed_amount', 'cpi_linked', 'none'] as const
export type EscalationType = (typeof ESCALATION_TYPES)[number]

export const ESCALATION_FREQUENCIES = ['annual', 'biennial'] as const
export type EscalationFrequency = (typeof ESCALATION_FREQUENCIES)[number]

/** Agreed rental increase conditions. */
export interface LeaseEscalation {
  type: EscalationType
  /** Percentage increase per interval, e.g. 8 for 8%. Required when type is `percentage`. */
  percentage?: number
  /** Fixed rand increase per interval. Required when type is `fixed_amount`. */
  fixedAmount?: ZAR
  /** CPI-linked: assumed CPI percentage plus margin for projections. */
  cpiAssumedPercentage?: number
  cpiMarginPercentage?: number
  frequency: EscalationFrequency
  /** Date the first escalation takes effect; subsequent ones follow the frequency. */
  firstEscalationDate: ISODate
}

export interface RenewalOption {
  exists: boolean
  /** Length of the renewal term, in months. */
  renewalTermMonths?: number
  /** Written notice required before expiry, in months. */
  noticePeriodMonths?: number
  /** Whether the tenant has exercised the option. */
  exercised: boolean
  exercisedOn?: ISODate
  notes?: string
}

export const DEPOSIT_HOLDERS = ['landlord', 'managing_agent', 'attorney_trust'] as const
export type DepositHolder = (typeof DEPOSIT_HOLDERS)[number]

export interface Deposit {
  amount: ZAR
  /** Deposit expressed as months of initial rental, e.g. 2. */
  basisMonths?: number
  heldBy: DepositHolder
  receivedOn?: ISODate
  interestBearing: boolean
  notes?: string
}

export const GUARANTEE_STATUSES = ['active', 'expiring', 'expired', 'released', 'called'] as const
export type GuaranteeStatus = (typeof GUARANTEE_STATUSES)[number]

export interface BankGuarantee {
  bank: string
  referenceNumber: string
  amount: ZAR
  /** Guarantee was sized as this many months of rental at issue. */
  basisMonths: number
  issuedOn: ISODate
  expiresOn: ISODate
  status: GuaranteeStatus
  notes?: string
}

export interface Lease extends CompanyScoped {
  /** Unique lease identifier, e.g. `MSQ-L012`. */
  reference: string
  propertyId: EntityId
  unitId: EntityId
  tenantId: EntityId
  commencementDate: ISODate
  expiryDate: ISODate
  /** Rental at commencement, excluding VAT. */
  initialMonthlyRental: ZAR
  /** Current contractual rental after applied escalations, excluding VAT. */
  currentMonthlyRental: ZAR
  /** Day of month on which rental is due, 1–28. */
  paymentDueDay: number
  escalation: LeaseEscalation
  renewalOption: RenewalOption
  deposit?: Deposit
  bankGuarantee?: BankGuarantee
  status: LeaseStatus
  /** Lease terms must be verified before they are used for financial monitoring. */
  verified: boolean
  verifiedByUserId?: EntityId
  verifiedAt?: ISODateTime
  /** Lease this one renewed, if any. */
  previousLeaseId?: EntityId
  notes?: string
}

export const LEASE_DOCUMENT_TYPES = [
  'signed_lease',
  'addendum',
  'renewal_agreement',
  'bank_guarantee',
  'deposit_receipt',
  'fica',
  'other',
] as const
export type LeaseDocumentType = (typeof LEASE_DOCUMENT_TYPES)[number]

export interface LeaseDocument extends CompanyScoped {
  leaseId: EntityId
  documentType: LeaseDocumentType
  title: string
  file: StoredFile
  uploadedByUserId: EntityId
  uploadedAt: ISODateTime
}
