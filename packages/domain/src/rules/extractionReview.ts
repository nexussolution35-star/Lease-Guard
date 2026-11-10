import {
  EXTRACTION_FIELD_NAMES,
  FINANCIAL_EXTRACTION_FIELDS,
  type DocumentExtractionField,
  type DocumentExtractionResult,
  type ExtractionFieldName,
  type FinancialExtractionField,
  type ZAR,
  type ZarDecimal,
} from '../types/index.js'

/**
 * Review rules for document-extraction results.
 *
 * Product rule: statements are never silently guessed. Every extraction is stored as a proposal that
 * a person confirms; these rules decide which values are too uncertain to even be pre-filled and
 * whether the result is structurally usable at all.
 */

/** Minimum field confidence for a financial value to be pre-filled in the review form. */
export const DEFAULT_MIN_FINANCIAL_CONFIDENCE = 0.9

const ZAR_DECIMAL_PATTERN = /^-?\d{1,13}\.\d{2}$/

/** Parses a wire money string (`"35000.00"`). Returns null for anything that is not exactly 2dp. */
export function parseZarDecimal(value: ZarDecimal | null | undefined): ZAR | null {
  if (value === null || value === undefined || !ZAR_DECIMAL_PATTERN.test(value)) return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

export function isFinancialExtractionField(name: ExtractionFieldName): name is FinancialExtractionField {
  return (FINANCIAL_EXTRACTION_FIELDS as readonly ExtractionFieldName[]).includes(name)
}

export type UncertaintyReason = 'missing' | 'flagged' | 'low_confidence' | 'unparseable'

export interface UncertainField {
  name: ExtractionFieldName
  reason: UncertaintyReason
}

export interface ExtractionAssessment {
  /** False when the result is structurally invalid (missing or repeated fields) or the run failed. */
  usable: boolean
  /** Contract problems that make the result unusable. Empty when usable. */
  contractErrors: readonly string[]
  /** Financial values that must not be pre-filled; a person has to enter or confirm them. */
  uncertainFinancialFields: readonly UncertainField[]
  /** Financial values safe to pre-fill (still subject to human confirmation). */
  prefillableAmounts: Partial<Record<FinancialExtractionField, ZAR>>
  /** True when any issue has severity `error`. */
  hasBlockingIssues: boolean
  /** Always true: extraction never verifies a statement by itself. */
  requiresHumanReview: true
}

function uncertaintyOf(field: DocumentExtractionField, minConfidence: number): UncertaintyReason | null {
  if (field.value === null) return 'missing'
  if (field.flagged) return 'flagged'
  if (field.confidence < minConfidence) return 'low_confidence'
  if (isFinancialExtractionField(field.name) && parseZarDecimal(field.value) === null) return 'unparseable'
  return null
}

/** Checks the field set against the contract: exactly one entry per extraction field name. */
export function contractErrorsFor(result: DocumentExtractionResult): string[] {
  const errors: string[] = []
  const counts = new Map<string, number>()
  for (const field of result.fields) counts.set(field.name, (counts.get(field.name) ?? 0) + 1)
  for (const name of EXTRACTION_FIELD_NAMES) {
    const count = counts.get(name) ?? 0
    if (count === 0) errors.push(`field "${name}" is missing`)
    if (count > 1) errors.push(`field "${name}" appears ${count} times`)
  }
  for (const field of result.fields) {
    if (field.confidence < 0 || field.confidence > 1) errors.push(`field "${field.name}" confidence is out of range`)
  }
  if (result.overallConfidence < 0 || result.overallConfidence > 1) errors.push('overall confidence is out of range')
  return errors
}

/** Decides what a reviewer must check and what may be pre-filled. Pure; never mutates the result. */
export function assessDocumentExtraction(
  result: DocumentExtractionResult,
  minFinancialConfidence: number = DEFAULT_MIN_FINANCIAL_CONFIDENCE,
): ExtractionAssessment {
  const contractErrors = contractErrorsFor(result)
  const usable = result.status !== 'failed' && contractErrors.length === 0
  const uncertainFinancialFields: UncertainField[] = []
  const prefillableAmounts: Partial<Record<FinancialExtractionField, ZAR>> = {}

  for (const field of result.fields) {
    if (!isFinancialExtractionField(field.name)) continue
    const reason = usable ? uncertaintyOf(field, minFinancialConfidence) : 'missing'
    const amount = parseZarDecimal(field.value)
    if (reason !== null || amount === null) {
      uncertainFinancialFields.push({ name: field.name, reason: reason ?? 'unparseable' })
    } else {
      prefillableAmounts[field.name] = amount
    }
  }

  return {
    usable,
    contractErrors,
    uncertainFinancialFields,
    prefillableAmounts,
    hasBlockingIssues: result.issues.some((issue) => issue.severity === 'error'),
    requiresHumanReview: true,
  }
}
