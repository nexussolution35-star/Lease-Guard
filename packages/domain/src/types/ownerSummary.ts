import type { EntityId, ISODate, ISODateTime, ZAR } from './common.js'
import type { DeliveryStatus } from './communication.js'
import type { Weekday } from './company.js'
import type { EventPriority, MonitoringEventStatus, MonitoringEventType } from './monitoring.js'

/**
 * The weekly owner portfolio summary (PRD §4.1, §6.4, §12.9; ticket R-07). The reports service computes one per
 * property owner from verified records, stores it (`reports_owner_summaries`) so next week's "change since" is exact,
 * and hands it to the core messaging pipeline by queue; only the core worker sends WhatsApp messages (ADR 0003).
 * Owners only: a summary is never addressed to a tenant.
 */

/**
 * The queue between the two services: the reports worker asks the core messaging pipeline to send one stored summary.
 * The core worker records it as an `owner_weekly_summary` communication and delivers it through the outbound gate.
 */
export const OWNER_SUMMARY_DELIVERY_QUEUE = 'owner-summary-delivery' as const

/** The payload of an `owner-summary-delivery` job: identifiers only; the core reads the stored summary itself. */
export interface OwnerSummaryDeliveryJob {
  companyId: EntityId
  summaryId: EntityId
}

/** An open monitoring event the owner should know about: critical or high priority, or past its due date. */
export interface OwnerSummaryEvent {
  eventId: EntityId
  type: MonitoringEventType
  title: string
  priority: EventPriority
  status: MonitoringEventStatus
  propertyId: EntityId
  propertyName: string
  identifiedOn: ISODate
  dueDate?: ISODate
  overdue: boolean
}

/** A verified lease billed outside the company's escalation tolerance on its latest verified statement. */
export interface OwnerSummaryDiscrepancy {
  leaseId: EntityId
  leaseReference: string
  tenantName: string
  propertyId: EntityId
  propertyName: string
  expected: ZAR
  billed: ZAR
  /** expected − billed; positive = under-billed. */
  difference: ZAR
}

/** A bank guarantee in force that has reached the company's guarantee expiry notice days. */
export interface OwnerSummaryGuarantee {
  leaseId: EntityId
  reference: string
  tenantName: string
  propertyId: EntityId
  propertyName: string
  guaranteeBank?: string
  guaranteeAmount?: ZAR
  expiresOn: ISODate
  daysUntilExpiry: number
}

export const OWNER_ATTENTION_KINDS = ['overdue_event', 'action_required_event', 'arrangement_instalments', 'security_shortfall', 'guarantee_expired'] as const
export type OwnerAttentionKind = (typeof OWNER_ATTENTION_KINDS)[number]

/** Something that needs the owner's attention, with the record it is about. */
export interface OwnerSummaryAttentionItem {
  kind: OwnerAttentionKind
  title: string
  propertyId: EntityId
  propertyName: string
  /** The record to open: a monitoring event, a payment arrangement or a lease. */
  record: { entity: 'monitoring_event' | 'payment_arrangement' | 'lease'; id: EntityId }
}

/** One owner's summary for one week, computed from verified records only. */
export interface OwnerWeeklySummary {
  ownerUserId: EntityId
  ownerName: string
  /** Monday of the week the summary is for. */
  weekStart: ISODate
  /** The South African date the figures are as at. */
  asOf: ISODate
  /** The owner's properties that are not archived (`properties.owner_user_id`), by name. */
  properties: { propertyId: EntityId; propertyName: string }[]
  /** Outstanding on the latest verified statement of each account at the owner's properties (the dashboard's rules). */
  totalOutstanding: ZAR
  tenantsInArrears: number
  /** Outstanding of tenants under an active payment arrangement (still owed). */
  outstandingUnderArrangement: ZAR
  /** The owner's previous stored summary, or null for the first one. */
  previous: { weekStart: ISODate; totalOutstanding: ZAR } | null
  /** totalOutstanding − previous.totalOutstanding, or null without a previous summary. */
  outstandingChange: ZAR | null
  /** Open events at the owner's properties. */
  openEventCount: number
  /** Open events that are critical or high priority, or overdue: oldest first, then by priority. */
  importantEvents: OwnerSummaryEvent[]
  /** Current rental discrepancies outside tolerance, largest difference first. */
  discrepancies: OwnerSummaryDiscrepancy[]
  /** Sum of the differences of `discrepancies` (positive = under-billed). */
  discrepancyMonthlyDifference: ZAR
  /** Guarantees in force inside the notice days, soonest expiry first. */
  expiringGuarantees: OwnerSummaryGuarantee[]
  /** Overdue or action-required events, arrangements with missed or overdue instalments, security shortfalls. */
  attention: OwnerSummaryAttentionItem[]
}

/** Where this week's stored summary of an owner stands. */
export const OWNER_SUMMARY_STATUSES = ['ready', 'blocked', 'handed_over'] as const
export type OwnerSummaryStatus = (typeof OWNER_SUMMARY_STATUSES)[number]

/** This week's stored summary of an owner and what became of its message. */
export interface OwnerSummaryDelivery {
  summaryId: EntityId
  /** `handed_over`: given to the core messaging pipeline; `blocked`: not sent, for `blockers`; `ready`: about to be. */
  status: OwnerSummaryStatus
  computedAt: ISODateTime
  blockers: string[]
  /** The owner_weekly_summary communication the core recorded (message history), once it did. */
  communicationId?: EntityId
  deliveryStatus?: DeliveryStatus
  failureReason?: string
  sentAt?: ISODateTime
}

/** One owner on the Reports page: this week's summary as it stands now, the WhatsApp text and its send. */
export interface OwnerWeeklySummaryPreview {
  summary: OwnerWeeklySummary
  /** The values of the template's placeholders: {{1}} owner name, {{2}} week, {{3}} the summary in one line. */
  values: string[]
  /** The WhatsApp message (the chosen template's text filled in); absent while no template is chosen. */
  message?: string
  /** Why this owner's summary would not be sent now: the company's blockers and the owner's own. Empty when ready. */
  blockers: string[]
  /** This week's stored summary, once the weekly job has run. */
  delivery?: OwnerSummaryDelivery
}

export interface OwnerWeeklySummaryReport {
  weekStart: ISODate
  /** The company's day for owner summaries (Settings → Monitoring), Monday unless changed. */
  sendWeekday: Weekday
  /** The next date the weekly job runs for the company (today when today is the day). */
  nextSendOn: ISODate
  /** Why nothing is sent for the company (no approved template, no connected number); empty when it can send. */
  blockers: string[]
  /** The template chosen for owner_weekly_summary (Settings → Message templates), and how it stands. */
  template?: { metaTemplateName: string; language: string; sendable: boolean; summary: string }
  /** Owners with at least one property, by name. */
  owners: OwnerWeeklySummaryPreview[]
}
