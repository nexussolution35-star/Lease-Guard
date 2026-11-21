import type { ISODate } from '../types/index.js'
import { addDaysISO } from './dates.js'

/**
 * Due-date windows of the monitoring list, shared by the API (which turns one into a date range) and the screen
 * (which offers them). `overdue` is due before today; `next_n_days` is due from today to n days from today, inclusive.
 * "Today" is the South African date, supplied by the caller.
 */
export const MONITORING_DUE_WINDOWS = ['overdue', 'next_7_days', 'next_30_days', 'next_90_days'] as const
export type MonitoringDueWindow = (typeof MONITORING_DUE_WINDOWS)[number]

const WINDOW_DAYS: Readonly<Record<Exclude<MonitoringDueWindow, 'overdue'>, number>> = {
  next_7_days: 7,
  next_30_days: 30,
  next_90_days: 90,
}

/** The inclusive due-date range of a window: `from` and/or `to` (an open end is absent). */
export function dueWindowRange(window: MonitoringDueWindow, today: ISODate): { from?: ISODate; to: ISODate } {
  if (window === 'overdue') return { to: addDaysISO(today, -1) }
  return { from: today, to: addDaysISO(today, WINDOW_DAYS[window]) }
}

/**
 * The assignee filter of the monitoring list: one member's id, or `unassigned` for events nobody is assigned to.
 */
export const UNASSIGNED_FILTER = 'unassigned' as const
