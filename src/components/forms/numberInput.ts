/**
 * Convert raw number-field text to a number. Accepts `,` or `.` as the decimal separator and
 * ignores spaces. Empty or unparseable input → `undefined` (never NaN).
 */
export function parseNumberInput(raw: string): number | undefined {
  const cleaned = raw.replace(/\s+/g, '').replace(',', '.')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return undefined
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return undefined
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : undefined
}
