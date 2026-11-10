import { describe, expect, it } from 'vitest'

import { EXTRACTION_FIELD_NAMES, type DocumentExtractionField, type DocumentExtractionResult } from '../types/index.js'
import { assessDocumentExtraction, contractErrorsFor, parseZarDecimal } from './extractionReview.js'

const VALUES: Record<(typeof EXTRACTION_FIELD_NAMES)[number], string> = {
  tenant_name: 'Sunrise Recruitment',
  unit_number: 'G12',
  statement_date: '2026-10-31',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  rental_charged: '35000.00',
  additional_charges: '4200.50',
  payments_received: '35000.00',
  outstanding_balance: '4200.50',
  total_due: '4200.50',
}

function field(name: (typeof EXTRACTION_FIELD_NAMES)[number], overrides: Partial<DocumentExtractionField> = {}): DocumentExtractionField {
  return { name, rawText: VALUES[name], value: VALUES[name], confidence: 0.98, flagged: false, reason: null, ...overrides }
}

function result(overrides: Partial<DocumentExtractionResult> = {}): DocumentExtractionResult {
  return {
    engine: 'leaseguard-pdf',
    engineVersion: '0.1.0',
    pageCount: 1,
    textLayer: true,
    ocrUsed: false,
    openingBalance: '0.00',
    fields: EXTRACTION_FIELD_NAMES.map((name) => field(name)),
    lineItems: [],
    overallConfidence: 0.97,
    issues: [],
    status: 'extracted',
    ...overrides,
  }
}

describe('parseZarDecimal', () => {
  it('accepts exactly two decimals', () => {
    expect(parseZarDecimal('35000.00')).toBe(35000)
    expect(parseZarDecimal('-120.50')).toBe(-120.5)
  })

  it('rejects anything that is not a 2dp decimal string', () => {
    for (const value of ['35000', '35000.0', '35 000.00', 'R35000.00', '1e3', '', null, undefined]) {
      expect(parseZarDecimal(value)).toBeNull()
    }
  })
})

describe('contractErrorsFor', () => {
  it('passes a complete field set', () => {
    expect(contractErrorsFor(result())).toEqual([])
  })

  it('reports missing and repeated fields', () => {
    const fields = [...result().fields.filter((f) => f.name !== 'total_due'), field('tenant_name')]
    expect(contractErrorsFor(result({ fields }))).toEqual([
      'field "tenant_name" appears 2 times',
      'field "total_due" is missing',
    ])
  })
})

describe('assessDocumentExtraction', () => {
  it('pre-fills confident financial values but always requires review', () => {
    const assessment = assessDocumentExtraction(result())
    expect(assessment.usable).toBe(true)
    expect(assessment.requiresHumanReview).toBe(true)
    expect(assessment.uncertainFinancialFields).toEqual([])
    expect(assessment.prefillableAmounts).toEqual({
      rental_charged: 35000,
      additional_charges: 4200.5,
      payments_received: 35000,
      outstanding_balance: 4200.5,
      total_due: 4200.5,
    })
  })

  it('never pre-fills flagged, missing, low-confidence or unparseable amounts', () => {
    const fields = result().fields.map((f) => {
      if (f.name === 'rental_charged') return { ...f, flagged: true, reason: 'derived' }
      if (f.name === 'payments_received') return { ...f, value: null }
      if (f.name === 'total_due') return { ...f, confidence: 0.5 }
      if (f.name === 'additional_charges') return { ...f, value: '4,200.50' }
      return f
    })
    const assessment = assessDocumentExtraction(result({ fields }))
    expect(assessment.uncertainFinancialFields).toEqual([
      { name: 'rental_charged', reason: 'flagged' },
      { name: 'additional_charges', reason: 'unparseable' },
      { name: 'payments_received', reason: 'missing' },
      { name: 'total_due', reason: 'low_confidence' },
    ])
    expect(assessment.prefillableAmounts).toEqual({ outstanding_balance: 4200.5 })
  })

  it('treats a failed or malformed result as unusable with nothing pre-filled', () => {
    const failed = assessDocumentExtraction(result({ status: 'failed' }))
    expect(failed.usable).toBe(false)
    expect(failed.prefillableAmounts).toEqual({})
    expect(failed.uncertainFinancialFields).toHaveLength(5)

    const malformed = assessDocumentExtraction(result({ fields: result().fields.slice(1) }))
    expect(malformed.usable).toBe(false)
    expect(malformed.contractErrors).toEqual(['field "tenant_name" is missing'])
  })

  it('reports blocking issues', () => {
    const assessment = assessDocumentExtraction(
      result({ issues: [{ code: 'totals_do_not_reconcile', severity: 'error', message: 'x', field: null }] }),
    )
    expect(assessment.hasBlockingIssues).toBe(true)
  })
})
