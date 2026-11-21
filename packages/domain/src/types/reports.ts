import type { ArrangementStatus, InstallmentFrequency } from './arrangement.js'
import type { EntityId, ISODate, ZAR } from './common.js'
import type { DeliveryStatus, MessageType } from './communication.js'
import type { EventPriority, MonitoringEventStatus, MonitoringEventType } from './monitoring.js'
import type { PropertyStatus } from './property.js'
import type { StatementSource, StatementStatus } from './statement.js'
import type { OccupancyStatus, UnitType } from './unit.js'
import type { ISODateTime } from './common.js'
import type { ApprovalDecision, Channel, MessageDirection, RecipientType } from './communication.js'
import type { OwnerWeeklySummaryReport } from './ownerSummary.js'

/** Every report is computed from central data, scoped to the active company. */
export const REPORT_IDS = [
  'portfolio_overview',
  'occupancy',
  'lease_monitoring',
  'rental_discrepancies',
  'lease_expiry',
  'renewal_deadlines',
  'deposits_guarantees',
  'arrears',
  'payment_arrangements',
  'statement_processing',
  'communication_activity',
  'owner_weekly_summary',
] as const
export type ReportId = (typeof REPORT_IDS)[number]

export interface ReportFilters {
  propertyIds?: readonly EntityId[]
  /** Inclusive lower bound on the report's primary date field. */
  from?: ISODate
  /** Inclusive upper bound on the report's primary date field. */
  to?: ISODate
  /** Status filter applied to the report's primary record (event, statement, lease, …). */
  statuses?: readonly string[]
}

/**
 * The filters one report offers in the shared report frame (rules/reportFrame.ts `REPORT_FILTER_SUPPORT`): a report
 * that does not offer a filter ignores it, and the frame does not show it.
 */
export interface ReportFilterSupport {
  property: boolean
  /** The primary date field the date range bounds (e.g. "Statement date"), or null without a date range. */
  dateRange: { field: string } | null
  /** The statuses the status filter offers, in display order, or null without a status filter. */
  statuses: { label: string; values: readonly string[] } | null
}

/**
 * What every report endpoint (`GET /api/v1/reports/{reportId}`) answers: the report's figures, the filters actually
 * applied and the South African date the figures are as at.
 */
export interface ReportEnvelope<Id extends ReportId = ReportId> {
  reportId: Id
  asOf: ISODate
  filters: ReportFilters
  data: ReportResultMap[Id]
}

export interface ReportDefinition {
  id: ReportId
  title: string
  description: string
  /** Lucide icon name, resolved by the UI. */
  icon: string
}

// ---------------------------------------------------------------------------------- portfolio

export interface PortfolioPropertyRow {
  propertyId: EntityId
  propertyName: string
  code: string
  /**
   * An archived property is listed only while it still carries an outstanding balance or open events (or when the
   * archived status is asked for), and its units are not counted in the report's totals, as on the dashboard.
   */
  status: PropertyStatus
  unitCount: number
  occupiedUnits: number
  vacantUnits: number
  /** 0–1 */
  occupancyRate: number
  activeLeases: number
  /** Current monthly rental of the active leases whose terms are verified. */
  monthlyRentalRoll: ZAR
  /** Outstanding on the latest verified statement of each account at the property (the dashboard's rules). */
  outstanding: ZAR
  /** Tenants with an outstanding balance at the property. */
  tenantsInArrears: number
  openEvents: number
}

export interface PortfolioOverviewReport {
  /** Properties under management: the listed properties that are not archived (as the dashboard). */
  propertyCount: number
  unitCount: number
  occupiedUnits: number
  vacantUnits: number
  occupancyRate: number
  activeLeases: number
  /** Leases that have not ended whose terms are not verified yet: they drive no financial monitoring. */
  unverifiedLeases: number
  monthlyRentalRoll: ZAR
  totalOutstanding: ZAR
  /** Distinct tenants with an outstanding balance (a tenant in arrears at two properties counts once). */
  tenantsInArrears: number
  openEvents: number
  properties: PortfolioPropertyRow[]
}

// ---------------------------------------------------------------------------------- occupancy

export interface OccupancyFigures {
  total: number
  occupied: number
  vacant: number
  underOffer: number
  unavailable: number
  occupancyRate: number
  floorAreaSqm: number
  occupiedAreaSqm: number
}

/** Where a unit's current tenant comes from: its current lease, else the tenant assigned to it without a lease. */
export const UNIT_TENANT_SOURCES = ['lease', 'assignment'] as const
export type UnitTenantSource = (typeof UNIT_TENANT_SOURCES)[number]

export interface OccupancyUnitRow {
  unitId: EntityId
  unitNumber: string
  unitType: UnitType
  floorAreaSqm: number
  occupancyStatus: OccupancyStatus
  propertyId: EntityId
  propertyName: string
  /** The unit's current tenant: its current lease's tenant, else its assigned tenant. */
  tenantId?: EntityId
  tenantName?: string
  tenantSource?: UnitTenantSource
  leaseId?: EntityId
  leaseReference?: string
}

export interface OccupancyReport {
  totals: OccupancyFigures
  byProperty: (OccupancyFigures & { propertyId: EntityId; propertyName: string })[]
  byUnitType: (OccupancyFigures & { unitType: UnitType })[]
  /** Every unit counted, of the properties that are not archived (as the dashboard). */
  units: OccupancyUnitRow[]
}

// ---------------------------------------------------------------------------------- monitoring

/** How long a monitoring event has been open: days from the date it was identified to the report's "as at" date. */
export const EVENT_AGE_BUCKETS = ['0-7', '8-30', '31-90', '90+'] as const
export type EventAgeBucket = (typeof EVENT_AGE_BUCKETS)[number]

export interface MonitoringEventRow {
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
  identifiedOn: ISODate
  dueDate?: ISODate
  /** Days from `identifiedOn` to the report's "as at" date. */
  ageDays: number
  ageBucket: EventAgeBucket
  /** Still open with a due date before the "as at" date. */
  overdue: boolean
}

export interface LeaseMonitoringReport {
  /** Events listed: the open events, or the events of the statuses asked for. */
  total: number
  /** Listed events still open (new, under review, action required, in progress). */
  open: number
  /** Listed events still open and past their due date. */
  overdue: number
  byType: Record<MonitoringEventType, number>
  byPriority: Record<EventPriority, number>
  byStatus: Record<MonitoringEventStatus, number>
  /** Listed events per property, by property name; properties without listed events are left out. */
  byProperty: { propertyId: EntityId; propertyName: string; total: number; open: number; overdue: number }[]
  /** Listed events by age, in the order of EVENT_AGE_BUCKETS. */
  byAge: { bucket: EventAgeBucket; count: number }[]
  /** Oldest first, then by priority (critical first). */
  events: MonitoringEventRow[]
}

/** How a lease's billed rental compares with its escalated contractual rental: the rental discrepancy report's status. */
export const RENTAL_COMPARISON_STATES = ['outside_tolerance', 'within_tolerance'] as const
export type RentalComparisonState = (typeof RENTAL_COMPARISON_STATES)[number]

export interface RentalDiscrepancyRow {
  /** `event` = raised monitoring event; `recomputed` = found by recomputation with no event yet. */
  source: 'event' | 'recomputed'
  /**
   * True: the lease's latest verified statement compared with its verified terms now. False: an open discrepancy
   * event on an earlier statement (or a lease no longer monitored), shown with the calculation the event recorded.
   */
  current: boolean
  eventId?: EntityId
  eventStatus?: MonitoringEventStatus
  leaseId: EntityId
  leaseReference: string
  tenantId: EntityId
  tenantName: string
  propertyId: EntityId
  propertyName: string
  unitNumber?: string
  statementId?: EntityId
  statementDate?: ISODate
  /** Start of the billed period: the date the contractual rental is evaluated at. */
  periodStart?: ISODate
  expected: ZAR
  billed: ZAR
  /** expected − billed; positive = under-billed. */
  difference: ZAR
  withinTolerance: boolean
  steps: readonly string[]
}

export interface RentalDiscrepancyReport {
  rows: RentalDiscrepancyRow[]
  /** Sum of differences on rows outside tolerance. */
  totalMonthlyDifference: ZAR
  /** Sum of the positive differences outside tolerance (rental billed short). */
  underBilled: ZAR
  /** Sum of the negative differences outside tolerance, as a positive amount (rental billed over). */
  overBilled: ZAR
  /** Rows outside tolerance. */
  outsideToleranceCount: number
  /** Rows with a raised monitoring event. */
  eventCount: number
  /** Rows outside tolerance found by recomputation with no event raised yet. */
  recomputedCount: number
  /** Open rental escalation discrepancy events at the listed properties (the dashboard's figure without filters). */
  openEventCount: number
  /** Verified, monitored leases compared with their latest verified statement. */
  leasesCompared: number
  /** Verified, monitored leases without a verified statement that bills rental yet. */
  awaitingStatement: number
  /** Leases skipped because their terms are not verified. */
  unverifiedLeasesExcluded: number
}

// ---------------------------------------------------------------------------------- expiry / renewal

/**
 * Where a lease's expiry falls, in calendar months from the report's "as at" date (rules/leaseDateReports.ts
 * `expiryBucketFor`): already expired, within 3 months, 3–6, 6–12, or later than 12 months.
 */
export const EXPIRY_BUCKETS = ['expired', 'months_0_3', 'months_3_6', 'months_6_12', 'later'] as const
export type ExpiryBucket = (typeof EXPIRY_BUCKETS)[number]

export interface LeaseExpiryRow {
  leaseId: EntityId
  reference: string
  tenantId: EntityId
  tenantName: string
  propertyId: EntityId
  propertyName: string
  unitId: EntityId
  unitNumber: string
  expiryDate: ISODate
  /** Signed calendar days to expiry; negative once expired. */
  daysUntilExpiry: number
  bucket: ExpiryBucket
  /** Current contractual monthly rental (verified terms), excl. VAT. */
  monthlyRental: ZAR
  /** The lease has a renewal option the tenant has not exercised yet. */
  renewalOptionAvailable: boolean
  /**
   * The company lease-expiry notice threshold (days) this lease has reached, the one monitoring raises its expiry
   * event for (`shouldRaiseExpiryEvent`); absent when none is reached, it has expired or the rule is off.
   */
  noticeThreshold?: number
  /** The open lease-expiry monitoring event of this lease, if any. */
  openEventId?: EntityId
}

export interface LeaseExpiryReport {
  /** Every bucket in EXPIRY_BUCKETS order, with the leases shown in it. */
  buckets: { bucket: ExpiryBucket; count: number; monthlyRental: ZAR }[]
  /** Soonest expiry first. */
  rows: LeaseExpiryRow[]
  /** Monitored leases whose expiry date has already passed. */
  expiredCount: number
  /** Leases inside a company lease-expiry notice threshold: the leases monitoring raises an expiry event for. */
  withinNoticeCount: number
  /** The company's lease-expiry notice thresholds in days, largest first; empty when the rule is switched off. */
  noticeDays: number[]
  /** Leases that have not ended whose terms are not verified yet: they are not monitored, so not listed. */
  unverifiedLeasesExcluded: number
}

/** The deadline statuses a renewal-deadline row can have (a row always has a deadline). */
export const RENEWAL_DEADLINE_ROW_STATUSES = ['passed', 'due_critical', 'due_soon', 'upcoming', 'open', 'exercised'] as const
export type RenewalDeadlineRowStatus = (typeof RENEWAL_DEADLINE_ROW_STATUSES)[number]

export interface RenewalDeadlineRow {
  leaseId: EntityId
  reference: string
  tenantId: EntityId
  tenantName: string
  propertyId: EntityId
  propertyName: string
  unitNumber: string
  expiryDate: ISODate
  noticePeriodMonths: number
  /** Last day written renewal notice may be given (`renewalNoticeDeadline`). */
  deadline: ISODate
  /** Signed days to the deadline; negative once passed. */
  daysUntilDeadline: number
  /** `renewalDeadlineStatus` (RenewalDeadlineStatus), never `not_applicable` on a row. */
  status: RenewalDeadlineRowStatus
  /**
   * The company renewal warning threshold (days) the deadline has reached, the one monitoring raises its renewal
   * event for (`leasesRequiringRenewalWarning`); absent when none is reached, exercised, passed or the rule is off.
   */
  warningThreshold?: number
  /** The open renewal-notice-deadline monitoring event of this lease, if any. */
  openEventId?: EntityId
}

export interface RenewalDeadlinesReport {
  /** Soonest deadline first. */
  rows: RenewalDeadlineRow[]
  countsByStatus: Record<RenewalDeadlineRowStatus, number>
  /** Leases inside a company warning threshold: the leases monitoring raises a renewal-deadline event for. */
  requiringWarning: number
  /** The company's renewal warning thresholds in days, largest first; empty when the rule is switched off. */
  warningDays: number[]
  /** Verified leases with a renewal option but no notice period recorded: no deadline can be worked out. */
  missingNoticePeriod: number
  /** Leases that have not ended whose terms are not verified yet: they are not monitored, so not listed. */
  unverifiedLeasesExcluded: number
}

// ---------------------------------------------------------------------------------- deposits & guarantees

/**
 * One verified, monitored lease (status active or expiring) that carries a deposit or a bank guarantee, with its cover
 * worked out by the rules lease monitoring uses (rules/guarantee.ts): the required cover is the basis months times the
 * rental the verified terms expect as at the report date (escalations applied), and the shortfall is what is held
 * below it.
 */
export interface SecurityRow {
  leaseId: EntityId
  reference: string
  tenantId: EntityId
  tenantName: string
  propertyId: EntityId
  propertyName: string
  unitId: EntityId
  unitNumber: string
  /** The monthly rental the verified terms expect as at the report date (escalations applied, excl. VAT). */
  expectedMonthlyRental: ZAR
  depositAmount?: ZAR
  /** DepositHolder: who holds the deposit. */
  depositHeldBy?: string
  depositBasisMonths?: number
  /** Basis months × expected rental; absent when the lease records no deposit basis. */
  depositRequired?: ZAR
  depositShortfall: ZAR
  guaranteeBank?: string
  guaranteeReference?: string
  guaranteeAmount?: ZAR
  guaranteeBasisMonths?: number
  /**
   * Basis months × expected rental, for a guarantee in force (recorded status active or expiring, as lease
   * monitoring checks it); absent for a guarantee released or called.
   */
  guaranteeRequired?: ZAR
  guaranteeShortfall: ZAR
  guaranteeExpiresOn?: ISODate
  /** GuaranteeExpiryState from @/domain (`guaranteeExpiryStatus` with the company's notice days). */
  guaranteeState?: string
  guaranteeDaysUntilExpiry?: number
  /** A deposit or guarantee shortfall, or a guarantee expiring or expired: the row is highlighted. */
  needsAttention: boolean
}

export interface DepositsGuaranteesReport {
  /** Deposits held on the listed leases. */
  totalDeposits: ZAR
  /** Guarantees in force on the listed leases (state active or expiring); expired, released and called are left out. */
  totalGuarantees: ZAR
  depositShortfallTotal: ZAR
  guaranteeShortfallTotal: ZAR
  /** Listed leases with a deposit or a guarantee shortfall. */
  leasesWithShortfall: number
  expiringGuarantees: number
  expiredGuarantees: number
  /** The guarantee expiry notice thresholds (days, largest first) that make a guarantee `expiring`. */
  guaranteeNoticeDays: number[]
  rows: SecurityRow[]
  /**
   * Leases of the filtered properties that have not ended and carry a deposit or a guarantee, but whose terms are not
   * verified yet: they drive no financial monitoring, so they are not listed.
   */
  unverifiedLeasesExcluded: number
}

// ---------------------------------------------------------------------------------- arrears

/** The arrears report's status filter: whether an active payment arrangement is in force for the tenant. */
export const ARREARS_ARRANGEMENT_STATES = ['under_arrangement', 'no_arrangement'] as const
export type ArrearsArrangementState = (typeof ARREARS_ARRANGEMENT_STATES)[number]

/**
 * One account in arrears: a tenant's unit (the lease when the statement names no unit), from its latest verified
 * statement, the balance aged into the company's buckets. A tenant with several units has a row per unit.
 */
export interface ArrearsRow {
  tenantId: EntityId
  tenantName: string
  propertyId: EntityId
  propertyName: string
  unitId?: EntityId
  unitNumber?: string
  leaseId?: EntityId
  leaseReference?: string
  statementId: EntityId
  statementDate: ISODate
  outstanding: ZAR
  ageDays: number
  /** AgeingBucketLabel from @/domain. */
  bucket: string
  /** An active payment arrangement is in force for the tenant (arrangements are per tenant). */
  underArrangement: boolean
  /** That arrangement pauses the tenant's normal arrears reminders. */
  remindersSuppressed: boolean
  /** The active arrangement in force (the latest agreed when there are several), for linking. */
  arrangementId?: EntityId
}

export interface ArrearsBucketRow {
  /** AgeingBucketLabel from @/domain. */
  bucket: string
  /** The days the bucket covers, in words ("30–59 days"). */
  description: string
  amount: ZAR
  /** Distinct tenants with a balance in the bucket. */
  tenantCount: number
}

export interface ArrearsReport {
  /** The company's ageing bucket boundaries in days (its arrears monitoring configuration). */
  ageingBuckets: number[]
  totalOutstanding: ZAR
  /** Distinct tenants in arrears (a tenant in arrears on two units counts once). */
  tenantCount: number
  /** Distinct tenants in arrears under an active payment arrangement; still in arrears, the balance is owed. */
  tenantsUnderArrangement: number
  /** Distinct tenants in arrears whose normal reminders the arrangement pauses. */
  tenantsWithRemindersSuppressed: number
  /** Outstanding on the rows of tenants under an active arrangement. */
  outstandingUnderArrangement: ZAR
  /** Every bucket of the configuration, in ageing order, zero when empty. */
  buckets: ArrearsBucketRow[]
  /** Largest balance first. */
  rows: ArrearsRow[]
}

// ---------------------------------------------------------------------------------- arrangements

export interface ArrangementRow {
  arrangementId: EntityId
  tenantId: EntityId
  tenantName: string
  propertyId: EntityId
  propertyName: string
  unitId: EntityId
  unitNumber: string
  leaseId: EntityId
  leaseReference: string
  status: ArrangementStatus
  frequency: InstallmentFrequency
  installmentAmount: ZAR
  agreedOn: ISODate
  finalInstallmentDate: ISODate
  closedOn?: ISODate
  /** The arrangement pauses the tenant's normal arrears reminders while it is active. */
  suppressArrearsReminders: boolean
  /** Outstanding balance at the time of agreement. */
  outstandingBalance: ZAR
  /** Instalments recorded as paid (a property manager's record; LeaseGuard never takes payments). */
  paid: ZAR
  remaining: ZAR
  paidCount: number
  totalCount: number
  /** Instalments recorded as missed. */
  missedCount: number
  /** Open instalments past their due date plus the company's grace days (active arrangements only). */
  overdueCount: number
  /** The next open instalment due on or after the as-at date (active arrangements only). */
  nextDueDate?: ISODate
  nextAmount?: ZAR
}

export interface PaymentArrangementsReport {
  /** Grace days after an instalment's due date before it counts as overdue (arrangement monitoring configuration). */
  graceDays: number
  countsByStatus: Record<ArrangementStatus, number>
  /** Arrangements in force on the as-at date. */
  activeCount: number
  /** Remaining balance of the active arrangements. */
  outstandingUnderArrangement: ZAR
  /** Paid instalments recorded across the rows. */
  paidToDate: ZAR
  missedInstallments: number
  overdueInstallments: number
  /** Active first, then proposed, defaulted, completed and cancelled; the latest agreed first within each. */
  rows: ArrangementRow[]
}

// ---------------------------------------------------------------------------------- statements

/** One uploaded statement as the statement processing report lists it (rules/activityReports.ts). */
export interface StatementUploadRow {
  statementId: EntityId
  fileName: string
  statementNumber?: string
  propertyId: EntityId
  propertyName: string
  tenantId?: EntityId
  tenantName?: string
  unitId?: EntityId
  unitNumber?: string
  sourceSystem: StatementSource
  status: StatementStatus
  uploadedAt: ISODateTime
  /** The South African calendar date of the upload: the report's date range bounds it. */
  uploadedOn: ISODate
  statementDate?: ISODate
  /** Automatic extraction gave up (`processingFailed`): under review with the reason in `processingError`. */
  processingFailed: boolean
  processingError?: string
  duplicateOfStatementId?: EntityId
  /** Overall extraction confidence (0–1), absent without an extraction. */
  extractionConfidence?: number
  /** Extracted fields a reviewer still has to confirm or correct (`fieldResolution` is `unresolved`). */
  unresolvedFields: number
  /** Whole days from the upload date to the date the report is as at. */
  ageDays: number
}

/** Uploads of one source system or one property, by where they stand. */
export interface StatementGroupFigures {
  total: number
  /** Still being read: uploaded or processing. */
  inProgress: number
  /** Waiting for a person: status `review_required`, processing failures included (as the dashboard counts). */
  pendingReview: number
  processingFailures: number
  verified: number
  rejected: number
  duplicate: number
}

export interface StatementProcessingReport extends StatementGroupFigures {
  countsByStatus: Record<StatementStatus, number>
  bySource: (StatementGroupFigures & { sourceSystem: StatementSource })[]
  byProperty: (StatementGroupFigures & { propertyId: EntityId; propertyName: string })[]
  /** Under review with nothing failed: extraction finished and waits for a reviewer. */
  awaitingReview: number
  /** Age in days of the oldest statement waiting for review, `null` when none waits. */
  oldestPendingReviewDays: number | null
  /** Mean overall extraction confidence (0–1) of the uploads shown, `null` without extractions. */
  averageExtractionConfidence: number | null
  /** Statements waiting for review (processing failures included), oldest upload first. */
  backlog: StatementUploadRow[]
  /** Statements whose automatic processing failed, oldest upload first. */
  failures: StatementUploadRow[]
  /** Every upload shown, newest first. */
  rows: StatementUploadRow[]
}

// ---------------------------------------------------------------------------------- communications

/**
 * What became of an outbound message once handed to WhatsApp for sending (queued, sent, delivered, read or failed),
 * the way communication analytics counts it: `pending` = queued or sent, not yet delivered. Messages not handed over
 * (drafts, approval requests, approved but not queued, rejected) and inbound messages have no outcome.
 */
export const DELIVERY_OUTCOMES = ['pending', 'delivered', 'read', 'failed'] as const
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number]

/** How long a message has waited for a property manager's approval. */
export const APPROVAL_AGE_BUCKETS = ['under_1_day', '1_3_days', '3_7_days', 'over_7_days'] as const
export type ApprovalAgeBucket = (typeof APPROVAL_AGE_BUCKETS)[number]

/** One message as the communication activity report lists it. */
export interface CommunicationActivityRow {
  communicationId: EntityId
  createdAt: ISODateTime
  /** The South African calendar date the message was recorded: the report's date range bounds it. */
  createdOn: ISODate
  channel: Channel
  direction: MessageDirection
  messageType: MessageType
  recipientType: RecipientType
  /** The tenant's trading name, the owner's name or the contact's WhatsApp name. */
  counterpartyName?: string
  tenantId?: EntityId
  /** The message's property, else its lease's or its statement's. */
  propertyId?: EntityId
  propertyName?: string
  statementId?: EntityId
  arrangementId?: EntityId
  status: DeliveryStatus
  outcome?: DeliveryOutcome
  failureReason?: string
  /** The message's approval: the pending request, else the latest decided one. */
  approvalDecision?: ApprovalDecision
  approvalRequestedAt?: ISODateTime
  approvalDecidedAt?: ISODateTime
}

/** A message waiting for approval, with how long it has waited. */
export interface PendingApprovalRow extends CommunicationActivityRow {
  approvalRequestedAt: ISODateTime
  waitingHours: number
  ageBucket: ApprovalAgeBucket
}

/** Messages of one type or one property. */
export interface CommunicationGroupFigures {
  total: number
  outbound: number
  inbound: number
  /** Outbound messages handed to WhatsApp for sending. */
  handedOver: number
  /** Delivered, read included. */
  delivered: number
  failed: number
  pendingApproval: number
}

export interface CommunicationActivityReport extends CommunicationGroupFigures {
  byType: (CommunicationGroupFigures & { messageType: MessageType })[]
  byStatus: Record<DeliveryStatus, number>
  byProperty: (CommunicationGroupFigures & { propertyId: EntityId | null; propertyName: string | null })[]
  outcomes: Record<DeliveryOutcome, number>
  /** Delivered (read included) over handed over (0–1), `null` when nothing was handed over. */
  deliveryRate: number | null
  approvals: {
    pending: number
    approved: number
    rejected: number
    /** Mean minutes from request to a person's decision, `null` without decided approvals. */
    averageTurnaroundMinutes: number | null
    /** Hours the oldest pending request has waited, `null` when none waits. */
    oldestPendingHours: number | null
    byAge: { bucket: ApprovalAgeBucket; count: number }[]
  }
  /** Messages waiting for approval, longest waiting first. */
  pendingApprovals: PendingApprovalRow[]
  /** Outbound messages that failed, newest first. */
  failedMessages: CommunicationActivityRow[]
  /** Every message shown, newest first. */
  rows: CommunicationActivityRow[]
}

export interface ReportResultMap {
  portfolio_overview: PortfolioOverviewReport
  occupancy: OccupancyReport
  lease_monitoring: LeaseMonitoringReport
  rental_discrepancies: RentalDiscrepancyReport
  lease_expiry: LeaseExpiryReport
  renewal_deadlines: RenewalDeadlinesReport
  deposits_guarantees: DepositsGuaranteesReport
  arrears: ArrearsReport
  payment_arrangements: PaymentArrangementsReport
  statement_processing: StatementProcessingReport
  communication_activity: CommunicationActivityReport
  owner_weekly_summary: OwnerWeeklySummaryReport
}

/** PRD 7.1 dashboard figures. */
export interface DashboardMetrics {
  totalProperties: number
  totalUnits: number
  occupiedUnits: number
  activeLeases: number
  totalOutstanding: ZAR
  escalationDiscrepancies: number
  upcomingExpiries: number
  upcomingRenewalDeadlines: number
  expiringGuarantees: number
  tenantsInArrears: number
  activeArrangements: number
  pendingStatementReviews: number
  pendingApprovals: number
}
