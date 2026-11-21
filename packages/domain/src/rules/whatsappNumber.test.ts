import { describe, expect, it } from 'vitest'

import { normalizeWhatsAppNumber, WHATSAPP_NUMBER_HINT } from './whatsappNumber.js'

describe('normalizeWhatsAppNumber', () => {
  it.each([
    ['+27821234567', '+27821234567'],
    ['+27 82 123 4567', '+27821234567'],
    ['082 123 4567', '+27821234567'],
    ['082-123-4567', '+27821234567'],
    ['(082) 123.4567', '+27821234567'],
    ['0027821234567', '+27821234567'],
    ['27821234567', '+27821234567'],
    ['+44 7700 900123', '+447700900123'],
    ['  +27821234567  ', '+27821234567'],
  ])('stores %s as %s', (input, number) => {
    expect(normalizeWhatsAppNumber(input)).toEqual({ ok: true, number })
  })

  it('asks for a number when none is given', () => {
    expect(normalizeWhatsAppNumber('   ')).toEqual({ ok: false, reason: 'Enter the WhatsApp number' })
  })

  it.each(['abc', '12345', '082 123 456', '+0821234567', '+27 82 123 4567 ext 2', '+1234567890123456', '821234567'])(
    'rejects %s with the format hint',
    (input) => {
      expect(normalizeWhatsAppNumber(input)).toEqual({ ok: false, reason: WHATSAPP_NUMBER_HINT })
    },
  )

  it('rejects South African numbers with the wrong length or a trunk 0 after +27', () => {
    for (const input of ['+27 082 123 4567', '+2782123456', '+278212345678']) {
      const result = normalizeWhatsAppNumber(input)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.reason).toMatch(/nine digits after \+27/)
    }
  })
})
