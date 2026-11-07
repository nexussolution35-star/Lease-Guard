import { z } from 'zod'

/**
 * South African phone number helpers. Canonical storage format is E.164: `+27` followed by the
 * 9-digit national significant number (no trunk `0`), e.g. `+27821234567`.
 */

const NSN_RE = /^[1-8]\d{8}$/

/**
 * Normalise SA input to E.164. Accepts `082 123 4567`, `0821234567`, `+27 82 123 4567`,
 * `+27 (0)82 123 4567`, `27821234567`, `0027 82 123 4567`, with spaces, dashes, dots or
 * brackets. Returns `null` when the input is not a valid SA number.
 */
export function normaliseSAPhoneNumber(input: string): string | null {
  if (typeof input !== 'string') return null
  let s = input.trim()
  if (s === '') return null
  // "+27 (0)82..." — drop the bracketed trunk zero.
  s = s.replace(/^(\+?27)\s*\(0\)/, '$1')
  if (!/^\+?[\d\s().-]+$/.test(s)) return null
  const hasPlus = s.startsWith('+')
  const digits = s.replace(/\D/g, '')

  let nsn: string | null = null
  if (hasPlus) {
    if (digits.startsWith('27')) nsn = digits.slice(2)
  } else if (digits.startsWith('0027')) {
    nsn = digits.slice(4)
  } else if (digits.startsWith('27') && digits.length === 11) {
    nsn = digits.slice(2)
  } else if (digits.startsWith('0') && digits.length === 10) {
    nsn = digits.slice(1)
  }
  if (nsn === null || !NSN_RE.test(nsn)) return null
  return `+27${nsn}`
}

export function isValidSAPhoneNumber(input: string): boolean {
  return normaliseSAPhoneNumber(input) !== null
}

/**
 * Display format `+27 82 123 4567`. Accepts any input `normaliseSAPhoneNumber` accepts;
 * returns the input unchanged when it is not a valid SA number.
 */
export function formatSAPhoneNumber(e164: string): string {
  const normalised = normaliseSAPhoneNumber(e164)
  if (!normalised) return e164
  const nsn = normalised.slice(3)
  return `+27 ${nsn.slice(0, 2)} ${nsn.slice(2, 5)} ${nsn.slice(5)}`
}

export const SA_PHONE_ERROR_MESSAGE = 'Enter a valid South African number, e.g. 082 123 4567'

/** Validates an SA number and outputs E.164. */
export const saPhoneNumberSchema = z
  .string()
  .trim()
  .refine(isValidSAPhoneNumber, { message: SA_PHONE_ERROR_MESSAGE })
  .transform((value) => normaliseSAPhoneNumber(value) ?? value)
