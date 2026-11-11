import { describe, expect, it } from 'vitest'

import { formatAuditField, formatAuditValue } from './auditChanges'

describe('formatAuditValue', () => {
  it.each([
    [null, 'empty'],
    ['', 'empty'],
    [true, 'Yes'],
    [false, 'No'],
    [35000, '35000'],
    ['verified', 'verified'],
  ])('%s → %s', (value, text) => {
    expect(formatAuditValue(value)).toBe(text)
  })
})

describe('formatAuditField', () => {
  it.each([
    ['monthly_rental', 'Monthly rental'],
    ['monthlyRental', 'Monthly rental'],
    ['address.postalCode', 'Address postal code'],
    ['status', 'Status'],
  ])('%s → %s', (field, text) => {
    expect(formatAuditField(field)).toBe(text)
  })
})
