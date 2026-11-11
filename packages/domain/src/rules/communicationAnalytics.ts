import type { CommunicationAnalyticsRange, ISODate } from '../types/index.js'
import { addDaysISO, compareISODate, daysBetween, isValidISODate } from './dates.js'

/** The longest range communication analytics covers, in days (a leap year). */
export const COMMUNICATION_ANALYTICS_MAX_DAYS = 366

/** Days in the default range, today included. */
const DEFAULT_RANGE_DAYS = 30

/** The last 30 days, today included. `today` is the South African calendar date. */
export function defaultCommunicationAnalyticsRange(today: ISODate): CommunicationAnalyticsRange {
  return { from: addDaysISO(today, -(DEFAULT_RANGE_DAYS - 1)), to: today }
}

/** Why a range cannot be shown, or undefined when it can. */
export function communicationAnalyticsRangeProblem(range: { from: string; to: string }): string | undefined {
  if (!isValidISODate(range.from) || !isValidISODate(range.to)) return 'Enter dates as YYYY-MM-DD.'
  if (compareISODate(range.from, range.to) > 0) return 'The end date must be on or after the start date.'
  if (daysBetween(range.from, range.to) + 1 > COMMUNICATION_ANALYTICS_MAX_DAYS) {
    return `Choose a range of at most ${COMMUNICATION_ANALYTICS_MAX_DAYS} days.`
  }
  return undefined
}

/** `part` as a whole percentage of `whole`, or undefined when `whole` is zero. */
export function shareOf(part: number, whole: number): number | undefined {
  if (whole <= 0) return undefined
  return Math.round((part / whole) * 100)
}

const COUNT_FORMATTER = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })

/** A whole count as `1 250`: thousands grouped with regular spaces (Intl emits no-break spaces; see money.ts). */
export function formatCount(count: number): string {
  return COUNT_FORMATTER.format(count).replace(/[\u00a0\u202f\u2009]/g, ' ')
}
