import {
  compareISODate,
  DEPOSIT_HOLDERS,
  ESCALATION_FREQUENCIES,
  ESCALATION_TYPES,
  isValidISODate,
  LEASE_STATUSES,
  MAX_EXPIRING_WITHIN_DAYS,
} from '@leaseguard/domain'
import { z } from 'zod'

import { listQuerySchema } from '../../common/http/pagination'

export const LEASE_SORT_FIELDS = ['reference', 'commencementDate', 'expiryDate', 'currentMonthlyRental', 'createdAt'] as const

/** Query-string boolean: only the literals `true` and `false` are accepted. */
const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true')

export const leaseListQuerySchema = listQuerySchema(LEASE_SORT_FIELDS, {
  status: z.enum(LEASE_STATUSES).optional(),
  propertyId: z.uuid().optional(),
  unitId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
  verified: queryBoolean.optional(),
  /** Leases expiring between today (South African date) and this many days from today, inclusive. */
  expiresWithinDays: z.coerce.number().int().min(0).max(MAX_EXPIRING_WITHIN_DAYS).optional(),
})
export type LeaseListQuery = z.infer<typeof leaseListQuerySchema>

/** API sort field → database column. */
export const LEASE_SORT_COLUMNS = {
  reference: 'reference',
  commencementDate: 'commencement_date',
  expiryDate: 'expiry_date',
  currentMonthlyRental: 'current_monthly_rental',
  createdAt: 'created_at',
} as const satisfies Record<(typeof LEASE_SORT_FIELDS)[number], string>

// --------------------------------------------------------------------------- create and edit (ticket M5-01)

const isoDate = z.string().refine(isValidISODate, 'must be a calendar date (YYYY-MM-DD)')

/** Rand amount (ZAR) with at most two decimals (numeric(14,2)). Compared after rounding: value * 100 is often not exact. */
const rand = z
  .number()
  .min(0, 'must be 0 or more')
  .max(999_999_999_999.99, 'is too large')
  .refine((value) => Math.round(value * 100) / 100 === value, { message: 'must have at most two decimals' })

/** Percentage with at most three decimals (numeric(7,3)), e.g. 8 for 8%. */
const percentage = (min: number) =>
  z
    .number()
    .min(min, `must be ${min} or more`)
    .max(1000, 'must be at most 1000')
    .refine((value) => Math.round(value * 1000) / 1000 === value, { message: 'must have at most three decimals' })

/** Months of rental (numeric(5,2)), more than 0. */
const months = z
  .number()
  .positive('must be more than 0')
  .max(999.99, 'must be at most 999.99')
  .refine((value) => Math.round(value * 100) / 100 === value, { message: 'must have at most two decimals' })

const text = (max: number) => z.string().trim().max(max, `must be at most ${max} characters`)

/** Optional text that can be cleared: '' or null clears it, omitted leaves it unchanged. */
const clearableText = (max: number) =>
  text(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()

const requiredText = (max: number, blank: string) => text(max).refine((value) => value !== '', { message: blank })

/** The amount field each escalation type needs (the database's leases_escalation_terms_check). */
const ESCALATION_AMOUNT_FIELD = {
  percentage: 'percentage',
  fixed_amount: 'fixedAmount',
  cpi_linked: 'cpiAssumedPercentage',
  none: null,
} as const satisfies Record<(typeof ESCALATION_TYPES)[number], string | null>

/** The escalation replaces the whole escalation; the amount field its type names is required. */
export const leaseEscalationSchema = z
  .strictObject({
    type: z.enum(ESCALATION_TYPES),
    percentage: percentage(0).optional(),
    fixedAmount: rand.optional(),
    cpiAssumedPercentage: percentage(0).optional(),
    cpiMarginPercentage: percentage(-1000).optional(),
    frequency: z.enum(ESCALATION_FREQUENCIES),
    firstEscalationDate: isoDate,
  })
  .superRefine((escalation, ctx) => {
    const required = ESCALATION_AMOUNT_FIELD[escalation.type]
    if (required && escalation[required] === undefined) {
      ctx.addIssue({ code: 'custom', path: [required], message: `is required for a ${escalation.type.replace('_', ' ')} escalation` })
    }
  })

/** Whether the lease grants a renewal option, its term and the written notice it needs. Exercising it is separate. */
export const leaseRenewalSchema = z.strictObject({
  exists: z.boolean(),
  renewalTermMonths: z.number().int().min(1, 'must be at least 1').max(600, 'must be at most 600').optional(),
  noticePeriodMonths: z.number().int().min(0, 'must be 0 or more').max(120, 'must be at most 120').optional(),
  notes: text(2000).optional(),
})

export const leaseDepositSchema = z.strictObject({
  amount: rand,
  basisMonths: months.optional(),
  heldBy: z.enum(DEPOSIT_HOLDERS),
  receivedOn: isoDate.optional(),
  interestBearing: z.boolean(),
  notes: text(2000).optional(),
})

/** The bank guarantee's status (released, called) is its lifecycle and is not set here. */
export const leaseGuaranteeSchema = z
  .strictObject({
    bank: requiredText(200, 'Enter the bank'),
    referenceNumber: requiredText(100, 'Enter the guarantee reference'),
    amount: rand,
    basisMonths: months,
    issuedOn: isoDate,
    expiresOn: isoDate,
    notes: text(2000).optional(),
  })
  .refine((guarantee) => compareISODate(guarantee.expiresOn, guarantee.issuedOn) > 0, {
    path: ['expiresOn'],
    message: 'must be after the issue date',
  })

/** Statuses a new lease can start in; verification makes it active, and later statuses follow the lease's life. */
export const LEASE_INITIAL_STATUSES = ['draft', 'pending_verification'] as const

const leaseFields = {
  reference: text(40)
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9/-]*$/, 'must be letters, digits, hyphens or slashes, e.g. MSQ-L012'),
  tenantId: z.uuid(),
  propertyId: z.uuid(),
  unitId: z.uuid(),
  commencementDate: isoDate,
  expiryDate: isoDate,
  initialMonthlyRental: rand,
  currentMonthlyRental: rand,
  paymentDueDay: z.number().int().min(1, 'must be between 1 and 28').max(28, 'must be between 1 and 28'),
  escalation: leaseEscalationSchema,
  renewalOption: leaseRenewalSchema,
  deposit: leaseDepositSchema.nullable(),
  bankGuarantee: leaseGuaranteeSchema.nullable(),
  notes: clearableText(4000),
}

const expiryAfterCommencement = <T extends { commencementDate?: string; expiryDate?: string }>(lease: T) =>
  lease.commencementDate === undefined || lease.expiryDate === undefined || compareISODate(lease.expiryDate, lease.commencementDate) > 0

/**
 * Body of POST /leases. The reference is upper-cased and unique in the company; the unit must be in the property and
 * all three in the company. A new lease is unverified; the current rental defaults to the initial rental.
 */
export const createLeaseBodySchema = z
  .strictObject({
    reference: leaseFields.reference,
    tenantId: leaseFields.tenantId,
    propertyId: leaseFields.propertyId,
    unitId: leaseFields.unitId,
    commencementDate: leaseFields.commencementDate,
    expiryDate: leaseFields.expiryDate,
    initialMonthlyRental: leaseFields.initialMonthlyRental,
    currentMonthlyRental: leaseFields.currentMonthlyRental.optional(),
    paymentDueDay: leaseFields.paymentDueDay,
    escalation: leaseFields.escalation,
    renewalOption: leaseFields.renewalOption,
    deposit: leaseFields.deposit.optional(),
    bankGuarantee: leaseFields.bankGuarantee.optional(),
    status: z.enum(LEASE_INITIAL_STATUSES).optional(),
    notes: leaseFields.notes,
  })
  .refine(expiryAfterCommencement, { path: ['expiryDate'], message: 'must be after the commencement date' })
export type CreateLeaseBody = z.infer<typeof createLeaseBodySchema>

/**
 * Body of PATCH /leases/:leaseId: omitted fields are unchanged; escalation, renewal option, deposit and bank guarantee
 * each replace the whole group, and null removes the deposit or the guarantee.
 */
export const updateLeaseBodySchema = z
  .strictObject({
    reference: leaseFields.reference.optional(),
    tenantId: leaseFields.tenantId.optional(),
    propertyId: leaseFields.propertyId.optional(),
    unitId: leaseFields.unitId.optional(),
    commencementDate: leaseFields.commencementDate.optional(),
    expiryDate: leaseFields.expiryDate.optional(),
    initialMonthlyRental: leaseFields.initialMonthlyRental.optional(),
    currentMonthlyRental: leaseFields.currentMonthlyRental.optional(),
    paymentDueDay: leaseFields.paymentDueDay.optional(),
    escalation: leaseFields.escalation.optional(),
    renewalOption: leaseFields.renewalOption.optional(),
    deposit: leaseFields.deposit.optional(),
    bankGuarantee: leaseFields.bankGuarantee.optional(),
    notes: leaseFields.notes,
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'Change at least one field' })
  .refine(expiryAfterCommencement, { path: ['expiryDate'], message: 'must be after the commencement date' })
  // The unit belongs to one property, so a new property needs its unit; a unit alone may move within the property.
  .refine((body) => body.propertyId === undefined || body.unitId !== undefined, {
    path: ['unitId'],
    message: 'send the unit with the property',
  })
export type UpdateLeaseBody = z.infer<typeof updateLeaseBodySchema>
