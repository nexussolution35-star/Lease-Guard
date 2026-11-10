import { describe, expect, it } from 'vitest'

import { toExtractedField, toStatement, toStatementExtraction } from './statements.mapper'
import { extractionFieldRow, extractionRow, JSON_NULL, lineItemRow, statementRow, STATEMENT, TENANT } from './statements.test-helpers'

describe('statements mapper', () => {
  it('maps an unverified statement without inventing figures', () => {
    const statement = toStatement(statementRow(), [lineItemRow()], 'ext-1')

    expect(statement).toMatchObject({
      id: STATEMENT,
      tenantId: TENANT,
      status: 'uploaded',
      extractionId: 'ext-1',
      file: { fileName: 'MSQ-Shop12-2026-10.pdf', mimeType: 'application/pdf', sizeBytes: 52_000 },
      lineItems: [{ statementId: STATEMENT, category: 'rental', kind: 'charge', amount: 37_800, flagged: false }],
    })
    for (const absent of ['unitId', 'leaseId', 'statementNumber', 'openingBalance', 'closingBalance', 'totalDue', 'verifiedAt', 'duplicateOfStatementId']) {
      expect(statement).not.toHaveProperty(absent)
    }
  })

  it('keeps zero amounts of a verified statement', () => {
    const statement = toStatement(
      statementRow({
        status: 'verified',
        opening_balance: 0,
        rental_charged: 37_800,
        additional_charges: 0,
        payments_received: 37_800,
        closing_balance: 0,
        total_due: 0,
        verified_by_user_id: 'u1',
        verified_at: '2026-11-02T09:00:00+00:00',
      }),
    )
    expect(statement).toMatchObject({ openingBalance: 0, closingBalance: 0, totalDue: 0, verifiedByUserId: 'u1', lineItems: [] })
  })

  it('rejects a mime type outside the stored-file union', () => {
    expect(() => toStatement(statementRow({ mime_type: 'text/html' }))).toThrow(/mime_type/)
  })

  it('maps extracted fields, keeping missing values null and corrections separate', () => {
    expect(toExtractedField(extractionFieldRow({ name: 'total_due', value: JSON_NULL, flagged: true, confidence: 0 }))).toEqual({
      name: 'total_due',
      rawText: 'R 37 800,00',
      value: null,
      confidence: 0,
      flagged: true,
    })
    expect(
      toExtractedField(extractionFieldRow({ corrected_value: 38_000, corrected_by_user_id: 'u1' })),
    ).toMatchObject({ value: 37_800, correctedValue: 38_000, correctedByUserId: 'u1' })
    expect(() => toExtractedField(extractionFieldRow({ value: { nested: true } }))).toThrow(/object/)
  })

  it('orders extraction fields canonically', () => {
    const extraction = toStatementExtraction(extractionRow(), [
      extractionFieldRow({ name: 'total_due' }),
      extractionFieldRow({ name: 'tenant_name', value: 'Mugg & Bean' }),
    ])
    expect(extraction.fields.map((field) => field.name)).toEqual(['tenant_name', 'total_due'])
    expect(extraction).toMatchObject({ matchedTenantId: TENANT, status: 'pending_review', overallConfidence: 0.82 })
    expect(extraction).not.toHaveProperty('reviewedAt')
  })

  it('maps a processing error and the extractor issues', () => {
    expect(toStatement(statementRow()).processingError).toBeUndefined()
    expect(toStatement(statementRow({ processing_error: 'The PDF is encrypted' })).processingError).toBe('The PDF is encrypted')

    const issue = { code: 'totals_do_not_reconcile', severity: 'error', message: 'Totals differ by R10,00', field: 'total_due' }
    expect(toStatementExtraction(extractionRow({ issues: [issue] }), []).issues).toEqual([issue])
    expect(toStatementExtraction(extractionRow({ issues: [] }), []).issues).toEqual([])
  })

  it('fails loudly on malformed stored issues instead of hiding them', () => {
    expect(() => toStatementExtraction(extractionRow({ issues: [{ code: 'made_up', severity: 'error', message: 'x', field: null }] }), [])).toThrow(
      /issues/,
    )
    expect(() => toStatementExtraction(extractionRow({ issues: { not: 'a list' } }), [])).toThrow(/issues/)
  })
})
