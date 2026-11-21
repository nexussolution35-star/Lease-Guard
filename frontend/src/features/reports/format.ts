/** Display helpers for report figures (amounts use `CurrencyDisplay`, dates the shared date formatter). */
const PERCENT = new Intl.NumberFormat('en-ZA', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 })
const AREA = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 })

/** A 0–1 rate, e.g. `75%` or `66,7%`. */
export const formatRate = (rate: number): string => PERCENT.format(rate)

/** A floor area in square metres, e.g. `1 250 m²`. */
export const formatArea = (sqm: number): string => `${AREA.format(sqm)} m²`
