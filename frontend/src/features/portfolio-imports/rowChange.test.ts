import type { PortfolioImportRowCheck } from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { correctionsFromDraft, fileImportValue } from './rowChange'

const ROW: PortfolioImportRowCheck = {
  rowNumber: 4,
  result: 'invalid',
  reasons: ['Province: Gautng is not a South African province'],
  values: { propertyCode: 'MSQ', province: 'Gauteng', unitNumber: 'Shop 1' },
  conflicts: [],
  resolution: {
    corrections: [{ field: 'province', value: 'Gauteng', fileValue: 'Gautng' }],
    skipped: false,
    tenantSuggestionsRejected: false,
    changedAt: '2026-11-21T08:00:00Z',
  },
}
const FIELDS = ['propertyCode', 'province', 'unitNumber', 'city'] as const

describe('correctionsFromDraft', () => {
  it('sends only the fields that changed', () => {
    expect(correctionsFromDraft(ROW, FIELDS, { propertyCode: 'MSQ', unitNumber: ' Shop 1A ', city: '' })).toEqual({ unitNumber: 'Shop 1A' })
  })

  it('drops a correction typed back to the file value, and clears a value with an empty one', () => {
    expect(correctionsFromDraft(ROW, FIELDS, { province: 'Gautng', propertyCode: '' })).toEqual({ province: null, propertyCode: '' })
  })

  it('is undefined when nothing changed', () => {
    expect(correctionsFromDraft(ROW, FIELDS, { province: 'Gauteng' })).toBeUndefined()
  })
})

describe('fileImportValue', () => {
  it('is the file cell under a correction, else the value read', () => {
    expect(fileImportValue(ROW, 'province')).toBe('Gautng')
    expect(fileImportValue(ROW, 'propertyCode')).toBe('MSQ')
    expect(fileImportValue(ROW, 'city')).toBe('')
  })
})
