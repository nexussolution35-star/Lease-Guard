import { assessDocumentExtraction, type DocumentExtractionField } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { extractionResult } from '../../infrastructure/document-processing/document-processing.test-helpers'
import { COMPANY, STATEMENT, TENANT, UNIT } from '../workers.test-helpers'
import { proposeMatch, toExtractionFieldInserts, toExtractionInsert, toLineItemInserts } from './statement-extraction.mapper'

function field(name: DocumentExtractionField['name'], value: string | null, overrides: Partial<DocumentExtractionField> = {}): DocumentExtractionField {
  return { name, rawText: value ?? '', value, confidence: 0.97, flagged: false, reason: null, ...overrides }
}

const result = extractionResult({
  fields: [
    field('tenant_name', 'TEST  trading'),
    field('unit_number', 'Shop 1'),
    field('statement_date', '2026-10-01'),
    field('period_start', '2026-10-01'),
    field('period_end', '2026-10-31'),
    field('rental_charged', '35000.00'),
    field('additional_charges', '1250.50', { confidence: 0.6 }),
    field('payments_received', null, { flagged: true, reason: 'not found' }),
    field('outstanding_balance', '36250.50', { flagged: true, reason: 'totals do not reconcile' }),
    field('total_due', '36250.50'),
  ],
  lineItems: [
    { date: '2026-10-01', description: 'Rental', category: 'rental', kind: 'charge', amount: '35000.00', confidence: 0.99, flagged: false },
    { date: '2026-10-05', description: 'Payment', category: 'payment', kind: 'charge', amount: '100.00', confidence: 0.99, flagged: false },
    { date: '2026-10-06', description: 'Levy', category: 'marketing_levy', kind: 'charge', amount: '1250.50', confidence: 0.7, flagged: false },
  ],
  overallConfidence: 0.8765,
  issues: [{ code: 'totals_do_not_reconcile', severity: 'warning', message: 'Totals differ by R 0,50', field: 'outstanding_balance' }],
})

describe('statement extraction mapping', () => {
  it('stores uncertain financial values without a value and flagged, and confident ones as numbers', () => {
    const assessment = assessDocumentExtraction(result)
    const rows = toExtractionFieldInserts(COMPANY, 'ext-1', result, assessment)
    const byName = new Map(rows.map((row) => [row.name, row]))
    expect(byName.get('rental_charged')).toMatchObject({ value: 35000, flagged: false, confidence: 0.97 })
    expect(byName.get('total_due')).toMatchObject({ value: 36250.5, flagged: false })
    for (const name of ['additional_charges', 'payments_received', 'outstanding_balance'] as const) {
      expect(byName.get(name)).not.toHaveProperty('value')
      expect(byName.get(name)).toMatchObject({ flagged: true })
    }
    expect(byName.get('outstanding_balance')?.raw_text).toBe('36250.50')
    expect(byName.get('tenant_name')).toMatchObject({ value: 'TEST  trading', flagged: false })
    expect(rows.every((row) => row.company_id === COMPANY && row.extraction_id === 'ext-1')).toBe(true)
  })

  it('stores the extraction as a pending proposal with the issues', () => {
    const row = toExtractionInsert(COMPANY, STATEMENT, result, { tenantId: TENANT, confidence: 0.97 }, '2026-11-09T04:00:00.000Z')
    expect(row).toMatchObject({
      company_id: COMPANY,
      statement_id: STATEMENT,
      engine: 'leaseguard-pdf 1.0.0',
      overall_confidence: 0.877,
      matched_tenant_id: TENANT,
      matched_unit_id: null,
      status: 'pending_review',
      issues: [{ code: 'totals_do_not_reconcile', severity: 'warning', message: 'Totals differ by R 0,50', field: 'outstanding_balance' }],
    })
  })

  it('proposes only unambiguous exact matches', () => {
    const tenants = [{ id: TENANT, names: ['Test Trading', 'Test Trading (Pty) Ltd'] }]
    expect(proposeMatch(result, tenants, [{ id: UNIT, names: ['Shop 1'] }])).toEqual({ tenantId: TENANT, unitId: UNIT, confidence: 0.97 })
    const ambiguous = [...tenants, { id: 'other', names: ['test trading'] }]
    expect(proposeMatch(result, ambiguous, [])).toEqual({ confidence: 0 })
  })

  it('keeps valid statement lines in document order and leaves out inconsistent ones', () => {
    const { rows, skipped } = toLineItemInserts(COMPANY, STATEMENT, result, 0.9)
    expect(skipped).toBe(1)
    expect(rows.map((row) => [row.line_number, row.amount, row.flagged])).toEqual([
      [1, 35000, false],
      [3, 1250.5, true],
    ])
  })
})
