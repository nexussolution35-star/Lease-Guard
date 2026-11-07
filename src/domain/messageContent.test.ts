import { describe, expect, it } from 'vitest'

import {
  checkMessageContent,
  containsBankDetails,
  fillPlaceholders,
  findBankDetails,
  findForbiddenTenantTopics,
  MissingTemplateVariablesError,
  templatePlaceholders,
} from './messageContent'

describe('containsBankDetails', () => {
  it.each([
    'Please pay into account number 62012345678',
    'Our banking details: FNB',
    'Branch code 250655',
    'Acc no: 1234',
    'Pay to 62012345678 by Friday',
    'IBAN GB29 NWBK 6016 1331 9268 19',
    'SWIFT code FIRNZAJJ',
  ])('flags %s', (text) => {
    expect(containsBankDetails(text)).toBe(true)
  })

  it.each([
    'Hi Lucky, your balance is R204,801.20, due on 1 Oct 2026.',
    'Contact us on +27115550100 or 0115550100.',
    'Statement MSQ-2026-10-A01 for October 2026 is attached.',
    'Hi {{1}}, your {{2}} rental statement for {{3}} is attached.',
    'Instalment of R12 000,00 due 15 Nov 2026',
  ])('does not flag %s', (text) => {
    expect(containsBankDetails(text)).toBe(false)
  })

  it('reports the offending fragments', () => {
    const found = findBankDetails('account number 123456789, branch code 250655')
    expect(found.map((f) => f.kind)).toEqual(['bank_keyword', 'bank_keyword', 'account_number'])
    expect(found[2].text).toBe('123456789')
  })
})

describe('findForbiddenTenantTopics', () => {
  it('detects each forbidden topic', () => {
    expect(findForbiddenTenantTopics('Your rental escalation of 8% applies')).toEqual(['rental_escalation'])
    expect(findForbiddenTenantTopics('Your lease expires on 31 Dec')).toEqual(['lease_expiry'])
    expect(findForbiddenTenantTopics('Do you wish to renew?')).toEqual(['renewal_option'])
    expect(findForbiddenTenantTopics('Regarding your dispute')).toEqual(['dispute'])
    expect(findForbiddenTenantTopics('Your bank guarantee lapses')).toEqual(['bank_guarantee'])
    expect(findForbiddenTenantTopics('Deposit top-up required')).toEqual(['deposit'])
  })

  it('passes statement and reminder copy', () => {
    expect(findForbiddenTenantTopics('Hi Rose, your rental account shows a balance of R5,370.00.')).toEqual([])
  })
})

describe('placeholders', () => {
  it('lists distinct placeholders in order', () => {
    expect(templatePlaceholders('{{2}} {{1}} {{2}} {{ 3 }}')).toEqual([1, 2, 3])
  })

  it('fills placeholders and errors on every missing value', () => {
    expect(fillPlaceholders('Hi {{1}}, owe {{2}}', { 1: 'Rose', 2: 'R10' })).toBe('Hi Rose, owe R10')
    try {
      fillPlaceholders('Hi {{1}}, owe {{2}} by {{3}}', { 1: 'Rose', 3: ' ' })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(MissingTemplateVariablesError)
      expect((e as MissingTemplateVariablesError).missing).toEqual([2, 3])
    }
  })
})

describe('checkMessageContent', () => {
  it('rejects forbidden topics only for tenants', () => {
    expect(checkMessageContent('Your lease expires soon', 'tenant').valid).toBe(false)
    expect(checkMessageContent('Your lease expires soon', 'property_owner').valid).toBe(true)
  })

  it('rejects bank details for every audience', () => {
    expect(checkMessageContent('Branch code 250655', 'property_owner').errors[0]).toMatch(/banking details/)
  })

  it('rejects placeholder gaps and empty bodies', () => {
    expect(checkMessageContent('Hi {{1}} {{3}}', 'tenant').errors[0]).toMatch(/without gaps/)
    expect(checkMessageContent('  ', 'tenant').valid).toBe(false)
  })
})
