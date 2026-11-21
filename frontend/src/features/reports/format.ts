/** Display helpers for report figures (amounts use `CurrencyDisplay`, dates the shared date formatter). */
const PERCENT = new Intl.NumberFormat('en-ZA', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 })
const AREA = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 })

/** A 0–1 rate, e.g. `75%` or `66,7%`. */
export const formatRate = (rate: number): string => PERCENT.format(rate)

/** A floor area in square metres, e.g. `1 250 m²`. */
export const formatArea = (sqm: number): string => `${AREA.format(sqm)} m²`

/** Signed days from the as-at date, e.g. `24 days`, `1 day`, `Today` or `20 days ago`. */
export function formatDaysFrom(days: number): string {
  if (days === 0) return 'Today'
  const count = Math.abs(days)
  const text = `${count} ${count === 1 ? 'day' : 'days'}`
  return days > 0 ? text : `${text} ago`
}

/** Thresholds in days as a list, e.g. `180, 90 and 30 days`. */
export function formatDayList(days: readonly number[]): string {
  const parts = days.map(String)
  const last = parts.pop()
  return `${parts.length > 0 ? `${parts.join(', ')} and ` : ''}${last ?? ''} days`
}
