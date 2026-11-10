import type { Json } from '../../infrastructure/database/database.types'
import type {
  StatementExtractionFieldRow,
  StatementExtractionRow,
  StatementLineItemRow,
  StatementRow,
} from './statements.mapper'

export const COMPANY = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
export const USER = '6f1d2c1e-0000-4000-8000-0000000000bb'
export const PROPERTY = '6f1d2c1e-0000-4000-8000-0000000000cc'
export const TENANT = '6f1d2c1e-0000-4000-8000-0000000000dd'
export const STATEMENT = '6f1d2c1e-0000-4000-8000-0000000000aa'
export const SHA = 'a'.repeat(64)

/**
 * A jsonb `null` value. The generated row type says `NonNullable<Json>` (the column is NOT NULL), but
 * PostgREST returns the JSON value `null` stored in it as `null`.
 */
export const JSON_NULL = null as unknown as NonNullable<Json>

export function statementRow(overrides: Partial<StatementRow> = {}): StatementRow {
  return {
    id: STATEMENT,
    company_id: COMPANY,
    property_id: PROPERTY,
    tenant_id: TENANT,
    unit_id: null,
    lease_id: null,
    file_name: 'MSQ-Shop12-2026-10.pdf',
    storage_path: `${COMPANY}/${STATEMENT}/MSQ-Shop12-2026-10.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 52_000,
    file_sha256: SHA,
    source_system: 'MRI',
    statement_number: null,
    statement_date: '2026-10-31',
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    status: 'uploaded',
    upload_batch_id: null,
    uploaded_by_user_id: USER,
    uploaded_at: '2026-11-01T08:00:00+00:00',
    opening_balance: null,
    rental_charged: null,
    additional_charges: null,
    payments_received: null,
    closing_balance: null,
    total_due: null,
    verified_by_user_id: null,
    verified_at: null,
    delivered_communication_id: null,
    duplicate_of_statement_id: null,
    processing_error: null,
    created_at: '2026-11-01T08:00:00+00:00',
    updated_at: '2026-11-01T08:00:00+00:00',
    ...overrides,
  }
}

export function lineItemRow(overrides: Partial<StatementLineItemRow> = {}): StatementLineItemRow {
  return {
    id: '6f1d2c1e-0000-4000-8000-000000000101',
    company_id: COMPANY,
    statement_id: STATEMENT,
    line_number: 1,
    date: '2026-10-01',
    description: 'Rental October 2026',
    category: 'rental',
    kind: 'charge',
    amount: 37_800,
    flagged: false,
    created_at: '2026-11-01T08:00:00+00:00',
    updated_at: '2026-11-01T08:00:00+00:00',
    ...overrides,
  }
}

export function extractionRow(overrides: Partial<StatementExtractionRow> = {}): StatementExtractionRow {
  return {
    id: '6f1d2c1e-0000-4000-8000-000000000201',
    company_id: COMPANY,
    statement_id: STATEMENT,
    engine: 'pdfplumber',
    extracted_at: '2026-11-01T08:05:00+00:00',
    overall_confidence: 0.82,
    matched_tenant_id: TENANT,
    matched_unit_id: null,
    match_confidence: 0.95,
    status: 'pending_review',
    reviewed_by_user_id: null,
    reviewed_at: null,
    review_notes: null,
    issues: [],
    created_at: '2026-11-01T08:05:00+00:00',
    updated_at: '2026-11-01T08:05:00+00:00',
    ...overrides,
  }
}

export function extractionFieldRow(overrides: Partial<StatementExtractionFieldRow> = {}): StatementExtractionFieldRow {
  return {
    id: '6f1d2c1e-0000-4000-8000-000000000301',
    company_id: COMPANY,
    extraction_id: '6f1d2c1e-0000-4000-8000-000000000201',
    name: 'rental_charged',
    raw_text: 'R 37 800,00',
    value: 37_800,
    confidence: 0.97,
    flagged: false,
    corrected_value: null,
    corrected_by_user_id: null,
    created_at: '2026-11-01T08:05:00+00:00',
    updated_at: '2026-11-01T08:05:00+00:00',
    ...overrides,
  }
}
