import type {
  EntityId,
  ISODate,
  MessageTypeTemplateMapping,
  OwnerSummaryDeliveryJob,
  OwnerSummaryAttentionItem,
  OwnerSummaryEvent,
  OwnerWeeklySummary,
  UserRole,
  UserStatus,
  Weekday,
  ZAR,
} from '../types/index.js'
import { OWNER_SUMMARY_DELIVERY_QUEUE, WEEKDAYS } from '../types/index.js'
import { buildArrearsReport, buildPaymentArrangementsReport, type ArrearsReportAccount, type ReportArrangement } from './arrearsReports.js'
import { canSendOwnerMessage } from './communicationEligibility.js'
import { addDaysISO, compareISODate, formatSADate, parseISODate } from './dates.js'
import type { EscalationTolerance } from './escalation.js'
import { checkOutboundMessage, fillPlaceholders, templatePlaceholders } from './messageContent.js'
import { messageTypeTemplateState } from './messageTemplates.js'
import { formatZAR, roundZar, sumZar } from './money.js'
import {
  buildLeaseMonitoringReport,
  buildRentalDiscrepancyReport,
  type MonitoringReportEvent,
  type RentalComparisonLease,
} from './monitoringReports.js'
import { buildDepositsGuaranteesReport, type LeaseSecurityRecord } from './securityReports.js'

/**
 * The weekly owner portfolio summary (PRD §4.1, §6.4, §12.9; ticket R-07): what each property owner is told every
 * week on WhatsApp. Every figure comes from the report rules the Reports page uses (arrears, lease monitoring, rental
 * discrepancies, deposits and guarantees, payment arrangements), narrowed to the owner's properties, so the summary
 * agrees with the reports, the dashboard and monitoring. Verified records only: the arrears come from verified
 * statements and the discrepancies and guarantees from verified lease terms. Trends over time are future work
 * (PRD §17.2); the one comparison is the change in the outstanding total since the owner's previous stored summary.
 */

/** Monday of the ISO week `asOf` falls in: the week a summary is for. */
export function ownerSummaryWeekStart(asOf: ISODate): ISODate {
  const day = parseISODate(asOf).getDay() // 0 = Sunday
  return addDaysISO(asOf, -((day + 6) % 7))
}

/** The weekday of an ISO date. */
export function weekdayOf(date: ISODate): Weekday {
  return WEEKDAYS[(parseISODate(date).getDay() + 6) % 7] as Weekday
}

/** Whether the weekly job sends a company's summaries on `asOf` (its owner summary weekday). */
export function isOwnerSummaryDay(asOf: ISODate, weekday: Weekday): boolean {
  return weekdayOf(asOf) === weekday
}

/** The next date on or after `asOf` that is the company's owner summary weekday. */
export function nextOwnerSummaryDate(asOf: ISODate, weekday: Weekday): ISODate {
  const ahead = (WEEKDAYS.indexOf(weekday) - WEEKDAYS.indexOf(weekdayOf(asOf)) + 7) % 7
  return addDaysISO(asOf, ahead)
}

/** The company records the summary is computed from, as the reporting functions return them. */
export interface OwnerSummarySources {
  accounts: readonly ArrearsReportAccount[]
  arrangements: readonly ReportArrangement[]
  ageingBuckets?: readonly number[]
  graceDays?: number
  events: readonly MonitoringReportEvent[]
  rentalComparisons: readonly RentalComparisonLease[]
  tolerance?: EscalationTolerance
  security: readonly LeaseSecurityRecord[]
  guaranteeNoticeDays: readonly number[]
}

export interface OwnerSummaryInput {
  owner: { userId: EntityId; name: string }
  /** The owner's properties (not archived). */
  properties: readonly { propertyId: EntityId; propertyName: string }[]
  asOf: ISODate
  /** The owner's latest stored summary of an earlier week, if any. */
  previous?: { weekStart: ISODate; totalOutstanding: ZAR } | null
  sources: OwnerSummarySources
}

const IMPORTANT_PRIORITIES = new Set(['critical', 'high'])

/** One owner's summary for the week `asOf` falls in. */
export function buildOwnerWeeklySummary(input: OwnerSummaryInput): OwnerWeeklySummary {
  const { asOf, sources } = input
  const properties = [...input.properties].sort((a, b) => a.propertyName.localeCompare(b.propertyName))
  // Never empty: a summary without properties would read the whole company (no property filter = every property).
  const propertyIds = properties.length > 0 ? properties.map((p) => p.propertyId) : ['00000000-0000-0000-0000-000000000000']
  const filters = { propertyIds }

  const arrears = buildArrearsReport({ accounts: sources.accounts, arrangements: sources.arrangements, asOf, ...(sources.ageingBuckets ? { buckets: sources.ageingBuckets } : {}), filters })
  const monitoring = buildLeaseMonitoringReport(sources.events, asOf, filters)
  const discrepancyReport = buildRentalDiscrepancyReport(
    { leases: sources.rentalComparisons, events: sources.events, ...(sources.tolerance ? { tolerance: sources.tolerance } : {}) },
    filters,
  )
  const security = buildDepositsGuaranteesReport(sources.security, asOf, sources.guaranteeNoticeDays, filters)
  const arrangements = buildPaymentArrangementsReport({ arrangements: sources.arrangements, asOf, ...(sources.graceDays !== undefined ? { graceDays: sources.graceDays } : {}), filters })

  const importantEvents: OwnerSummaryEvent[] = monitoring.events
    .filter((event) => IMPORTANT_PRIORITIES.has(event.priority) || event.overdue)
    .map((event) => ({
      eventId: event.eventId,
      type: event.type,
      title: event.title,
      priority: event.priority,
      status: event.status,
      propertyId: event.propertyId,
      propertyName: event.propertyName,
      identifiedOn: event.identifiedOn,
      ...(event.dueDate ? { dueDate: event.dueDate } : {}),
      overdue: event.overdue,
    }))

  const discrepancies = discrepancyReport.rows
    .filter((row) => row.current && !row.withinTolerance)
    .map((row) => ({
      leaseId: row.leaseId,
      leaseReference: row.leaseReference,
      tenantName: row.tenantName,
      propertyId: row.propertyId,
      propertyName: row.propertyName,
      expected: row.expected,
      billed: row.billed,
      difference: row.difference,
    }))

  const expiringGuarantees = security.rows
    .filter((row) => row.guaranteeState === 'expiring' && row.guaranteeExpiresOn !== undefined)
    .map((row) => ({
      leaseId: row.leaseId,
      reference: row.reference,
      tenantName: row.tenantName,
      propertyId: row.propertyId,
      propertyName: row.propertyName,
      ...(row.guaranteeBank ? { guaranteeBank: row.guaranteeBank } : {}),
      ...(row.guaranteeAmount !== undefined ? { guaranteeAmount: row.guaranteeAmount } : {}),
      expiresOn: row.guaranteeExpiresOn as ISODate,
      daysUntilExpiry: row.guaranteeDaysUntilExpiry ?? 0,
    }))
    .sort((a, b) => compareISODate(a.expiresOn, b.expiresOn))

  const attention: OwnerSummaryAttentionItem[] = [
    ...monitoring.events
      .filter((event) => event.overdue || event.status === 'action_required')
      .map((event): OwnerSummaryAttentionItem => ({
        kind: event.overdue ? 'overdue_event' : 'action_required_event',
        title: event.overdue ? `${event.title} (overdue)` : `${event.title} (action required)`,
        propertyId: event.propertyId,
        propertyName: event.propertyName,
        record: { entity: 'monitoring_event', id: event.eventId },
      })),
    ...arrangements.rows
      .filter((row) => row.status === 'active' && (row.missedCount > 0 || row.overdueCount > 0))
      .map((row): OwnerSummaryAttentionItem => ({
        kind: 'arrangement_instalments',
        title: `${row.tenantName}: ${instalments(row.missedCount, 'missed')}${row.missedCount > 0 && row.overdueCount > 0 ? ', ' : ''}${instalments(row.overdueCount, 'overdue')} on the payment arrangement`,
        propertyId: row.propertyId,
        propertyName: row.propertyName,
        record: { entity: 'payment_arrangement', id: row.arrangementId },
      })),
    ...security.rows
      .filter((row) => row.guaranteeState === 'expired' || row.depositShortfall > 0 || row.guaranteeShortfall > 0)
      .map((row): OwnerSummaryAttentionItem => ({
        kind: row.guaranteeState === 'expired' ? 'guarantee_expired' : 'security_shortfall',
        title:
          row.guaranteeState === 'expired'
            ? `${row.tenantName}: bank guarantee expired`
            : `${row.tenantName}: security below the required cover by ${formatZAR(row.depositShortfall + row.guaranteeShortfall)}`,
        propertyId: row.propertyId,
        propertyName: row.propertyName,
        record: { entity: 'lease', id: row.leaseId },
      })),
  ]

  const previous = input.previous ?? null
  return {
    ownerUserId: input.owner.userId,
    ownerName: input.owner.name,
    weekStart: ownerSummaryWeekStart(asOf),
    asOf,
    properties,
    totalOutstanding: arrears.totalOutstanding,
    tenantsInArrears: arrears.tenantCount,
    outstandingUnderArrangement: arrears.outstandingUnderArrangement,
    previous,
    outstandingChange: previous ? roundZar(arrears.totalOutstanding - previous.totalOutstanding) : null,
    openEventCount: monitoring.open,
    importantEvents,
    discrepancies,
    discrepancyMonthlyDifference: sumZar(discrepancies.map((row) => row.difference)),
    expiringGuarantees,
    attention,
  }
}

function instalments(count: number, word: string): string {
  if (count === 0) return ''
  return `${count} ${count === 1 ? 'instalment' : 'instalments'} ${word}`
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/** The change since the previous summary in words, e.g. `up R 2 000,00 since 16 Nov 2026`. */
export function outstandingChangeText(summary: Pick<OwnerWeeklySummary, 'outstandingChange' | 'previous'>): string {
  if (summary.previous === null || summary.outstandingChange === null) return 'first weekly summary'
  const since = `since ${formatSADate(summary.previous.weekStart)}`
  if (summary.outstandingChange === 0) return `unchanged ${since}`
  return `${summary.outstandingChange > 0 ? 'up' : 'down'} ${formatZAR(Math.abs(summary.outstandingChange))} ${since}`
}

/**
 * The summary in one line, for the template's last placeholder (WhatsApp template parameters cannot hold line breaks).
 * South African formats (en-ZA, ZAR), as everything the backend writes. Monitoring figures only: no bank details.
 */
export function ownerSummaryLine(summary: OwnerWeeklySummary): string {
  return [
    `Outstanding ${formatZAR(summary.totalOutstanding)} (${outstandingChangeText(summary)})`,
    plural(summary.importantEvents.length, 'important monitoring event', 'important monitoring events'),
    plural(summary.discrepancies.length, 'rental discrepancy', 'rental discrepancies'),
    plural(summary.expiringGuarantees.length, 'guarantee expiring', 'guarantees expiring'),
    `${plural(summary.attention.length, 'item needs', 'items need')} your attention`,
  ].join('; ')
}

/** The values of the owner_weekly_summary template's placeholders: {{1}} owner name, {{2}} week, {{3}} the summary. */
export function ownerSummaryTemplateValues(summary: OwnerWeeklySummary): string[] {
  return [summary.ownerName, formatSADate(summary.weekStart), ownerSummaryLine(summary)]
}

/** The placeholders the owner summary fills. */
export const OWNER_SUMMARY_PLACEHOLDERS = 3

/**
 * Why the chosen template cannot carry the summary (empty when it can): it may use only {{1}}, {{2}} and {{3}}, since
 * those are the values LeaseGuard has.
 */
export function ownerSummaryTemplateProblems(body: string): string[] {
  const extra = templatePlaceholders(body).filter((n) => n > OWNER_SUMMARY_PLACEHOLDERS)
  return extra.length > 0
    ? [`The owner summary template uses ${extra.map((n) => `{{${n}}}`).join(', ')}; LeaseGuard fills {{1}} owner name, {{2}} week and {{3}} summary only. Choose a template with at most three placeholders.`]
    : []
}

/** The WhatsApp text: the template's body with the values filled in. Throws when the template needs more values. */
export function ownerSummaryMessage(templateBody: string, values: readonly string[]): string {
  return fillPlaceholders(templateBody, Object.fromEntries(values.map((value, i) => [i + 1, value])))
}

/** What the company's readiness depends on: the template chosen for owner_weekly_summary and its WhatsApp numbers. */
export interface OwnerSummaryChannel {
  mapping?: MessageTypeTemplateMapping
  /** At least one of the company's WhatsApp numbers is connected. */
  whatsappConnected: boolean
}

/**
 * Why the company sends no owner summary now (empty when it can): an approved template must be chosen for the type in
 * Settings → Message templates, it must fit the summary, and a number must be connected (each company sends from its
 * own WhatsApp Business number). The core's outbound gate checks the same again before sending.
 */
export function ownerSummaryCompanyBlockers(channel: OwnerSummaryChannel): string[] {
  const state = messageTypeTemplateState(channel.mapping)
  const blockers: string[] = []
  if (!state.sendable) blockers.push(`Weekly owner summary template: ${state.summary}${state.nextStep ? ` ${state.nextStep}` : ''}`)
  else if (channel.mapping) blockers.push(...ownerSummaryTemplateProblems(channel.mapping.body))
  if (!channel.whatsappConnected) blockers.push('No WhatsApp number is connected: connect the company’s own WhatsApp Business number in Settings → WhatsApp.')
  return blockers
}

/** The owner as the reporting functions describe them. */
export interface OwnerSummaryRecipient {
  status: UserStatus
  whatsappNumber?: string
  /** The owner's role in the company. */
  role: UserRole
}

/**
 * Why this owner cannot receive the summary (empty when they can): the owner message rules (`canSendOwnerMessage`, the
 * outbound gate's rules) and the summary's own text check (no bank details).
 */
export function ownerSummaryRecipientBlockers(companyId: EntityId, owner: OwnerSummaryRecipient, values: readonly string[]): string[] {
  const eligibility = canSendOwnerMessage(
    {
      status: owner.status,
      ...(owner.whatsappNumber ? { whatsappNumber: owner.whatsappNumber } : {}),
      memberships: [{ companyId, role: owner.role, isDefault: false, joinedAt: '1970-01-01T00:00:00Z' }],
    },
    'owner_weekly_summary',
    companyId,
  )
  return [...eligibility.reasons, ...checkOutboundMessage(values.join(' '), 'property_owner').errors]
}

/**
 * The id of the `owner-summary-delivery` job of one stored summary, by the core's job id convention
 * (`<queue>.<key fields>`, lowercased and URI-encoded: backend/src/infrastructure/queues/queue-registry.ts `jobIdFor`),
 * so a summary handed over twice is one job.
 */
export function ownerSummaryDeliveryJobId(job: OwnerSummaryDeliveryJob): string {
  return [OWNER_SUMMARY_DELIVERY_QUEUE, ...[job.companyId, job.summaryId].map((value) => encodeURIComponent(value.toLowerCase()))].join('.')
}
