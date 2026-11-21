import { describe, expect, it } from 'vitest'

import type { DocumentExtractionIssue, ExtractedField } from '../types/index.js'
import { extractionFieldKind, fieldReviewAction, fieldReviewReasons } from './statementFieldReview.js'

type FieldFacts = Pick<ExtractedField, 'name' | 'rawText' | 'value' | 'confidence' | 'flagged'>

const field = (overrides: Partial<FieldFacts> = {}): FieldFacts => ({
  name: 'rental_charged',
  rawText: 'R 37 800,00',
  value: 37_800,
  confidence: 0.97,
  flagged: false,
  ...overrides,
})

const issue = (overrides: Partial<DocumentExtractionIssue>): DocumentExtractionIssue => ({
  code: 'low_confidence',
  severity: 'warning',
  message: 'Rental charged was read with low confidence (62%).',
  field: 'rental_charged',
  ...overrides,
})

describe('extractionFieldKind', () => {
  it('enters amounts in rands, dates as dates and the rest as text', () => {
    expect(extractionFieldKind('outstanding_balance')).toBe('amount')
    expect(extractionFieldKind('period_end')).toBe('date')
    expect(extractionFieldKind('statement_number')).toBe('text')
  })
})

describe('fieldReviewReasons', () => {
  it('has nothing to say about a field found without a flag', () => {
    expect(fieldReviewReasons(field(), [])).toEqual([])
  })

  it('names each reported reason against the field, ignoring other fields and statement-wide issues', () => {
    const reasons = fieldReviewReasons(field({ name: 'outstanding_balance', value: 4200, flagged: true }), [
      issue({ code: 'totals_do_not_reconcile', severity: 'error', message: 'Opening + charges − payments is R 4 100,00, not R 4 200,00.', field: 'outstanding_balance' }),
      issue({ code: 'typed_value_mismatch', message: 'The period start differs.', field: 'period_start' }),
      issue({ code: 'unparsed_row', message: '2 rows were not read.', field: null }),
    ])
    expect(reasons).toEqual([{ kind: 'does_not_reconcile', message: 'Opening + charges − payments is R 4 100,00, not R 4 200,00.' }])
  })

  it('tells a value that differs from what was typed', () => {
    const reasons = fieldReviewReasons(field({ name: 'statement_date', value: '2026-10-31', flagged: true }), [
      issue({ code: 'typed_value_mismatch', message: 'The statement date on the document differs.', field: 'statement_date' }),
    ])
    expect(reasons.map((reason) => reason.kind)).toEqual(['differs_from_typed'])
  })

  it('says a missing value was not found, once', () => {
    expect(fieldReviewReasons(field({ value: null, rawText: '', flagged: true }))).toEqual([
      { kind: 'missing', message: 'The rental charged was not found on the statement: enter it.' },
    ])
    const reported = fieldReviewReasons(field({ value: null, rawText: '', flagged: true }), [
      issue({ code: 'missing_field', severity: 'error', message: 'Rental charged was not found on the statement.' }),
    ])
    expect(reported).toEqual([{ kind: 'missing', message: 'Rental charged was not found on the statement.' }])
  })

  it('explains an amount that was read but withheld, so it can only be entered', () => {
    expect(fieldReviewReasons(field({ value: null, rawText: 'R 37 8OO,00', confidence: 0.4, flagged: true }))).toEqual([
      { kind: 'low_confidence', message: 'The rental charged was read as “R 37 8OO,00” but not with enough certainty to use: enter it from the statement.' },
    ])
  })

  it('gives the confidence when a flag has no reported reason', () => {
    expect(fieldReviewReasons(field({ name: 'tenant_name', value: 'Umoya Coffee', confidence: 0.71, flagged: true }))).toEqual([
      { kind: 'low_confidence', message: 'The tenant name was read with 71% confidence: check it against the statement.' },
    ])
  })
})

describe('fieldReviewAction', () => {
  it('asks to enter a missing value and to confirm or correct a flagged one', () => {
    expect(fieldReviewAction({ value: null, flagged: true })).toBe('enter')
    expect(fieldReviewAction({ value: 37_800, flagged: true })).toBe('confirm_or_correct')
  })

  it('has nothing left once accepted, confirmed or corrected', () => {
    expect(fieldReviewAction({ value: 37_800, flagged: false })).toBe('none')
    expect(fieldReviewAction({ value: 37_800, flagged: true, confirmedAt: '2026-11-21T08:00:00Z' })).toBe('none')
    expect(fieldReviewAction({ value: null, flagged: true, correctedValue: 38_000 })).toBe('none')
  })
})
