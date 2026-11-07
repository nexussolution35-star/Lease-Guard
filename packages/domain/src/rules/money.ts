import type { ZAR } from '../types/index.js'

/**
 * Money helpers. All amounts are rands as JS numbers rounded to 2dp.
 *
 * Output format (stable, documented): `R 37 800,00` — rand symbol, REGULAR space, thousands
 * grouped with REGULAR spaces, comma decimal separator, always 2 decimals. Negative amounts
 * are prefixed with a minus: `-R 1 200,00`. Intl.NumberFormat('en-ZA') emits non-breaking
 * (U+00A0) and narrow no-break (U+202F) spaces; we normalise every whitespace to U+0020 so
 * tests and snapshots are stable across ICU versions.
 */

const NON_STANDARD_SPACES = /[   ]/g

/** Round to 2 decimal places, correcting for binary float error. `-0` becomes `0`. */
export function roundZar(amount: number): ZAR {
  if (!Number.isFinite(amount)) return 0
  const sign = amount < 0 ? -1 : 1
  const abs = Math.abs(amount)
  // Shift the decimal point textually so 1.005 → "1.005e2" → 100.5 (avoids 100.49999999999999).
  const text = String(abs)
  const cents = text.includes('e') ? Math.round(abs * 100) : Math.round(Number(`${text}e2`))
  const rounded = (sign * cents) / 100
  return rounded === 0 ? 0 : rounded
}

/** Sum a list of amounts and round once at the end. */
export function sumZar(amounts: readonly number[]): ZAR {
  let total = 0
  for (const a of amounts) total += a
  return roundZar(total)
}

export interface FormatZAROptions {
  /** `R 1,3M` style for dashboards. */
  compact?: boolean
  /** Include the `R` symbol (default true). */
  withSymbol?: boolean
}

const standardFormatter = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const compactFormatter = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatZAR(amount: number, options: FormatZAROptions = {}): string {
  const { compact = false, withSymbol = true } = options
  const value = compact ? amount : roundZar(amount)
  const formatter = compact ? compactFormatter : standardFormatter
  const parts = formatter.formatToParts(value)
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!withSymbol && part.type === 'currency') {
      // Also drop the literal space that follows the symbol.
      const next = parts[i + 1]
      if (next && next.type === 'literal') i++
      continue
    }
    out += part.value
  }
  return out.replace(NON_STANDARD_SPACES, ' ').trim()
}

/**
 * Parse human / accounting-system rand strings into a number.
 * Accepts: `R35,000.00`, `R 35 000,00`, `35000`, `R1,200`, `(1 200,00)` (negative),
 * `-R 1 200,00`, `R35 000.00 CR`, `ZAR 35000`. Returns `null` when no number is present.
 *
 * Decimal rule: the LAST `,` or `.` is the decimal separator when it is followed by 1–2 digits;
 * every other separator is a thousands grouping. If both `,` and `.` appear, the last one is the
 * decimal separator regardless.
 */
export function parseZAR(text: string): ZAR | null {
  if (typeof text !== 'string') return null
  let s = text.replace(NON_STANDARD_SPACES, ' ').trim()
  if (s === '') return null

  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (/\bCR\b/i.test(s)) {
    negative = true
  }
  if (/^\s*-/.test(s) || /^\s*R\s*-/i.test(s)) negative = true

  // Keep only digits and separators.
  const cleaned = s.replace(/[^0-9.,]/g, '')
  if (!/\d/.test(cleaned)) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  const lastSep = Math.max(lastComma, lastDot)

  let integerPart: string
  let fractionPart = ''
  if (lastSep === -1) {
    integerPart = cleaned
  } else {
    const after = cleaned.slice(lastSep + 1)
    const bothPresent = lastComma !== -1 && lastDot !== -1
    const isDecimal = bothPresent || (after.length >= 1 && after.length <= 2)
    if (isDecimal) {
      integerPart = cleaned.slice(0, lastSep)
      fractionPart = after
    } else {
      integerPart = cleaned
    }
  }
  integerPart = integerPart.replace(/[.,]/g, '')
  if (integerPart === '' && fractionPart === '') return null
  const numeric = Number(`${integerPart === '' ? '0' : integerPart}.${fractionPart === '' ? '0' : fractionPart}`)
  if (!Number.isFinite(numeric)) return null
  return roundZar(negative ? -numeric : numeric)
}
