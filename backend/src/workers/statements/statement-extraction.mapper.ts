import {
  isFinancialExtractionField,
  parseZarDecimal,
  type DocumentExtractionField,
  type DocumentExtractionResult,
  type EntityId,
  type ExtractionAssessment,
} from '@leaseguard/domain'

import type { Json, TablesInsert } from '../../infrastructure/database/database.types'

/** A tenant or unit the statement may belong to, with the name printed on statements. */
export interface MatchCandidate {
  id: EntityId
  names: readonly string[]
}

export interface ExtractionMatch {
  tenantId?: EntityId
  unitId?: EntityId
  /** Confidence of the extracted text that matched (0 when nothing matched). */
  confidence: number
}

/** numeric(4,3) columns. */
const confidence = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000
const normalise = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase()

function matchField(field: DocumentExtractionField | undefined, candidates: readonly MatchCandidate[]): { id: EntityId; confidence: number } | undefined {
  if (!field || field.value === null || field.flagged) return undefined
  const wanted = normalise(field.value)
  const hits = candidates.filter((candidate) => candidate.names.some((name) => normalise(name) === wanted))
  // Only an unambiguous exact match is proposed; the reviewer confirms it either way.
  return hits.length === 1 ? { id: hits[0].id, confidence: field.confidence } : undefined
}

/**
 * Proposes the tenant and unit the statement belongs to: an exact (case and whitespace insensitive),
 * unambiguous match of the extracted, unflagged tenant name / unit number against the company's
 * candidates. Anything else proposes nothing.
 */
export function proposeMatch(
  result: DocumentExtractionResult,
  tenants: readonly MatchCandidate[],
  units: readonly MatchCandidate[],
): ExtractionMatch {
  const byName = new Map(result.fields.map((field) => [field.name, field]))
  const tenant = matchField(byName.get('tenant_name'), tenants)
  const unit = matchField(byName.get('unit_number'), units)
  const scores = [tenant?.confidence, unit?.confidence].filter((score): score is number => score !== undefined)
  return {
    ...(tenant ? { tenantId: tenant.id } : {}),
    ...(unit ? { unitId: unit.id } : {}),
    confidence: scores.length === 0 ? 0 : confidence(Math.min(...scores)),
  }
}

export function toExtractionInsert(
  companyId: EntityId,
  statementId: EntityId,
  result: DocumentExtractionResult,
  match: ExtractionMatch,
  extractedAt: string,
): TablesInsert<'statement_extractions'> {
  return {
    company_id: companyId,
    statement_id: statementId,
    engine: `${result.engine} ${result.engineVersion}`.trim(),
    extracted_at: extractedAt,
    overall_confidence: confidence(result.overallConfidence),
    matched_tenant_id: match.tenantId ?? null,
    matched_unit_id: match.unitId ?? null,
    match_confidence: match.confidence,
    status: 'pending_review',
    issues: result.issues.map((issue) => ({ ...issue })) satisfies Json,
  }
}

/**
 * One row per extracted field. Financial values the domain assessment does not allow to be pre-filled
 * (missing, flagged, low confidence or unparseable) are stored WITHOUT a value and flagged, so an
 * uncertain amount is never presented as a figure; the raw document text stays for the reviewer.
 * Pre-fillable amounts are stored as numbers. Rows without a value omit `value`, so the insert must use
 * `defaultToNull: false` (the column default is JSON null). Every row is still only a proposal (status
 * pending_review); verified figures are written to the statement by a person, never by this job.
 */
export function toExtractionFieldInserts(
  companyId: EntityId,
  extractionId: EntityId,
  result: DocumentExtractionResult,
  assessment: ExtractionAssessment,
): TablesInsert<'statement_extraction_fields'>[] {
  return result.fields.map((field) => {
    let value: string | number | null
    let flagged: boolean
    if (isFinancialExtractionField(field.name)) {
      const amount = assessment.prefillableAmounts[field.name]
      value = amount ?? null
      flagged = amount === undefined || field.flagged
    } else {
      value = field.value
      flagged = field.flagged || field.value === null
    }
    return {
      company_id: companyId,
      extraction_id: extractionId,
      name: field.name,
      raw_text: field.rawText,
      // A JSON null sent through the Data API becomes SQL NULL; the column default stores JSON null
      // when `value` is omitted (insert with defaultToNull: false).
      ...(value === null ? {} : { value }),
      confidence: confidence(field.confidence),
      flagged,
    }
  })
}

export interface LineItemMapping {
  rows: TablesInsert<'statement_line_items'>[]
  /** Lines left out because the amount was not a valid positive rand value or kind/category disagree. */
  skipped: number
}

/**
 * Proposed statement lines. Line numbers follow the document order (1-based, stable across retries).
 * Lines below the confidence threshold are flagged; invalid lines are left out (and counted) instead of
 * being guessed.
 */
export function toLineItemInserts(
  companyId: EntityId,
  statementId: EntityId,
  result: DocumentExtractionResult,
  minConfidence: number,
): LineItemMapping {
  const rows: TablesInsert<'statement_line_items'>[] = []
  let skipped = 0
  result.lineItems.forEach((item, index) => {
    const amount = parseZarDecimal(item.amount)
    const consistent = (item.category === 'payment') === (item.kind === 'payment') && (item.category === 'credit') === (item.kind === 'credit')
    if (amount === null || amount < 0 || !consistent) {
      skipped++
      return
    }
    rows.push({
      company_id: companyId,
      statement_id: statementId,
      line_number: index + 1,
      date: item.date,
      description: item.description,
      category: item.category,
      kind: item.kind,
      amount,
      flagged: item.flagged || item.confidence < minConfidence,
    })
  })
  return { rows, skipped }
}
