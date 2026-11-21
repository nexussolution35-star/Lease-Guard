import { describe, expect, it } from 'vitest'

import { STATEMENT_STATUSES } from '../types/index.js'
import { processingFailed, verifiedClosingBalance } from './statementProcessing.js'

describe('processingFailed', () => {
  it('is true only for a statement left for review with a processing error', () => {
    expect(processingFailed({ status: 'review_required', processingError: 'The PDF could not be read' })).toBe(true)
    expect(processingFailed({ status: 'review_required' })).toBe(false)
    expect(processingFailed({ status: 'review_required', processingError: '  ' })).toBe(false)
  })

  it('is false for every other status, even when an old error is still recorded', () => {
    for (const status of STATEMENT_STATUSES.filter((value) => value !== 'review_required')) {
      expect(processingFailed({ status, processingError: 'The PDF could not be read' })).toBe(false)
    }
  })
})

describe('verifiedClosingBalance', () => {
  it('returns the closing balance of a verified statement only', () => {
    expect(verifiedClosingBalance({ status: 'verified', closingBalance: 4200.5 })).toBe(4200.5)
    expect(verifiedClosingBalance({ status: 'verified', closingBalance: 0 })).toBe(0)
    for (const status of STATEMENT_STATUSES.filter((value) => value !== 'verified')) {
      expect(verifiedClosingBalance({ status, closingBalance: 4200.5 })).toBeUndefined()
    }
  })
})
