import {
  INSTALLMENT_FREQUENCIES,
  isValidISODate,
  roundZar,
  type ArrangementTerms,
  type ISODate,
  type PaymentArrangement,
} from '@leaseguard/domain'
import { z } from 'zod'

import type { ArrangementChanges, NewArrangement } from './api/source'

// --------------------------------------------------------------------------- field rules (the API's, in words)

/** Rand amount (ZAR) above zero with at most two decimals, as the API stores it (numeric(14,2)). */
const rand = (blank: string) =>
  z
    .number({ error: blank })
    .positive('The amount must be more than R 0,00')
    .max(999_999_999_999.99, 'The amount is too large')
    .refine((value) => roundZar(value) === value, { message: 'Use at most two decimals' })

const date = (blank: string) => z.string({ error: blank }).refine(isValidISODate, { message: blank })

/** A new arrangement is recorded as agreed and in force, or as proposed (not yet in force). */
export const NEW_ARRANGEMENT_STATUSES = ['active', 'proposed'] as const

/**
 * The arrangement form (record and edit). Field names follow the API body. The rules across fields (the instalment
 * against the balance, the dates against each other and today, the number of instalments) are the domain's
 * `arrangementTermsProblems`, which the dialog shows as the terms are typed; the database checks them all again.
 */
export const arrangementFormSchema = z.object({
  tenantId: z.string().min(1, 'Choose the tenant'),
  leaseId: z.string().min(1, 'Choose the lease the arrears are under'),
  /** The chosen lease's property (set with the lease, not chosen on its own). */
  propertyId: z.string().min(1, 'Choose the lease the arrears are under'),
  outstandingBalance: rand('Enter the outstanding balance agreed'),
  installmentAmount: rand('Enter the instalment amount'),
  frequency: z.enum(INSTALLMENT_FREQUENCIES, { error: 'Choose how often an instalment is due' }),
  agreedOn: date('Choose the date it was agreed'),
  firstInstallmentDate: date('Choose the date of the first instalment'),
  status: z.enum(NEW_ARRANGEMENT_STATUSES),
  notes: z.string().trim().max(4000, 'Use at most 4000 characters'),
})

export type ArrangementFormInput = z.input<typeof arrangementFormSchema>
export type ArrangementFormValues = z.output<typeof arrangementFormSchema>

/** Fields a person fills in: the form starts them empty, never with a guessed value. */
const unset = <T>() => undefined as unknown as T

/** An empty form for a new arrangement, agreed today and in force; the tenant may be chosen already. */
export function newArrangementFormDefaults(today: ISODate, tenantId = ''): ArrangementFormInput {
  return {
    tenantId,
    leaseId: '',
    propertyId: '',
    outstandingBalance: unset(),
    installmentAmount: unset(),
    frequency: 'monthly',
    agreedOn: today,
    firstInstallmentDate: unset(),
    status: 'active',
    notes: '',
  }
}

/** The saved arrangement as the edit form starts. */
export function arrangementFormDefaults(arrangement: PaymentArrangement): ArrangementFormInput {
  return {
    tenantId: arrangement.tenantId,
    leaseId: arrangement.leaseId,
    propertyId: arrangement.propertyId,
    outstandingBalance: arrangement.outstandingBalance,
    installmentAmount: arrangement.installmentAmount,
    frequency: arrangement.frequency,
    agreedOn: arrangement.agreedOn,
    firstInstallmentDate: arrangement.firstInstallmentDate,
    status: arrangement.status === 'proposed' ? 'proposed' : 'active',
    notes: arrangement.notes,
  }
}

/**
 * The terms in the form as far as they are filled in, for the domain rules and the schedule preview; null until the
 * balance, instalment and both dates are given.
 */
export function termsFromForm(values: Partial<ArrangementFormInput>): ArrangementTerms | null {
  const { outstandingBalance, installmentAmount, frequency, agreedOn, firstInstallmentDate } = values
  if (typeof outstandingBalance !== 'number' || !Number.isFinite(outstandingBalance)) return null
  if (typeof installmentAmount !== 'number' || !Number.isFinite(installmentAmount)) return null
  if (!frequency || !agreedOn || !isValidISODate(agreedOn) || !firstInstallmentDate || !isValidISODate(firstInstallmentDate)) return null
  return { outstandingBalance, installmentAmount, frequency, agreedOn, firstInstallmentDate }
}

/** `POST /arrangements` body: the property is the chosen lease's (the database checks the lease is the tenant's there). */
export function newArrangementFrom(values: ArrangementFormValues): NewArrangement {
  return {
    tenantId: values.tenantId,
    propertyId: values.propertyId,
    leaseId: values.leaseId,
    outstandingBalance: values.outstandingBalance,
    installmentAmount: values.installmentAmount,
    frequency: values.frequency,
    firstInstallmentDate: values.firstInstallmentDate,
    agreedOn: values.agreedOn,
    status: values.status,
    ...(values.notes === '' ? {} : { notes: values.notes }),
  }
}

/**
 * `PATCH /arrangements/{id}` body with only what changed, or null when nothing did. The tenant, lease and status are
 * not edited here (they are fixed, or change through their own actions).
 */
export function arrangementChangesFrom(values: ArrangementFormValues, arrangement: PaymentArrangement): ArrangementChanges | null {
  const changes: ArrangementChanges = {}
  if (values.outstandingBalance !== arrangement.outstandingBalance) changes.outstandingBalance = values.outstandingBalance
  if (values.installmentAmount !== arrangement.installmentAmount) changes.installmentAmount = values.installmentAmount
  if (values.frequency !== arrangement.frequency) changes.frequency = values.frequency
  if (values.firstInstallmentDate !== arrangement.firstInstallmentDate) changes.firstInstallmentDate = values.firstInstallmentDate
  if (values.agreedOn !== arrangement.agreedOn) changes.agreedOn = values.agreedOn
  if (values.notes !== arrangement.notes) changes.notes = values.notes
  return Object.keys(changes).length === 0 ? null : changes
}
