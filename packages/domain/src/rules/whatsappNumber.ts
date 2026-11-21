/**
 * A tenant's WhatsApp number as people type it, turned into the E.164 form LeaseGuard stores
 * (`+27821234567`). South African national numbers (`082 123 4567`) gain the +27 country code;
 * spaces, hyphens, dots and brackets are ignored; a leading `00` is the international prefix.
 */

/** Same pattern as the `tenants.whatsapp_number` CHECK constraint. */
export const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/

export const WHATSAPP_NUMBER_HINT = 'Enter the WhatsApp number with its country code, for example +27 82 123 4567'

export type WhatsAppNumberResult = { ok: true; number: string } | { ok: false; reason: string }

export function normalizeWhatsAppNumber(input: string): WhatsAppNumberResult {
  const compact = input.trim().replace(/[\s\-.()]/g, '')
  if (compact === '') return { ok: false, reason: 'Enter the WhatsApp number' }

  let number: string
  if (compact.startsWith('+')) number = compact
  else if (compact.startsWith('00')) number = `+${compact.slice(2)}`
  else if (/^0[0-9]{9}$/.test(compact)) number = `+27${compact.slice(1)}`
  else if (/^27[0-9]{9}$/.test(compact)) number = `+${compact}`
  else return { ok: false, reason: WHATSAPP_NUMBER_HINT }

  if (!E164_PATTERN.test(number)) return { ok: false, reason: WHATSAPP_NUMBER_HINT }
  // A South African number is +27 and nine digits, never with a trunk 0 after the country code.
  if (number.startsWith('+27') && !/^\+27[1-9][0-9]{8}$/.test(number)) {
    return { ok: false, reason: 'A South African WhatsApp number has nine digits after +27, for example +27 82 123 4567' }
  }
  return { ok: true, number }
}
