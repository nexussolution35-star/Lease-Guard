import type {
  ExtractedField,
  ExtractionFieldName,
  FieldResolution,
  ISODate,
  LeaseStatus,
  Statement,
} from '../types/index.js'
import { formatSADate, isValidISODate, isWithinISO } from './dates.js'
import { isFinancialExtractionField } from './extractionReview.js'

/**
 * Review rules for a processed statement: where each extracted field stands, what a reviewer may enter as a
 * correction, and which lease a statement belongs to.
 *
 * Product rule: statements are never guessed. A flagged or missing value counts only once a person has
 * confirmed or corrected it, and a value the extractor did not find can only be entered, never confirmed.
 */

/** Where a reviewer stands with one field. See `FieldResolution`. */
export function fieldResolution(
  field: Pick<ExtractedField, 'value' | 'flagged' | 'correctedValue' | 'confirmedAt'>,
): FieldResolution {
  if (field.correctedValue !== undefined) return 'corrected'
  if (field.value === null) return 'unresolved'
  if (field.confirmedAt !== undefined) return 'confirmed'
  return field.flagged ? 'unresolved' : 'accepted'
}

/** The value a field stands for once resolved (the correction, else the extracted value); undefined while unresolved. */
export function resolvedFieldValue(field: ExtractedField): string | number | undefined {
  if (field.correctedValue !== undefined) return field.correctedValue
  return fieldResolution(field) === 'unresolved' || field.value === null ? undefined : field.value
}

/** The fields a reviewer still has to confirm or correct, in the order given. */
export function unresolvedFields<F extends ExtractedField>(fields: readonly F[]): F[] {
  return fields.filter((field) => fieldResolution(field) === 'unresolved')
}

/** Text fields: names and numbers as printed. */
const TEXT_FIELDS = ['tenant_name', 'unit_number', 'statement_number'] as const satisfies readonly ExtractionFieldName[]
/** Amounts a statement never shows as negative (the database checks the same). */
const NON_NEGATIVE_FIELDS = ['rental_charged', 'additional_charges', 'payments_received'] as const satisfies readonly ExtractionFieldName[]

const MAX_TEXT_LENGTH = 200
/** numeric(14, 2): twelve digits before the decimal point. */
const MAX_AMOUNT = 999_999_999_999.99

export type FieldCorrection = { ok: true; value: string | number } | { ok: false; message: string }

/** Each field as a reviewer reads it, at the start of a sentence. */
export const EXTRACTION_FIELD_LABELS: Readonly<Record<ExtractionFieldName, string>> = {
  tenant_name: 'The tenant name',
  unit_number: 'The unit number',
  statement_number: 'The statement number',
  statement_date: 'The statement date',
  period_start: 'The period start',
  period_end: 'The period end',
  opening_balance: 'The opening balance',
  rental_charged: 'The rental charged',
  additional_charges: 'The additional charges',
  payments_received: 'The payments received',
  outstanding_balance: 'The outstanding balance',
  total_due: 'The total due',
}

const hasAtMostTwoDecimals = (amount: number): boolean => Math.abs(Math.round(amount * 100) - amount * 100) < 1e-6

/**
 * Checks what a reviewer entered for a field and returns the value to store: text trimmed (names and numbers),
 * an ISO date (`YYYY-MM-DD`) for dates, a rand amount with at most two decimals for money. Pure.
 */
export function parseFieldCorrection(name: ExtractionFieldName, input: unknown): FieldCorrection {
  const label = EXTRACTION_FIELD_LABELS[name]
  if ((TEXT_FIELDS as readonly ExtractionFieldName[]).includes(name)) {
    if (typeof input !== 'string' || input.trim() === '') return { ok: false, message: `${label} must be text` }
    const text = input.trim().replace(/\s+/g, ' ')
    if (text.length > MAX_TEXT_LENGTH) return { ok: false, message: `${label} must be at most ${MAX_TEXT_LENGTH} characters` }
    return { ok: true, value: text }
  }
  if (isFinancialExtractionField(name)) {
    if (typeof input !== 'number' || !Number.isFinite(input)) return { ok: false, message: `${label} must be an amount in rands` }
    if (!hasAtMostTwoDecimals(input)) return { ok: false, message: `${label} must have at most two decimals` }
    if (Math.abs(input) > MAX_AMOUNT) return { ok: false, message: `${label} is too large` }
    if (input < 0 && (NON_NEGATIVE_FIELDS as readonly ExtractionFieldName[]).includes(name)) {
      return { ok: false, message: `${label} cannot be negative` }
    }
    return { ok: true, value: Math.round(input * 100) / 100 + 0 }
  }
  if (typeof input !== 'string' || !isValidISODate(input)) return { ok: false, message: `${label} must be a date (YYYY-MM-DD)` }
  return { ok: true, value: input }
}

/**
 * The statement date to choose a lease by: the reviewed `statement_date` field (corrected, confirmed or found
 * without a flag), else the date on the statement itself (typed at upload). Undefined while neither is known:
 * an unconfirmed extracted date is never used.
 */
export function statementDateForMatching(
  statement: Pick<Statement, 'statementDate'>,
  fields: readonly ExtractedField[],
): ISODate | undefined {
  const field = fields.find((candidate) => candidate.name === 'statement_date')
  const reviewed = field ? resolvedFieldValue(field) : undefined
  if (typeof reviewed === 'string' && isValidISODate(reviewed)) return reviewed
  return statement.statementDate
}

export interface LeaseCandidate {
  id: string
  reference: string
  status: LeaseStatus
  commencementDate: ISODate
  expiryDate: ISODate
}

export type StatementLeaseChoice<L extends LeaseCandidate> =
  | { kind: 'found'; lease: L }
  | { kind: 'date_unknown' }
  | { kind: 'none'; date: ISODate }
  | { kind: 'ambiguous'; date: ISODate; leases: L[] }

/**
 * The lease of a tenant's unit that was in force on the statement date: commenced on or before it and not yet
 * expired. A draft lease was never in force. More than one (overlapping leases) is ambiguous: a person chooses.
 * `leases` are the leases of that tenant and unit only.
 */
export function leaseInForceOn<L extends LeaseCandidate>(leases: readonly L[], date: ISODate | undefined): StatementLeaseChoice<L> {
  if (date === undefined) return { kind: 'date_unknown' }
  const inForce = leases.filter((lease) => lease.status !== 'draft' && isWithinISO(date, lease.commencementDate, lease.expiryDate))
  if (inForce.length === 1) return { kind: 'found', lease: inForce[0]! }
  if (inForce.length === 0) return { kind: 'none', date }
  return { kind: 'ambiguous', date, leases: [...inForce].sort((a, b) => a.reference.localeCompare(b.reference)) }
}

/** Why a lease cannot be chosen for a statement, in words for the reviewer; null when it can. */
export function leaseChoiceProblem<L extends LeaseCandidate>(choice: StatementLeaseChoice<L>): string | null {
  switch (choice.kind) {
    case 'found':
      return null
    case 'date_unknown':
      return 'The statement date is not known yet: confirm or correct it, or choose the lease'
    case 'none':
      return `No lease of this tenant for this unit was in force on ${formatSADate(choice.date)}`
    case 'ambiguous':
      return `More than one lease of this tenant for this unit was in force on ${formatSADate(choice.date)} (${choice.leases
        .map((lease) => lease.reference)
        .join(', ')}): choose the lease`
  }
}
