import type { EntityId, ISODate, ZAR } from '../types/common.js'
import type { LeaseEscalation, LeaseStatus } from '../types/lease.js'
import {
  EVENT_PRIORITIES,
  MONITORING_EVENT_STATUSES,
  MONITORING_EVENT_TYPES,
  type EventCalculation,
  type EventPriority,
  type MonitoringEventStatus,
  type MonitoringEventType,
} from '../types/monitoring.js'
import {
  EVENT_AGE_BUCKETS,
  type EventAgeBucket,
  type LeaseMonitoringReport,
  type MonitoringEventRow,
  type RentalComparisonState,
  type RentalDiscrepancyReport,
  type RentalDiscrepancyRow,
  type ReportFilters,
} from '../types/reports.js'
import { compareISODate, daysBetween } from './dates.js'
import { compareBilledRental, type EscalationTolerance } from './escalation.js'
import { MONITORED_LEASE_STATUSES } from './leaseExpiry.js'
import { roundZar, sumZar } from './money.js'
import { isOpenEventStatus, OPEN_EVENT_STATUSES } from './monitoringWorkflow.js'
import { inReportProperties, inReportStatuses } from './reportFrame.js'

/**
 * The lease monitoring and rental discrepancy reports (ticket R-02, PRD §4.1, §7, §12.9), put together from the rows
 * the database returns (supabase/migrations/*_reports_monitoring_discrepancies.sql) with the rules monitoring uses:
 * open = OPEN_EVENT_STATUSES (as the monitoring list and the dashboard), and a rental comparison is the lease
 * monitoring scan's (backend lease-monitoring.findings.ts): only verified leases in a monitored status, the rental
 * billed on the lease's latest verified statement against `compareBilledRental` at the billed period's start, with the
 * company's rental escalation discrepancy tolerance. Pure: the caller supplies the rows and the "as at" date.
 */

// ---------------------------------------------------------------------------------- lease monitoring

/** One monitoring event, as `reports_monitoring_events` returns it. */
export interface MonitoringReportEvent {
  eventId: EntityId
  type: MonitoringEventType
  title: string
  priority: EventPriority
  status: MonitoringEventStatus
  propertyId: EntityId
  propertyName: string
  unitNumber?: string
  tenantId?: EntityId
  tenantName?: string
  leaseId?: EntityId
  leaseReference?: string
  statementId?: EntityId
  /** The date and billed period start of the event's statement, when it names one. */
  statementDate?: ISODate
  periodStart?: ISODate
  identifiedOn: ISODate
  dueDate?: ISODate
  /** The explainable calculation of a financial event. */
  calculation?: EventCalculation
}

/** The age bucket of an event open for `days` days. */
export function eventAgeBucket(days: number): EventAgeBucket {
  if (days <= 7) return '0-7'
  if (days <= 30) return '8-30'
  if (days <= 90) return '31-90'
  return '90+'
}

const zeroes = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>

const priorityRank = (priority: EventPriority): number => EVENT_PRIORITIES.indexOf(priority)

/**
 * The lease monitoring report: the events at the filtered properties identified in the date range, of the statuses
 * asked for, or the open events without a status filter; each with its age on `asOf`; counted by type, priority,
 * status, property and age. Oldest first, then critical first.
 */
export function buildLeaseMonitoringReport(events: readonly MonitoringReportEvent[], asOf: ISODate, filters: ReportFilters = {}): LeaseMonitoringReport {
  const statuses = filters.statuses && filters.statuses.length > 0 ? filters : { statuses: OPEN_EVENT_STATUSES }
  const rows: MonitoringEventRow[] = events
    .filter(
      (event) =>
        inReportProperties(filters, event.propertyId) &&
        inReportStatuses(statuses, event.status) &&
        (!filters.from || compareISODate(event.identifiedOn, filters.from) >= 0) &&
        (!filters.to || compareISODate(event.identifiedOn, filters.to) <= 0),
    )
    .map((event): MonitoringEventRow => {
      const ageDays = Math.max(0, daysBetween(event.identifiedOn, asOf))
      return {
        eventId: event.eventId,
        type: event.type,
        title: event.title,
        priority: event.priority,
        status: event.status,
        propertyId: event.propertyId,
        propertyName: event.propertyName,
        ...(event.unitNumber ? { unitNumber: event.unitNumber } : {}),
        ...(event.tenantId ? { tenantId: event.tenantId } : {}),
        ...(event.tenantName ? { tenantName: event.tenantName } : {}),
        ...(event.leaseId ? { leaseId: event.leaseId } : {}),
        ...(event.leaseReference ? { leaseReference: event.leaseReference } : {}),
        ...(event.statementId ? { statementId: event.statementId } : {}),
        identifiedOn: event.identifiedOn,
        ...(event.dueDate ? { dueDate: event.dueDate } : {}),
        ageDays,
        ageBucket: eventAgeBucket(ageDays),
        overdue: isOpenEventStatus(event.status) && event.dueDate !== undefined && compareISODate(event.dueDate, asOf) < 0,
      }
    })
    .sort(
      (a, b) =>
        compareISODate(a.identifiedOn, b.identifiedOn) ||
        priorityRank(b.priority) - priorityRank(a.priority) ||
        a.propertyName.localeCompare(b.propertyName) ||
        a.eventId.localeCompare(b.eventId),
    )

  const byType = zeroes(MONITORING_EVENT_TYPES)
  const byPriority = zeroes(EVENT_PRIORITIES)
  const byStatus = zeroes(MONITORING_EVENT_STATUSES)
  const byAge = zeroes(EVENT_AGE_BUCKETS)
  const byProperty = new Map<EntityId, { propertyId: EntityId; propertyName: string; total: number; open: number; overdue: number }>()
  for (const row of rows) {
    byType[row.type] += 1
    byPriority[row.priority] += 1
    byStatus[row.status] += 1
    byAge[row.ageBucket] += 1
    const property = byProperty.get(row.propertyId) ?? { propertyId: row.propertyId, propertyName: row.propertyName, total: 0, open: 0, overdue: 0 }
    property.total += 1
    if (isOpenEventStatus(row.status)) property.open += 1
    if (row.overdue) property.overdue += 1
    byProperty.set(row.propertyId, property)
  }

  return {
    total: rows.length,
    open: rows.filter((row) => isOpenEventStatus(row.status)).length,
    overdue: rows.filter((row) => row.overdue).length,
    byType,
    byPriority,
    byStatus,
    byProperty: [...byProperty.values()].sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.propertyId.localeCompare(b.propertyId)),
    byAge: EVENT_AGE_BUCKETS.map((bucket) => ({ bucket, count: byAge[bucket] })),
    events: rows,
  }
}

// ---------------------------------------------------------------------------------- rental discrepancies

/** The latest verified statement of a lease that bills rental, as `reports_rental_comparisons` returns it. */
export interface BilledStatement {
  statementId: EntityId
  statementDate: ISODate
  periodStart: ISODate
  rentalCharged: ZAR
}

/** One lease with its escalation terms and its latest billed statement, as `reports_rental_comparisons` returns it. */
export interface RentalComparisonLease {
  leaseId: EntityId
  reference: string
  status: LeaseStatus
  verified: boolean
  propertyId: EntityId
  propertyName: string
  unitNumber?: string
  tenantId: EntityId
  tenantName: string
  commencementDate: ISODate
  expiryDate: ISODate
  initialMonthlyRental: ZAR
  escalation: LeaseEscalation
  /** Absent when the lease has no verified statement that bills rental. */
  billed?: BilledStatement
}

export interface RentalDiscrepancyInput {
  leases: readonly RentalComparisonLease[]
  /** The company's monitoring events; only the rental escalation discrepancy events are read. */
  events: readonly MonitoringReportEvent[]
  /** The company's rental escalation discrepancy rule tolerance (none: exact). */
  tolerance?: EscalationTolerance
}

/** Leases whose terms are still waiting for verification: they drive no financial monitoring until verified. */
const AWAITING_VERIFICATION: readonly LeaseStatus[] = ['draft', 'pending_verification']

const comparisonState = (row: RentalDiscrepancyRow): RentalComparisonState => (row.withinTolerance ? 'within_tolerance' : 'outside_tolerance')

/** The event of a statement: an open one first, else the latest identified. */
function eventFor(events: readonly MonitoringReportEvent[]): MonitoringReportEvent | undefined {
  return [...events].sort(
    (a, b) => Number(isOpenEventStatus(b.status)) - Number(isOpenEventStatus(a.status)) || compareISODate(b.identifiedOn, a.identifiedOn),
  )[0]
}

/**
 * The rental discrepancy report: for every verified lease in a monitored status, the rental billed on its latest
 * verified statement against the escalated contractual rental at the billed period's start (the monitoring scan's
 * comparison, with the same tolerance), linked to the discrepancy event raised for that statement; and every open
 * discrepancy event not on such a comparison (an earlier statement, or a lease no longer monitored), with the
 * calculation it recorded. Narrowed to the filtered properties, billing periods and comparison outcomes. Largest
 * difference first.
 */
export function buildRentalDiscrepancyReport(input: RentalDiscrepancyInput, filters: ReportFilters = {}): RentalDiscrepancyReport {
  const tolerance = input.tolerance ?? { toleranceRands: 0, tolerancePercent: 0 }
  const discrepancyEvents = input.events.filter((event) => event.type === 'rental_escalation_discrepancy')
  const eventsByStatement = new Map<EntityId, MonitoringReportEvent[]>()
  for (const event of discrepancyEvents) {
    if (!event.statementId) continue
    eventsByStatement.set(event.statementId, [...(eventsByStatement.get(event.statementId) ?? []), event])
  }

  const atProperties = input.leases.filter((lease) => inReportProperties(filters, lease.propertyId))
  const monitored = atProperties.filter((lease) => MONITORED_LEASE_STATUSES.includes(lease.status))
  const compared = monitored.filter((lease) => lease.verified && lease.billed)

  const rows: RentalDiscrepancyRow[] = []
  const shownStatements = new Set<EntityId>()
  for (const lease of compared) {
    const billed = lease.billed
    if (!billed) continue
    const comparison = compareBilledRental(lease, billed.rentalCharged, billed.periodStart, tolerance)
    const event = eventFor(eventsByStatement.get(billed.statementId) ?? [])
    shownStatements.add(billed.statementId)
    rows.push({
      source: event ? 'event' : 'recomputed',
      current: true,
      ...(event ? { eventId: event.eventId, eventStatus: event.status } : {}),
      leaseId: lease.leaseId,
      leaseReference: lease.reference,
      tenantId: lease.tenantId,
      tenantName: lease.tenantName,
      propertyId: lease.propertyId,
      propertyName: lease.propertyName,
      ...(lease.unitNumber ? { unitNumber: lease.unitNumber } : {}),
      statementId: billed.statementId,
      statementDate: billed.statementDate,
      periodStart: billed.periodStart,
      expected: comparison.expected,
      billed: comparison.billed,
      difference: comparison.difference,
      withinTolerance: comparison.withinTolerance,
      steps: comparison.calculation.steps,
    })
  }

  // Open events the comparisons above do not show, with the figures they recorded.
  const leasesById = new Map(input.leases.map((lease) => [lease.leaseId, lease]))
  for (const event of discrepancyEvents) {
    if (!isOpenEventStatus(event.status) || !event.leaseId || !event.tenantId) continue
    if (event.statementId && shownStatements.has(event.statementId)) continue
    if (!inReportProperties(filters, event.propertyId)) continue
    const expected = event.calculation?.expectedAmount
    const billed = event.calculation?.actualAmount
    if (expected === undefined || billed === undefined) continue
    const lease = leasesById.get(event.leaseId)
    rows.push({
      source: 'event',
      current: false,
      eventId: event.eventId,
      eventStatus: event.status,
      leaseId: event.leaseId,
      leaseReference: event.leaseReference ?? lease?.reference ?? '',
      tenantId: event.tenantId,
      tenantName: event.tenantName ?? lease?.tenantName ?? '',
      propertyId: event.propertyId,
      propertyName: event.propertyName,
      ...(event.unitNumber ? { unitNumber: event.unitNumber } : {}),
      ...(event.statementId ? { statementId: event.statementId } : {}),
      ...(event.statementDate ? { statementDate: event.statementDate } : {}),
      ...(event.periodStart ? { periodStart: event.periodStart } : {}),
      expected: roundZar(expected),
      billed: roundZar(billed),
      difference: roundZar(event.calculation?.difference ?? expected - billed),
      withinTolerance: false,
      steps: event.calculation?.steps ?? [],
    })
  }

  const shown = rows
    .filter(
      (row) =>
        inReportStatuses(filters, comparisonState(row)) &&
        (!filters.from || (row.periodStart !== undefined && compareISODate(row.periodStart, filters.from) >= 0)) &&
        (!filters.to || (row.periodStart !== undefined && compareISODate(row.periodStart, filters.to) <= 0)),
    )
    .sort(
      (a, b) =>
        Number(a.withinTolerance) - Number(b.withinTolerance) ||
        Math.abs(b.difference) - Math.abs(a.difference) ||
        a.propertyName.localeCompare(b.propertyName) ||
        a.leaseReference.localeCompare(b.leaseReference),
    )

  const outside = shown.filter((row) => !row.withinTolerance)
  return {
    rows: shown,
    totalMonthlyDifference: sumZar(outside.map((row) => row.difference)),
    underBilled: sumZar(outside.filter((row) => row.difference > 0).map((row) => row.difference)),
    overBilled: sumZar(outside.filter((row) => row.difference < 0).map((row) => -row.difference)),
    outsideToleranceCount: outside.length,
    eventCount: shown.filter((row) => row.source === 'event').length,
    recomputedCount: outside.filter((row) => row.source === 'recomputed').length,
    openEventCount: discrepancyEvents.filter((event) => isOpenEventStatus(event.status) && inReportProperties(filters, event.propertyId)).length,
    leasesCompared: compared.length,
    awaitingStatement: monitored.filter((lease) => lease.verified && !lease.billed).length,
    unverifiedLeasesExcluded: atProperties.filter((lease) => !lease.verified && AWAITING_VERIFICATION.includes(lease.status)).length,
  }
}
