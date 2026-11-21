import { describe, expect, it } from 'vitest'

import type { ExtractedField } from '../types/index.js'
import {
  canConfirmNotOnStatement,
  confirmedNotOnStatement,
  fieldResolution,
  leaseChoiceProblem,
  leaseInForceOn,
  parseFieldCorrection,
  resolvedFieldValue,
  statementDateForMatching,
  unresolvedFields,
  type LeaseCandidate,
} from './statementReview.js'

function field(overrides: Partial<ExtractedField> = {}): ExtractedField {
  const base: Omit<ExtractedField, 'resolution'> = {
    name: 'rental_charged',
    rawText: 'R 37 800,00',
    value: 37_800,
    confidence: 0.97,
    flagged: false,
    ...overrides,
  }
  return { ...base, resolution: fieldResolution(base) }
}

describe('fieldResolution', () => {
  it('accepts an unflagged value and leaves a flagged or missing one unresolved', () => {
    expect(fieldResolution(field())).toBe('accepted')
    expect(fieldResolution(field({ flagged: true }))).toBe('unresolved')
    expect(fieldResolution(field({ value: null, flagged: true }))).toBe('unresolved')
  })

  it('counts a confirmation or a correction', () => {
    expect(fieldResolution(field({ flagged: true, confirmedAt: '2026-11-21T08:00:00Z' }))).toBe('confirmed')
    expect(fieldResolution(field({ value: null, flagged: true, correctedValue: 38_000 }))).toBe('corrected')
  })

  it('never counts a confirmation of a value that was not found', () => {
    expect(fieldResolution(field({ value: null, flagged: true, confirmedAt: '2026-11-21T08:00:00Z' }))).toBe('unresolved')
  })

  it('counts a statement number confirmed as not on the statement, with no value', () => {
    const missing = field({ name: 'statement_number', rawText: '', value: null, flagged: true })
    expect(fieldResolution(missing)).toBe('unresolved')
    expect(canConfirmNotOnStatement(missing)).toBe(true)
    const absent = field({ name: 'statement_number', rawText: '', value: null, flagged: true, confirmedAt: '2026-11-21T08:00:00Z' })
    expect(fieldResolution(absent)).toBe('confirmed')
    expect(confirmedNotOnStatement(absent)).toBe(true)
    expect(canConfirmNotOnStatement(absent)).toBe(false)
    expect(resolvedFieldValue(absent)).toBeUndefined()
  })

  it('offers "not on the statement" only for an optional field the extractor did not find', () => {
    expect(canConfirmNotOnStatement(field({ name: 'statement_number', value: 'ST-1', flagged: true }))).toBe(false)
    expect(canConfirmNotOnStatement(field({ name: 'total_due', value: null, flagged: true }))).toBe(false)
    expect(confirmedNotOnStatement(field({ name: 'total_due', value: null, flagged: true, confirmedAt: '2026-11-21T08:00:00Z' }))).toBe(false)
  })
})

describe('resolvedFieldValue and unresolvedFields', () => {
  it('gives the correction, else the confirmed or accepted value, and nothing while unresolved', () => {
    expect(resolvedFieldValue(field({ correctedValue: 38_000 }))).toBe(38_000)
    expect(resolvedFieldValue(field())).toBe(37_800)
    expect(resolvedFieldValue(field({ flagged: true }))).toBeUndefined()
  })

  it('lists the fields still to review, in order', () => {
    const fields = [field({ name: 'opening_balance', flagged: true }), field(), field({ name: 'total_due', value: null, flagged: true })]
    expect(unresolvedFields(fields).map((f) => f.name)).toEqual(['opening_balance', 'total_due'])
  })
})

describe('parseFieldCorrection', () => {
  it('trims text and collapses its spaces', () => {
    expect(parseFieldCorrection('tenant_name', '  Umoya   Coffee ')).toEqual({ ok: true, value: 'Umoya Coffee' })
    expect(parseFieldCorrection('statement_number', '   ')).toEqual({ ok: false, message: 'The statement number must be text' })
    expect(parseFieldCorrection('unit_number', 12)).toEqual({ ok: false, message: 'The unit number must be text' })
  })

  it('takes rand amounts with at most two decimals, never negative where a statement never is', () => {
    expect(parseFieldCorrection('rental_charged', 37_800.5)).toEqual({ ok: true, value: 37_800.5 })
    expect(parseFieldCorrection('outstanding_balance', -1_200)).toEqual({ ok: true, value: -1_200 })
    expect(parseFieldCorrection('payments_received', -1)).toEqual({ ok: false, message: 'The payments received cannot be negative' })
    expect(parseFieldCorrection('total_due', 1.005)).toEqual({ ok: false, message: 'The total due must have at most two decimals' })
    expect(parseFieldCorrection('total_due', '1200.00')).toEqual({ ok: false, message: 'The total due must be an amount in rands' })
    expect(parseFieldCorrection('opening_balance', 1e13)).toEqual({ ok: false, message: 'The opening balance is too large' })
  })

  it('takes real ISO dates only', () => {
    expect(parseFieldCorrection('statement_date', '2026-10-31')).toEqual({ ok: true, value: '2026-10-31' })
    expect(parseFieldCorrection('period_end', '2026-02-30')).toEqual({ ok: false, message: 'The period end must be a date (YYYY-MM-DD)' })
    expect(parseFieldCorrection('period_start', '31/10/2026').ok).toBe(false)
  })
})

describe('statementDateForMatching', () => {
  it('prefers the reviewed date on the document, then the typed one, and never an unconfirmed extracted date', () => {
    const date = (overrides: Partial<ExtractedField>) => field({ name: 'statement_date', value: '2026-10-31', ...overrides })
    expect(statementDateForMatching({ statementDate: '2026-09-30' }, [date({})])).toBe('2026-10-31')
    expect(statementDateForMatching({ statementDate: '2026-09-30' }, [date({ flagged: true })])).toBe('2026-09-30')
    expect(statementDateForMatching({}, [date({ flagged: true })])).toBeUndefined()
    expect(statementDateForMatching({}, [date({ flagged: true, correctedValue: '2026-11-30' })])).toBe('2026-11-30')
  })
})

describe('leaseInForceOn', () => {
  const lease = (id: string, commencementDate: string, expiryDate: string, status: LeaseCandidate['status'] = 'active'): LeaseCandidate => ({
    id,
    reference: id.toUpperCase(),
    status,
    commencementDate,
    expiryDate,
  })
  const old = lease('l-old', '2021-01-01', '2025-12-31', 'renewed')
  const current = lease('l-new', '2026-01-01', '2030-12-31')

  it('finds the lease in force on the statement date, ends inclusive', () => {
    expect(leaseInForceOn([old, current], '2026-10-31')).toEqual({ kind: 'found', lease: current })
    expect(leaseInForceOn([old, current], '2025-12-31')).toEqual({ kind: 'found', lease: old })
    expect(leaseInForceOn([old, current], '2026-01-01')).toEqual({ kind: 'found', lease: current })
  })

  it('reports an unknown date, no lease, or overlapping leases instead of guessing', () => {
    expect(leaseInForceOn([current], undefined)).toEqual({ kind: 'date_unknown' })
    expect(leaseInForceOn([current], '2031-01-31')).toEqual({ kind: 'none', date: '2031-01-31' })
    expect(leaseInForceOn([lease('l-draft', '2026-01-01', '2030-12-31', 'draft')], '2026-10-31')).toEqual({ kind: 'none', date: '2026-10-31' })
    const overlap = lease('l-b', '2026-06-01', '2031-05-31')
    const choice = leaseInForceOn([current, overlap], '2026-10-31')
    expect(choice).toEqual({ kind: 'ambiguous', date: '2026-10-31', leases: [overlap, current] })
    expect(leaseChoiceProblem(choice)).toBe(
      'More than one lease of this tenant for this unit was in force on 31 Oct 2026 (L-B, L-NEW): choose the lease',
    )
    expect(leaseChoiceProblem({ kind: 'none', date: '2031-01-31' })).toBe('No lease of this tenant for this unit was in force on 31 Jan 2031')
    expect(leaseChoiceProblem({ kind: 'found', lease: current })).toBeNull()
  })
})
