import {
  compareISODate,
  DEPOSIT_HOLDERS,
  ESCALATION_FREQUENCIES,
  ESCALATION_TYPES,
  isValidISODate,
  type BankGuarantee,
  type DepositHolder,
  type Lease,
} from '@leaseguard/domain'
import type { FieldPath } from 'react-hook-form'
import { z } from 'zod'

import type { LeaseChanges, NewLease } from './api/source'

// --------------------------------------------------------------------------- field rules (the API's, in words)

const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`)

/** Rand amount (ZAR, excl. VAT) with at most two cents decimals, as the API stores it (numeric(14,2)). */
const rand = (blank: string) =>
  z
    .number({ error: blank })
    .min(0, 'The amount cannot be negative')
    .max(999_999_999_999.99, 'The amount is too large')
    .refine((value) => Math.round(value * 100) / 100 === value, { message: 'Use at most two decimals' })

/** Percentage with at most three decimals (numeric(7,3)), e.g. 8 for 8%. */
const percentage = (min: number) =>
  z
    .number()
    .min(min, `Use ${min}% or more`)
    .max(1000, 'Use at most 1000%')
    .refine((value) => Math.round(value * 1000) / 1000 === value, { message: 'Use at most three decimals' })

/** Months of rental (numeric(5,2)), more than 0. */
const months = z
  .number()
  .positive('Use more than 0 months')
  .max(999.99, 'Use at most 999.99 months')
  .refine((value) => Math.round(value * 100) / 100 === value, { message: 'Use at most two decimals' })

const wholeMonths = (min: number, max: number) =>
  z.number().int('Use whole months').min(min, `Use ${min} or more months`).max(max, `Use at most ${max} months`)

const date = (blank: string) => z.string({ error: blank }).refine(isValidISODate, { message: blank })
const optionalDate = z.string().refine(isValidISODate, { message: 'Choose a calendar date' }).optional()

const required = (ctx: z.RefinementCtx, path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })

// --------------------------------------------------------------------------- the form

/** The amount field each escalation type needs (the database's `leases_escalation_terms_check`). */
const ESCALATION_AMOUNT = {
  percentage: { field: 'percentage', message: 'Enter the escalation percentage' },
  fixed_amount: { field: 'fixedAmount', message: 'Enter the fixed increase' },
  cpi_linked: { field: 'cpiAssumedPercentage', message: 'Enter the assumed CPI' },
  none: null,
} as const

const escalationSchema = z
  .object({
    type: z.enum(ESCALATION_TYPES, { error: 'Choose the escalation type' }),
    percentage: percentage(0).optional(),
    fixedAmount: rand('Enter the fixed increase').optional(),
    cpiAssumedPercentage: percentage(0).optional(),
    cpiMarginPercentage: percentage(-1000).optional(),
    frequency: z.enum(ESCALATION_FREQUENCIES, { error: 'Choose how often it escalates' }),
    firstEscalationDate: optionalDate,
  })
  .superRefine((escalation, ctx) => {
    const amount = ESCALATION_AMOUNT[escalation.type]
    if (amount && escalation[amount.field] === undefined) required(ctx, amount.field, amount.message)
    if (escalation.type !== 'none' && escalation.firstEscalationDate === undefined) {
      required(ctx, 'firstEscalationDate', 'Choose the date of the first escalation')
    }
  })

const renewalSchema = z.object({
  exists: z.boolean(),
  renewalTermMonths: wholeMonths(1, 600).optional(),
  noticePeriodMonths: wholeMonths(0, 120).optional(),
  notes: text(2000),
})

/** `held` says whether the lease records a deposit; the other fields are required only then. */
const depositSchema = z
  .object({
    held: z.boolean(),
    amount: rand('Enter the deposit amount').optional(),
    basisMonths: months.optional(),
    heldBy: z.union([z.enum(DEPOSIT_HOLDERS), z.literal('')]),
    receivedOn: optionalDate,
    interestBearing: z.boolean(),
    notes: text(2000),
  })
  .superRefine((deposit, ctx) => {
    if (!deposit.held) return
    if (deposit.amount === undefined) required(ctx, 'amount', 'Enter the deposit amount')
    if (deposit.heldBy === '') required(ctx, 'heldBy', 'Choose who holds the deposit')
  })

/** `held` says whether the lease has a bank guarantee; every field but the notes is required then. */
const guaranteeSchema = z
  .object({
    held: z.boolean(),
    bank: text(200),
    referenceNumber: text(100),
    amount: rand('Enter the guaranteed amount').optional(),
    basisMonths: months.optional(),
    issuedOn: optionalDate,
    expiresOn: optionalDate,
    notes: text(2000),
  })
  .superRefine((guarantee, ctx) => {
    if (!guarantee.held) return
    if (guarantee.bank === '') required(ctx, 'bank', 'Enter the bank')
    if (guarantee.referenceNumber === '') required(ctx, 'referenceNumber', 'Enter the guarantee reference')
    if (guarantee.amount === undefined) required(ctx, 'amount', 'Enter the guaranteed amount')
    if (guarantee.basisMonths === undefined) required(ctx, 'basisMonths', 'Enter the months of rental it covers')
    if (guarantee.issuedOn === undefined) required(ctx, 'issuedOn', 'Choose the issue date')
    if (guarantee.expiresOn === undefined) required(ctx, 'expiresOn', 'Choose the expiry date')
    else if (guarantee.issuedOn !== undefined && compareISODate(guarantee.expiresOn, guarantee.issuedOn) <= 0) {
      required(ctx, 'expiresOn', 'The guarantee must expire after its issue date')
    }
  })

/**
 * The lease form (create and edit) with the API's rules, grouped as the form shows them: parties, term, rental and
 * escalation, renewal, deposit and guarantee. Field names follow the API body, so an API refusal naming a path
 * (`escalation.percentage: …`) lands on the field it concerns. Every rule is enforced again by the API and the
 * database; the form only says so sooner.
 */
export const leaseFormSchema = z
  .object({
    reference: text(40)
      .toUpperCase()
      .min(1, 'Enter the lease reference')
      .regex(/^[A-Z0-9][A-Z0-9/-]*$/, 'Use letters, digits, hyphens or slashes, e.g. MSQ-L012'),
    tenantId: z.string().min(1, 'Choose the tenant'),
    propertyId: z.string().min(1, 'Choose the property'),
    unitId: z.string().min(1, 'Choose the unit'),
    commencementDate: date('Choose the commencement date'),
    expiryDate: date('Choose the expiry date'),
    initialMonthlyRental: rand('Enter the monthly rental at commencement'),
    /** Empty means the initial rental (the API's default on create). */
    currentMonthlyRental: rand('Enter the current monthly rental').optional(),
    paymentDueDay: z
      .number({ error: 'Enter the day rental is due' })
      .int('Use a whole day')
      .min(1, 'Use a day from 1 to 28')
      .max(28, 'Use a day from 1 to 28'),
    escalation: escalationSchema,
    renewalOption: renewalSchema,
    deposit: depositSchema,
    bankGuarantee: guaranteeSchema,
    notes: text(4000),
  })
  .refine((lease) => compareISODate(lease.expiryDate, lease.commencementDate) > 0, {
    path: ['expiryDate'],
    message: 'The lease must expire after it commences',
  })

export type LeaseFormInput = z.input<typeof leaseFormSchema>
export type LeaseFormValues = z.output<typeof leaseFormSchema>
export type LeaseFormField = FieldPath<LeaseFormInput>

/** Fields a person fills in later: the form starts them empty, never with a guessed value. */
const unset = <T>() => undefined as unknown as T

/** Empty form for a new lease. Nothing is assumed: no deposit, no guarantee and no renewal option until ticked. */
export function newLeaseFormDefaults(): LeaseFormInput {
  return {
    reference: '',
    tenantId: '',
    propertyId: '',
    unitId: '',
    commencementDate: unset(),
    expiryDate: unset(),
    initialMonthlyRental: unset(),
    paymentDueDay: unset(),
    escalation: { type: unset(), frequency: 'annual' },
    renewalOption: { exists: false, notes: '' },
    deposit: { held: false, heldBy: '', interestBearing: false, notes: '' },
    bankGuarantee: { held: false, bank: '', referenceNumber: '', notes: '' },
    notes: '',
  }
}

/** Form values for an existing lease. */
export function leaseFormDefaults(lease: Lease): LeaseFormInput {
  const { escalation, renewalOption: renewal, deposit, bankGuarantee: guarantee } = lease
  return {
    reference: lease.reference,
    tenantId: lease.tenantId,
    propertyId: lease.propertyId,
    unitId: lease.unitId,
    commencementDate: lease.commencementDate,
    expiryDate: lease.expiryDate,
    initialMonthlyRental: lease.initialMonthlyRental,
    currentMonthlyRental: lease.currentMonthlyRental,
    paymentDueDay: lease.paymentDueDay,
    escalation: {
      type: escalation.type,
      percentage: escalation.percentage,
      fixedAmount: escalation.fixedAmount,
      cpiAssumedPercentage: escalation.cpiAssumedPercentage,
      cpiMarginPercentage: escalation.cpiMarginPercentage,
      frequency: escalation.frequency,
      firstEscalationDate: escalation.firstEscalationDate,
    },
    renewalOption: {
      exists: renewal.exists,
      renewalTermMonths: renewal.renewalTermMonths,
      noticePeriodMonths: renewal.noticePeriodMonths,
      notes: renewal.notes ?? '',
    },
    deposit: deposit
      ? {
          held: true,
          amount: deposit.amount,
          basisMonths: deposit.basisMonths,
          heldBy: deposit.heldBy,
          receivedOn: deposit.receivedOn,
          interestBearing: deposit.interestBearing,
          notes: deposit.notes ?? '',
        }
      : { held: false, heldBy: '', interestBearing: false, notes: '' },
    bankGuarantee: guarantee
      ? {
          held: true,
          bank: guarantee.bank,
          referenceNumber: guarantee.referenceNumber,
          amount: guarantee.amount,
          basisMonths: guarantee.basisMonths,
          issuedOn: guarantee.issuedOn,
          expiresOn: guarantee.expiresOn,
          notes: guarantee.notes ?? '',
        }
      : { held: false, bank: '', referenceNumber: '', notes: '' },
    notes: lease.notes ?? '',
  }
}

// --------------------------------------------------------------------------- form → API body

type Escalation = NewLease['escalation']
type Renewal = NewLease['renewalOption']
type DepositBody = NonNullable<NewLease['deposit']>
type GuaranteeBody = NonNullable<NewLease['bankGuarantee']>

const ifDefined = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>)
const ifText = <K extends string>(key: K, value: string): Partial<Record<K, string>> => (value === '' ? {} : ({ [key]: value } as Record<K, string>))

/**
 * The escalation group: only the amount fields its type uses. A lease without an escalation clause still has a
 * frequency and first escalation date in the database; they are not shown, so the saved date (or, on a new lease, the
 * commencement date) is sent and nothing drives monitoring from it.
 */
function escalationFrom(values: LeaseFormValues): Escalation {
  const { escalation } = values
  return {
    type: escalation.type,
    ...(escalation.type === 'percentage' ? ifDefined('percentage', escalation.percentage) : {}),
    ...(escalation.type === 'fixed_amount' ? ifDefined('fixedAmount', escalation.fixedAmount) : {}),
    ...(escalation.type === 'cpi_linked'
      ? { ...ifDefined('cpiAssumedPercentage', escalation.cpiAssumedPercentage), ...ifDefined('cpiMarginPercentage', escalation.cpiMarginPercentage) }
      : {}),
    frequency: escalation.frequency,
    firstEscalationDate: escalation.firstEscalationDate ?? values.commencementDate,
  }
}

/** Without a renewal option its term and notice period are not sent (they are cleared); the notes are kept. */
function renewalFrom({ renewalOption: renewal }: LeaseFormValues): Renewal {
  return {
    exists: renewal.exists,
    ...(renewal.exists ? { ...ifDefined('renewalTermMonths', renewal.renewalTermMonths), ...ifDefined('noticePeriodMonths', renewal.noticePeriodMonths) } : {}),
    ...ifText('notes', renewal.notes),
  }
}

function depositFrom({ deposit }: LeaseFormValues): DepositBody | null {
  if (!deposit.held || deposit.amount === undefined || deposit.heldBy === '') return null
  return {
    amount: deposit.amount,
    ...ifDefined('basisMonths', deposit.basisMonths),
    heldBy: deposit.heldBy,
    ...ifDefined('receivedOn', deposit.receivedOn),
    interestBearing: deposit.interestBearing,
    ...ifText('notes', deposit.notes),
  }
}

function guaranteeFrom({ bankGuarantee: guarantee }: LeaseFormValues): GuaranteeBody | null {
  const { amount, basisMonths, issuedOn, expiresOn } = guarantee
  if (!guarantee.held || amount === undefined || basisMonths === undefined || issuedOn === undefined || expiresOn === undefined) return null
  return {
    bank: guarantee.bank,
    referenceNumber: guarantee.referenceNumber,
    amount,
    basisMonths,
    issuedOn,
    expiresOn,
    ...ifText('notes', guarantee.notes),
  }
}

/** The `POST /leases` body. An empty current rental is left out (the API uses the initial rental); so are empty notes. */
export function newLeaseFrom(values: LeaseFormValues): NewLease {
  const deposit = depositFrom(values)
  const guarantee = guaranteeFrom(values)
  return {
    reference: values.reference,
    tenantId: values.tenantId,
    propertyId: values.propertyId,
    unitId: values.unitId,
    commencementDate: values.commencementDate,
    expiryDate: values.expiryDate,
    initialMonthlyRental: values.initialMonthlyRental,
    ...ifDefined('currentMonthlyRental', values.currentMonthlyRental),
    paymentDueDay: values.paymentDueDay,
    escalation: escalationFrom(values),
    renewalOption: renewalFrom(values),
    ...(deposit ? { deposit } : {}),
    ...(guarantee ? { bankGuarantee: guarantee } : {}),
    ...ifText('notes', values.notes),
  }
}

/**
 * The `PATCH /leases/{id}` body for what differs from the saved lease, or null when nothing changed. Escalation,
 * renewal option, deposit and guarantee each go as the whole group (null removes the deposit or guarantee); a new
 * property goes with its unit; an emptied current rental means the initial rental; emptied notes send null.
 */
export function leaseChangesFrom(values: LeaseFormValues, lease: Lease): LeaseChanges | null {
  const saved = leaseFormSchema.safeParse(leaseFormDefaults(lease))
  const before = saved.success ? saved.data : null
  const differs = <T>(pick: (form: LeaseFormValues) => T) => before === null || JSON.stringify(pick(values)) !== JSON.stringify(pick(before))

  const changes: LeaseChanges = {}
  if (differs((form) => form.reference)) changes.reference = values.reference
  if (differs((form) => form.tenantId)) changes.tenantId = values.tenantId
  if (differs((form) => form.propertyId)) {
    changes.propertyId = values.propertyId
    changes.unitId = values.unitId
  } else if (differs((form) => form.unitId)) changes.unitId = values.unitId
  if (differs((form) => form.commencementDate)) changes.commencementDate = values.commencementDate
  if (differs((form) => form.expiryDate)) changes.expiryDate = values.expiryDate
  if (differs((form) => form.initialMonthlyRental)) changes.initialMonthlyRental = values.initialMonthlyRental
  const currentRental = values.currentMonthlyRental ?? values.initialMonthlyRental
  if (before === null || currentRental !== (before.currentMonthlyRental ?? before.initialMonthlyRental)) changes.currentMonthlyRental = currentRental
  if (differs((form) => form.paymentDueDay)) changes.paymentDueDay = values.paymentDueDay
  if (differs(escalationFrom)) changes.escalation = escalationFrom(values)
  if (differs(renewalFrom)) changes.renewalOption = renewalFrom(values)
  if (differs(depositFrom)) changes.deposit = depositFrom(values)
  if (differs(guaranteeFrom)) changes.bankGuarantee = guaranteeFrom(values)
  if (differs((form) => form.notes)) changes.notes = values.notes === '' ? null : values.notes
  return Object.keys(changes).length > 0 ? changes : null
}

/**
 * The lease as it will read once `changes` are saved, so `editRequiresReverification` (in `@leaseguard/domain`) can
 * warn before the save. Verification and the renewal exercise are untouched here; the database decides those.
 */
export function leaseWithChanges(lease: Lease, changes: LeaseChanges): Lease {
  const { escalation, renewalOption, deposit, bankGuarantee, notes, ...scalars } = changes
  const next: Lease = { ...lease, ...scalars }
  if (escalation) next.escalation = escalation
  if (renewalOption) {
    next.renewalOption = {
      ...renewalOption,
      exercised: lease.renewalOption.exercised,
      ...(lease.renewalOption.exercisedOn ? { exercisedOn: lease.renewalOption.exercisedOn } : {}),
    }
  }
  if (deposit === null) delete next.deposit
  else if (deposit) next.deposit = { ...deposit, heldBy: deposit.heldBy as DepositHolder }
  if (bankGuarantee === null) delete next.bankGuarantee
  else if (bankGuarantee) next.bankGuarantee = { ...bankGuarantee, status: lease.bankGuarantee?.status ?? ('active' satisfies BankGuarantee['status']) }
  if (notes === null) delete next.notes
  else if (notes !== undefined) next.notes = notes
  return next
}

// --------------------------------------------------------------------------- API refusals → fields

const FORM_PATHS: ReadonlySet<string> = new Set([
  'reference',
  'tenantId',
  'propertyId',
  'unitId',
  'commencementDate',
  'expiryDate',
  'initialMonthlyRental',
  'currentMonthlyRental',
  'paymentDueDay',
  ...['type', 'percentage', 'fixedAmount', 'cpiAssumedPercentage', 'cpiMarginPercentage', 'frequency', 'firstEscalationDate'].map((field) => `escalation.${field}`),
  ...['exists', 'renewalTermMonths', 'noticePeriodMonths', 'notes'].map((field) => `renewalOption.${field}`),
  ...['amount', 'basisMonths', 'heldBy', 'receivedOn', 'interestBearing', 'notes'].map((field) => `deposit.${field}`),
  ...['bank', 'referenceNumber', 'amount', 'basisMonths', 'issuedOn', 'expiresOn', 'notes'].map((field) => `bankGuarantee.${field}`),
  'notes',
])

export interface LeaseFieldError {
  field: LeaseFormField
  message: string
}

const sentence = (text: string) => {
  const trimmed = text.trim()
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`
}

/**
 * Where an API refusal belongs in the form. A 400 lists `path: message` per problem, each placed on its field; a taken
 * reference (409) goes on the reference; a tenant, property or unit outside the workspace or an archived property
 * (422) on that party. Returns an empty list when the refusal concerns the lease as a whole (such as the parties of a
 * lease in use), which the form shows above its sections.
 */
export function leaseFieldErrors(status: number, messages: readonly string[]): LeaseFieldError[] {
  if (status === 400) {
    return messages.flatMap((message) => {
      const match = /^([\w.]+): (.+)$/.exec(message)
      if (!match?.[1] || !match[2] || !FORM_PATHS.has(match[1])) return []
      return [{ field: match[1] as LeaseFormField, message: sentence(match[2]) }]
    })
  }
  const message = sentence(messages.join('. '))
  if (status === 409) return [{ field: 'reference', message }]
  if (status === 422) {
    if (/^the tenant is not/i.test(message)) return [{ field: 'tenantId', message }]
    if (/^the property is not|archived/i.test(message)) return [{ field: 'propertyId', message }]
    if (/^the unit is not/i.test(message)) return [{ field: 'unitId', message }]
  }
  return []
}
