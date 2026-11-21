import { describe, expect, it } from 'vitest'

import { EXTRACTION_FIELD_NAMES, type ExtractedField, type ExtractionFieldName } from '../types/index.js'
import { fieldResolution, type LeaseCandidate } from './statementReview.js'
import { statementVerificationProblems, type StatementVerificationInput } from './statementVerification.js'

const VALUES: Record<ExtractionFieldName, string | number> = {
  tenant_name: 'Dlamini Cellular',
  unit_number: 'Shop 12',
  statement_number: 'ST-1042',
  statement_date: '2026-10-31',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  opening_balance: 0,
  rental_charged: 12_000,
  additional_charges: 960,
  payments_received: 0,
  outstanding_balance: 12_960,
  total_due: 12_960,
}

function field(name: ExtractionFieldName, overrides: Partial<ExtractedField> = {}): ExtractedField {
  const base: Omit<ExtractedField, 'resolution'> = { name, rawText: '', value: VALUES[name], confidence: 0.97, flagged: false, ...overrides }
  return { ...base, resolution: fieldResolution(base) }
}

const lease: LeaseCandidate = { id: 'lease-1', reference: 'MSQ-L012', status: 'active', commencementDate: '2026-01-01', expiryDate: '2030-12-31' }

function input(overrides: Partial<ExtractedField> & { name?: ExtractionFieldName } = {}, rest: Partial<StatementVerificationInput> = {}): StatementVerificationInput {
  const { name, ...fieldOverrides } = overrides
  return {
    statement: { status: 'review_required', tenantId: 't', unitId: 'u', leaseId: 'lease-1' },
    extraction: { status: 'pending_review', fields: EXTRACTION_FIELD_NAMES.map((candidate) => field(candidate, candidate === name ? fieldOverrides : {})) },
    lease,
    ...rest,
  }
}

describe('statementVerificationProblems', () => {
  it('has nothing to say about a fully resolved, matched statement', () => {
    expect(statementVerificationProblems(input())).toEqual([])
    expect(statementVerificationProblems(input({ name: 'total_due', flagged: true, confirmedAt: '2026-11-21T08:00:00Z' }))).toEqual([])
    expect(statementVerificationProblems(input({ name: 'total_due', value: null, flagged: true, correctedValue: 12_960 }))).toEqual([])
  })

  it('lists every unresolved field and every missing part of the match', () => {
    const problems = statementVerificationProblems({
      statement: { status: 'review_required' },
      extraction: {
        status: 'pending_review',
        fields: EXTRACTION_FIELD_NAMES.filter((name) => name !== 'statement_number').map((name) =>
          name === 'rental_charged' ? field(name, { flagged: true }) : name === 'total_due' ? field(name, { value: null, flagged: true }) : field(name),
        ),
      },
    })
    expect(problems).toEqual([
      'The statement number was not found on the statement: enter it, or confirm it is not on the statement',
      'The rental charged is flagged: confirm or correct it',
      'The total due was not found on the statement: enter it',
      'The tenant is not set',
      'The unit is not set',
      'The lease is not set',
    ])
  })

  it('verifies a statement without a number once the reviewer confirms it is not on the statement', () => {
    expect(statementVerificationProblems(input({ name: 'statement_number', value: null, flagged: true }))).toEqual([
      'The statement number was not found on the statement: enter it, or confirm it is not on the statement',
    ])
    expect(statementVerificationProblems(input({ name: 'statement_number', value: null, flagged: true, confirmedAt: '2026-11-21T08:00:00Z' }))).toEqual([])
  })

  it('never lets any other missing value be confirmed as not on the statement', () => {
    expect(statementVerificationProblems(input({ name: 'total_due', value: null, flagged: true, confirmedAt: '2026-11-21T08:00:00Z' }))).toEqual([
      'The total due was not found on the statement: enter it',
    ])
  })

  it('refuses a period that ends before it starts and a lease not in force on the reviewed date', () => {
    expect(statementVerificationProblems(input({ name: 'period_end', flagged: true, correctedValue: '2026-09-30' }))).toEqual([
      'The period end is before the period start',
    ])
    expect(statementVerificationProblems(input({ name: 'statement_date', flagged: true, correctedValue: '2025-10-31' }))).toEqual([
      'The lease MSQ-L012 was not in force on 31 Oct 2025: choose the lease again',
    ])
  })

  it('only verifies an extracted statement under review', () => {
    expect(statementVerificationProblems(input({}, { statement: { status: 'verified' } }))).toEqual([
      'The statement is verified; only a statement under review can be verified',
    ])
    expect(statementVerificationProblems(input({}, { extraction: null }))).toEqual(['The statement has no extracted values to verify: process it again'])
    expect(statementVerificationProblems(input({}, { extraction: { status: 'rejected', fields: [] } }))).toEqual([
      'The extraction was already reviewed (rejected)',
    ])
  })
})
