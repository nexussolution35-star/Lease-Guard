import {
  EXTRACTION_FIELD_NAMES,
  EXTRACTION_ISSUE_CODES,
  EXTRACTION_ISSUE_SEVERITIES,
  type DocumentExtractionIssue,
  type ExtractedField,
  type Statement,
  type StatementExtraction,
  type StatementLineItem,
  type StoredFile,
} from '@leaseguard/domain'

import { z } from 'zod'

import type { Json, Tables } from '../../infrastructure/database/database.types'

/** Shape of `statement_extractions.issues` (written by the statement-processing worker). */
const extractionIssuesSchema = z.array(
  z.object({
    code: z.enum(EXTRACTION_ISSUE_CODES),
    severity: z.enum(EXTRACTION_ISSUE_SEVERITIES),
    message: z.string(),
    field: z.enum(EXTRACTION_FIELD_NAMES).nullable(),
  }),
) satisfies z.ZodType<DocumentExtractionIssue[]>

/** Malformed stored issues are a data error: fail loudly instead of hiding a reviewer's warnings. */
function toExtractionIssues(value: Json): DocumentExtractionIssue[] {
  const parsed = extractionIssuesSchema.safeParse(value)
  if (!parsed.success) throw new Error('Malformed statement_extractions.issues value')
  return parsed.data
}

export type StatementRow = Tables<'statements'>
export type StatementLineItemRow = Tables<'statement_line_items'>
export type StatementExtractionRow = Tables<'statement_extractions'>
export type StatementExtractionFieldRow = Tables<'statement_extraction_fields'>

/** MIME types the `statements.mime_type` CHECK constraint allows (the domain `StoredFile` union). */
const STORED_FILE_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const satisfies readonly StoredFile['mimeType'][]

function toMimeType(value: string): StoredFile['mimeType'] {
  const match = STORED_FILE_MIME_TYPES.find((type) => type === value)
  if (!match) throw new Error(`Unexpected statement mime_type "${value}"`)
  return match
}

export function toStoredFile(row: StatementRow): StoredFile {
  return {
    fileName: row.file_name,
    storagePath: row.storage_path,
    mimeType: toMimeType(row.mime_type),
    sizeBytes: row.size_bytes,
    sha256: row.file_sha256,
  }
}

export function toStatementLineItem(row: StatementLineItemRow): StatementLineItem {
  return {
    id: row.id,
    statementId: row.statement_id,
    date: row.date,
    description: row.description,
    category: row.category,
    kind: row.kind,
    amount: row.amount,
    flagged: row.flagged,
  }
}

/**
 * Database row → domain `Statement`. Nullable columns become absent optional fields; in particular the
 * reconciled figures stay absent until the statement is verified (they are never guessed).
 * `lineItems` must be ordered by line number.
 */
export function toStatement(
  row: StatementRow,
  lineItems: readonly StatementLineItemRow[] = [],
  extractionId?: string,
): Statement {
  return {
    id: row.id,
    companyId: row.company_id,
    propertyId: row.property_id,
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    ...(row.unit_id ? { unitId: row.unit_id } : {}),
    ...(row.lease_id ? { leaseId: row.lease_id } : {}),
    file: toStoredFile(row),
    sourceSystem: row.source_system,
    ...(row.statement_number !== null ? { statementNumber: row.statement_number } : {}),
    statementDate: row.statement_date,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    ...(row.upload_batch_id !== null ? { uploadBatchId: row.upload_batch_id } : {}),
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedAt: row.uploaded_at,
    ...(extractionId ? { extractionId } : {}),
    ...(row.opening_balance !== null ? { openingBalance: row.opening_balance } : {}),
    ...(row.rental_charged !== null ? { rentalCharged: row.rental_charged } : {}),
    ...(row.additional_charges !== null ? { additionalCharges: row.additional_charges } : {}),
    ...(row.payments_received !== null ? { paymentsReceived: row.payments_received } : {}),
    ...(row.closing_balance !== null ? { closingBalance: row.closing_balance } : {}),
    ...(row.total_due !== null ? { totalDue: row.total_due } : {}),
    lineItems: lineItems.map(toStatementLineItem),
    ...(row.verified_by_user_id ? { verifiedByUserId: row.verified_by_user_id } : {}),
    ...(row.verified_at ? { verifiedAt: row.verified_at } : {}),
    ...(row.delivered_communication_id ? { deliveredCommunicationId: row.delivered_communication_id } : {}),
    ...(row.duplicate_of_statement_id ? { duplicateOfStatementId: row.duplicate_of_statement_id } : {}),
    ...(row.processing_error !== null ? { processingError: row.processing_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** `value` / `corrected_value` hold a JSON string, number or null (CHECK-constrained). */
function toFieldValue(value: Json | null, column: string): string | number | null {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value
  throw new Error(`Unexpected JSON ${Array.isArray(value) ? 'array' : typeof value} in statement_extraction_fields.${column}`)
}

export function toExtractedField(row: StatementExtractionFieldRow): ExtractedField {
  const corrected = toFieldValue(row.corrected_value, 'corrected_value')
  return {
    name: row.name,
    rawText: row.raw_text,
    value: toFieldValue(row.value, 'value'),
    confidence: row.confidence,
    flagged: row.flagged,
    ...(corrected !== null ? { correctedValue: corrected } : {}),
    ...(row.corrected_by_user_id ? { correctedByUserId: row.corrected_by_user_id } : {}),
  }
}

const FIELD_ORDER = new Map<string, number>(EXTRACTION_FIELD_NAMES.map((name, index) => [name, index]))

/** Extraction row and its field rows → domain `StatementExtraction`, fields in canonical order. */
export function toStatementExtraction(
  row: StatementExtractionRow,
  fields: readonly StatementExtractionFieldRow[],
): StatementExtraction {
  const ordered = [...fields].sort((a, b) => (FIELD_ORDER.get(a.name) ?? 0) - (FIELD_ORDER.get(b.name) ?? 0))
  return {
    id: row.id,
    companyId: row.company_id,
    statementId: row.statement_id,
    engine: row.engine,
    extractedAt: row.extracted_at,
    overallConfidence: row.overall_confidence,
    fields: ordered.map(toExtractedField),
    ...(row.matched_tenant_id ? { matchedTenantId: row.matched_tenant_id } : {}),
    ...(row.matched_unit_id ? { matchedUnitId: row.matched_unit_id } : {}),
    matchConfidence: row.match_confidence,
    status: row.status,
    ...(row.reviewed_by_user_id ? { reviewedByUserId: row.reviewed_by_user_id } : {}),
    ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
    ...(row.review_notes !== null ? { reviewNotes: row.review_notes } : {}),
    issues: toExtractionIssues(row.issues),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
