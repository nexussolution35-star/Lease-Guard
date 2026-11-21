import type { ISODate, ZAR } from './common.js'
import type { MonitoringEventType } from './monitoring.js'

/**
 * The dashboard's monitoring figures (PRD §7.1) and the one monitoring event type each counts. A figure counts the
 * company's OPEN events of its type (`OPEN_EVENT_STATUSES`): what the daily lease monitoring found on verified leases
 * and has not been resolved or dismissed. The dashboard links each figure to the monitoring list filtered the same way,
 * so the figure and the list always agree.
 */
export const DASHBOARD_EVENT_FIGURES = {
  escalationDiscrepancies: 'rental_escalation_discrepancy',
  upcomingExpiries: 'lease_expiry',
  renewalDeadlines: 'renewal_notice_deadline',
  expiringGuarantees: 'guarantee_expiry',
} as const satisfies Readonly<Record<string, MonitoringEventType>>
export type DashboardEventFigure = keyof typeof DASHBOARD_EVENT_FIGURES

/**
 * Every figure the dashboard shows (PRD §7.1), for the active company, calculated by the API from the database in one
 * request. Counts and balances are monitoring figures, never transactions.
 */
export interface DashboardSummary extends Readonly<Record<DashboardEventFigure, number>> {
  /** The South African calendar day the figures are as of (balances are aged to it). */
  readonly asOf: ISODate
  /** Properties that are not archived. */
  readonly properties: number
  /** Units of those properties. */
  readonly units: number
  /** Of those units, the ones whose occupancy is `occupied` (a current lease or an assigned tenant keeps it so). */
  readonly occupiedUnits: number
  /** Leases with status `active`. */
  readonly activeLeases: number
  /** The outstanding balance on each unit's latest verified statement, totalled (the statements arrears summary). */
  readonly totalOutstanding: ZAR
  /** Distinct tenants with an outstanding balance on a latest verified statement. */
  readonly tenantsInArrears: number
  /** Payment arrangements with status `active`. */
  readonly activeArrangements: number
  /** Statements waiting for review (`review_required`). */
  readonly pendingStatementReviews: number
  /** Tenant messages waiting on a property manager's approval (approval requests with decision `pending`). */
  readonly pendingApprovals: number
}
