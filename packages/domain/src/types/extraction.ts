/**
 * Wire contract of the document-processing service (`POST /v1/extractions`).
 *
 * This module is the authoritative definition. The Python service serialises its responses in
 * camelCase with exactly these names and values, and its test suite checks parity with this file
 * (`python-services/document-processing/tests/test_project_consistency.py`).
 *
 * The result is a proposal, never a verified statement: the backend stores it as a
 * `StatementExtraction` that a person must confirm before any figure drives monitoring.
 */
import type { ISODate } from './common.js'
import type { ExtractionFieldName, LineItemCategory, LineItemKind, StatementSource } from './statement.js'

/**
 * Money on the wire: rands as a decimal string with exactly two decimals, e.g. `"35000.00"` or
 * `"-120.50"`. Strings keep full precision; convert with `parseZarDecimal`.
 */
export type ZarDecimal = string

/** Outcome of one extraction run. Even `extracted` results still require human verification. */
export const EXTRACTION_RESULT_STATUSES = ['extracted', 'needs_review', 'failed'] as const
export type ExtractionResultStatus = (typeof EXTRACTION_RESULT_STATUSES)[number]

export const EXTRACTION_ISSUE_CODES = [
  'missing_field',
  'low_confidence',
  'totals_do_not_reconcile',
  'cannot_reconcile',
  'invalid_period',
  'statement_date_out_of_range',
  'negative_amount',
  'duplicate_line_item',
  'conflicting_values',
  'unparsed_row',
  'hint_mismatch',
  'unsupported_layout',
  'scanned_without_ocr',
  'ocr_used',
] as const
export type ExtractionIssueCode = (typeof EXTRACTION_ISSUE_CODES)[number]

export const EXTRACTION_ISSUE_SEVERITIES = ['error', 'warning'] as const
export type ExtractionIssueSeverity = (typeof EXTRACTION_ISSUE_SEVERITIES)[number]

/** Error codes in the service's `ErrorResponse` body. */
export const DOCUMENT_PROCESSING_ERROR_CODES = [
  'invalid_request',
  'missing_token',
  'invalid_token',
  'auth_not_configured',
  'file_too_large',
  'unsupported_media_type',
  'encrypted_pdf',
  'corrupt_pdf',
  'empty_pdf',
  'not_found',
  'method_not_allowed',
  'internal_error',
] as const
export type DocumentProcessingErrorCode = (typeof DOCUMENT_PROCESSING_ERROR_CODES)[number]

/** Extraction fields whose values are rand amounts. They are never accepted without review. */
export const FINANCIAL_EXTRACTION_FIELDS = [
  'rental_charged',
  'additional_charges',
  'payments_received',
  'outstanding_balance',
  'total_due',
] as const satisfies readonly ExtractionFieldName[]
export type FinancialExtractionField = (typeof FINANCIAL_EXTRACTION_FIELDS)[number]

export interface DocumentExtractionField {
  name: ExtractionFieldName
  /** Document text the value was read from; empty when none. */
  rawText: string
  /** Text for names and unit numbers, `YYYY-MM-DD` for dates, `ZarDecimal` for money. Null when not found; never guessed. */
  value: string | null
  /** 0–1 */
  confidence: number
  /** True when a person must check this value. */
  flagged: boolean
  /** Why the value is flagged or derived. */
  reason: string | null
}

export interface DocumentExtractionLineItem {
  date: ISODate
  description: string
  category: LineItemCategory
  kind: LineItemKind
  /** Always positive; `kind` gives the direction. */
  amount: ZarDecimal
  /** 0–1 */
  confidence: number
  flagged: boolean
}

export interface DocumentExtractionIssue {
  code: ExtractionIssueCode
  severity: ExtractionIssueSeverity
  message: string
  field: ExtractionFieldName | null
}

/** Response body of `POST /v1/extractions`. */
export interface DocumentExtractionResult {
  engine: string
  engineVersion: string
  pageCount: number
  /** True when every page has a text layer. */
  textLayer: boolean
  ocrUsed: boolean
  /** Balance brought forward, used to reconcile totals. Null when not found. */
  openingBalance: ZarDecimal | null
  /** Exactly one entry per `ExtractionFieldName`. */
  fields: readonly DocumentExtractionField[]
  lineItems: readonly DocumentExtractionLineItem[]
  /** 0–1 */
  overallConfidence: number
  issues: readonly DocumentExtractionIssue[]
  status: ExtractionResultStatus
}

/** Multipart form fields sent with the PDF to `POST /v1/extractions`. */
export interface DocumentExtractionRequest {
  companyId: string
  statementId: string
  sourceSystem: StatementSource
  expectedTenantNames?: readonly string[]
  expectedUnitNumbers?: readonly string[]
}

/** Error body of every failing document-processing request. */
export interface DocumentProcessingErrorResponse {
  code: DocumentProcessingErrorCode
  message: string
  errors: readonly Record<string, unknown>[] | null
}
