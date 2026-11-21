import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isValid,
  startOfMonth,
} from 'date-fns'
import type { ISODate, ISODateTime } from '../types/index.js'

/**
 * Date helpers. `ISODate` is `YYYY-MM-DD` with no time component and is treated as a plain
 * calendar date (constructed as a LOCAL date, never via `Date.parse`, so there is no UTC shift).
 * Nothing here calls `new Date()` for "now"; callers pass `today` explicitly.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Convert an ISODate to a local-midnight Date. Throws on malformed input. */
export function parseISODate(iso: ISODate): Date {
  const m = ISO_DATE_RE.exec(iso)
  if (!m) throw new Error(`Invalid ISODate: ${iso}`)
  const [, y, mo, d] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  if (!isValid(date)) throw new Error(`Invalid ISODate: ${iso}`)
  return date
}

/** Format a Date's LOCAL calendar date as ISODate. */
export function toISODate(date: Date): ISODate {
  return format(date, 'yyyy-MM-dd')
}

/** Today's ISODate for the supplied clock Date (callers pass `new Date()` at the edge). */
export function isoToday(now: Date): ISODate {
  return toISODate(now)
}

/** True for a well-formed, real calendar date (rejects 2026-02-30). */
export function isValidISODate(value: string): value is ISODate {
  const m = ISO_DATE_RE.exec(value)
  if (!m) return false
  const [, y, mo, d] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  return (
    isValid(date) &&
    date.getFullYear() === Number(y) &&
    date.getMonth() === Number(mo) - 1 &&
    date.getDate() === Number(d)
  )
}

/** -1 | 0 | 1 like a comparator; valid ISODates sort lexically. */
export function compareISODate(a: ISODate, b: ISODate): -1 | 0 | 1 {
  if (a === b) return 0
  return a < b ? -1 : 1
}

export function minISODate(a: ISODate, b: ISODate): ISODate {
  return compareISODate(a, b) <= 0 ? a : b
}

export function maxISODate(a: ISODate, b: ISODate): ISODate {
  return compareISODate(a, b) >= 0 ? a : b
}

/** Signed calendar days from `a` to `b` (positive when `b` is after `a`). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return differenceInCalendarDays(parseISODate(b), parseISODate(a))
}

export function addDaysISO(iso: ISODate, days: number): ISODate {
  return toISODate(addDays(parseISODate(iso), days))
}

/** Add months; day-of-month is clamped to the target month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonthsISO(iso: ISODate, months: number): ISODate {
  return toISODate(addMonths(parseISODate(iso), months))
}

export function startOfMonthISO(iso: ISODate): ISODate {
  return toISODate(startOfMonth(parseISODate(iso)))
}

export function endOfMonthISO(iso: ISODate): ISODate {
  return toISODate(endOfMonth(parseISODate(iso)))
}

export type SADateStyle = 'short' | 'long' | 'numeric'

const SA_DATE_PATTERNS: Record<SADateStyle, string> = {
  short: 'dd MMM yyyy', // 06 Nov 2026
  long: 'd MMMM yyyy', // 6 November 2026
  numeric: 'dd/MM/yyyy', // 06/11/2026
}

/** South African display format. Default `short` → `06 Nov 2026`. */
export function formatSADate(iso: ISODate, style: SADateStyle = 'short'): string {
  return format(parseISODate(iso), SA_DATE_PATTERNS[style])
}

const ISO_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/

/**
 * Format an ISODateTime as `06 Nov 2026, 08:30`. The wall-clock time is taken AS WRITTEN in
 * the timestamp (project convention: `+02:00`, Africa/Johannesburg) so output does not depend
 * on the machine's timezone.
 */
export function formatSADateTime(isoDateTime: ISODateTime, style: SADateStyle = 'short'): string {
  const m = ISO_DATETIME_RE.exec(isoDateTime)
  if (!m) throw new Error(`Invalid ISODateTime: ${isoDateTime}`)
  const [, datePart, hh, mm] = m
  return `${formatSADate(datePart, style)}, ${hh}:${mm}`
}

/**
 * Web-app display formats a user may choose in Settings → Preferences. Display only: stored values are ISO,
 * and tenant messages, audit summaries and anything the backend writes keep `formatSADate` (en-ZA).
 */
export type DateDisplayFormat = 'dd-mmm-yyyy' | 'd-mmmm-yyyy' | 'dd/mm/yyyy' | 'yyyy/mm/dd' | 'mmm-d-yyyy' | 'yyyy-mm-dd'

/** The default: the South African short format, the same as `formatSADate`. */
export const DEFAULT_DATE_DISPLAY_FORMAT: DateDisplayFormat = 'dd-mmm-yyyy'

const DATE_DISPLAY_PATTERNS: Record<DateDisplayFormat, string> = {
  'dd-mmm-yyyy': SA_DATE_PATTERNS.short, // 06 Nov 2026
  'd-mmmm-yyyy': SA_DATE_PATTERNS.long, // 6 November 2026
  'dd/mm/yyyy': SA_DATE_PATTERNS.numeric, // 06/11/2026
  'yyyy/mm/dd': 'yyyy/MM/dd', // 2026/11/06
  'mmm-d-yyyy': 'MMM d, yyyy', // Nov 6, 2026
  'yyyy-mm-dd': 'yyyy-MM-dd', // 2026-11-06
}

/** In the order Preferences lists them, the default first. */
export const DATE_DISPLAY_FORMATS = Object.keys(DATE_DISPLAY_PATTERNS) as readonly DateDisplayFormat[]

export function isDateDisplayFormat(value: unknown): value is DateDisplayFormat {
  return typeof value === 'string' && (DATE_DISPLAY_FORMATS as readonly string[]).includes(value)
}

/** A calendar date in the chosen display format. Throws on a malformed ISODate. */
export function formatDisplayDate(iso: ISODate, displayFormat: DateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT): string {
  return format(parseISODate(iso), DATE_DISPLAY_PATTERNS[displayFormat])
}

/** A timestamp as `<date>, 08:30`, the wall-clock time as written (see `formatSADateTime`). */
export function formatDisplayDateTime(isoDateTime: ISODateTime, displayFormat: DateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT): string {
  const m = ISO_DATETIME_RE.exec(isoDateTime)
  if (!m) throw new Error(`Invalid ISODateTime: ${isoDateTime}`)
  const [, datePart, hh, mm] = m
  return `${formatDisplayDate(datePart, displayFormat)}, ${hh}:${mm}`
}

/** `today` falls within [start, end] inclusive. */
export function isWithinISO(today: ISODate, start: ISODate, end: ISODate): boolean {
  return compareISODate(today, start) >= 0 && compareISODate(today, end) <= 0
}
