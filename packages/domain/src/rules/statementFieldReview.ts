import type { DocumentExtractionIssue, ExtractedField, ExtractionFieldName, ExtractionIssueCode } from '../types/index.js'
import { isFinancialExtractionField } from './extractionReview.js'
import { EXTRACTION_FIELD_LABELS, fieldResolution } from './statementReview.js'

/**
 * Why an extracted field needs a person, in the reviewer's words, from what the extraction reported.
 *
 * Product rule: statements are never guessed. A flagged field says why it is flagged (missing, low confidence, does
 * not reconcile, differs from what was typed); an amount the extractor read but was not sure enough of is stored
 * without a value, so it can only be entered, never confirmed.
 */

/** How a reviewer enters a field's value: text as printed, an ISO date, or rands. */
export type ExtractionFieldKind = 'text' | 'date' | 'amount'

const DATE_FIELDS: readonly ExtractionFieldName[] = ['statement_date', 'period_start', 'period_end']

export function extractionFieldKind(name: ExtractionFieldName): ExtractionFieldKind {
  if (isFinancialExtractionField(name)) return 'amount'
  return DATE_FIELDS.includes(name) ? 'date' : 'text'
}

/** The four reasons the glossary names for a flagged field, and `other` for anything else the extraction reported. */
export const FIELD_REVIEW_REASON_KINDS = ['missing', 'low_confidence', 'does_not_reconcile', 'differs_from_typed', 'other'] as const
export type FieldReviewReasonKind = (typeof FIELD_REVIEW_REASON_KINDS)[number]

export interface FieldReviewReason {
  kind: FieldReviewReasonKind
  /** One sentence for the reviewer. */
  message: string
}

const KIND_OF_ISSUE: Partial<Record<ExtractionIssueCode, FieldReviewReasonKind>> = {
  missing_field: 'missing',
  low_confidence: 'low_confidence',
  totals_do_not_reconcile: 'does_not_reconcile',
  cannot_reconcile: 'does_not_reconcile',
  typed_value_mismatch: 'differs_from_typed',
}

const percent = (confidence: number): string => `${Math.round(confidence * 100)}%`

/**
 * Every reason a field needs (or needed) a person, in order: what the extraction reported against the field, then
 * what the stored field itself shows (a value withheld or not found, a flag with no reported reason). Empty for a
 * field the extractor found without a flag and nothing reported against it. Pure.
 */
export function fieldReviewReasons(
  field: Pick<ExtractedField, 'name' | 'rawText' | 'value' | 'confidence' | 'flagged'>,
  issues: readonly DocumentExtractionIssue[] = [],
): FieldReviewReason[] {
  const reasons: FieldReviewReason[] = issues
    .filter((issue) => issue.field === field.name)
    .map((issue) => ({ kind: KIND_OF_ISSUE[issue.code] ?? 'other', message: issue.message }))
  const label = EXTRACTION_FIELD_LABELS[field.name]

  if (field.value === null && !reasons.some((reason) => reason.kind === 'missing')) {
    const read = field.rawText.trim()
    if (read !== '' && isFinancialExtractionField(field.name)) {
      reasons.push({
        kind: reasons.length > 0 ? 'other' : 'low_confidence',
        message: `${label} was read as “${read}” but not with enough certainty to use: enter it from the statement.`,
      })
    } else if (read === '') {
      reasons.push({ kind: 'missing', message: `${label} was not found on the statement: enter it.` })
    } else {
      reasons.push({ kind: 'missing', message: `${label} was read as “${read}” but no value could be taken from it: enter it.` })
    }
  }
  if (field.flagged && reasons.length === 0) {
    reasons.push({ kind: 'low_confidence', message: `${label} was read with ${percent(field.confidence)} confidence: check it against the statement.` })
  }
  return reasons
}

/** What the reviewer can do with a field now: enter a value, confirm or correct one, or nothing (resolved). */
export type FieldReviewAction = 'enter' | 'confirm_or_correct' | 'none'

export function fieldReviewAction(field: Pick<ExtractedField, 'value' | 'flagged' | 'correctedValue' | 'confirmedAt'>): FieldReviewAction {
  if (fieldResolution(field) !== 'unresolved') return 'none'
  return field.value === null ? 'enter' : 'confirm_or_correct'
}
