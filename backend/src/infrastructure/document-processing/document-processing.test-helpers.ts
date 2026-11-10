import { EXTRACTION_FIELD_NAMES, type DocumentExtractionResult } from '@leaseguard/domain'

/** A contract-valid extraction result: every field present, confident and unflagged. */
export function extractionResult(overrides: Partial<DocumentExtractionResult> = {}): DocumentExtractionResult {
  return {
    engine: 'leaseguard-pdf',
    engineVersion: '1.0.0',
    pageCount: 1,
    textLayer: true,
    ocrUsed: false,
    openingBalance: '0.00',
    fields: EXTRACTION_FIELD_NAMES.map((name) => ({ name, rawText: name, value: 'x', confidence: 0.95, flagged: false, reason: null })),
    lineItems: [],
    overallConfidence: 0.95,
    issues: [],
    status: 'extracted',
    ...overrides,
  }
}
