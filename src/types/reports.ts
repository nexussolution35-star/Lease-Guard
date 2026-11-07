import type { ArrangementStatus } from './arrangement'
import type { EntityId, ISODate, ZAR } from './common'
import type { DeliveryStatus, MessageType } from './communication'
import type { EventPriority, MonitoringEventStatus, MonitoringEventType } from './monitoring'
import type { StatementSource, StatementStatus } from './statement'
import type { UnitType } from './unit'

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
  unitCount: number
  occupiedUnits: number
  /** 0–1 */
  occupancyRate: number
  activeLeases: number
  monthlyRentalRoll: ZAR
  outstanding: ZAR
  openEvents: number
}

export interface PortfolioOverviewReport {
  propertyCount: number
  unitCount: number
  occupiedUnits: number
  vacantUnits: number
  occupancyRate: number
  activeLeases: number
  unverifiedLeases: number
  monthlyRentalRoll: ZAR
  totalOutstanding: ZAR
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

export interface OccupancyReport {
  totals: OccupancyFigures
  byProperty: (OccupancyFigures & { propertyId: EntityId; propertyName: string })[]
  byUnitType: (OccupancyFigures & { unitType: UnitType })[]
}

// ---------------------------------------------------------------------------------- monitoring

export interface MonitoringEventRow {
  eventId: EntityId
  type: MonitoringEventType
  title: string
  priority: EventPriority
  status: MonitoringEventStatus
  propertyId: EntityId
  propertyName: string
  tenantName?: string
  leaseReference?: string
  identifiedOn: ISODate
  dueDate?: ISODate
}

export interface LeaseMonitoringReport {
  total: number
  open: number
  byType: Record<MonitoringEventType, number>
  byPriority: Record<EventPriority, number>
  byStatus: Record<MonitoringEventStatus, number>
  events: MonitoringEventRow[]
}

export interface RentalDiscrepancyRow {
  /** `event` = raised monitoring event; `recomputed` = found by recomputation with no event yet. */
  source: 'event' | 'recomputed'
  eventId?: EntityId
  eventStatus?: MonitoringEventStatus
  leaseId: EntityId
  leaseReference: string
  tenantId: EntityId
  tenantName: string
  propertyName: string
  statementId?: EntityId
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
  eventCount: number
  recomputedCount: number
  /** Leases skipped because their terms are not verified. */
  unverifiedLeasesExcluded: number
}

// ---------------------------------------------------------------------------------- expiry / renewal

export const EXPIRY_BUCKETS = ['0-30', '31-90', '91-180', '181-365', '365+'] as const
export type ExpiryBucket = (typeof EXPIRY_BUCKETS)[number]

export interface LeaseExpiryRow {
  leaseId: EntityId
  reference: string
  tenantName: string
  propertyName: string
  unitNumber: string
  expiryDate: ISODate
  daysUntilExpiry: number
  bucket: ExpiryBucket
  monthlyRental: ZAR
  renewalOptionAvailable: boolean
}

export interface LeaseExpiryReport {
  buckets: { bucket: ExpiryBucket; count: number; monthlyRental: ZAR }[]
  rows: LeaseExpiryRow[]
  /** Monitored leases whose expiry date has already passed. */
  expiredCount: number
}

export interface RenewalDeadlineRow {
  leaseId: EntityId
  reference: string
  tenantName: string
  propertyName: string
  expiryDate: ISODate
  noticePeriodMonths: number
  deadline: ISODate
  daysUntilDeadline: number
  /** RenewalDeadlineStatus from @/domain. */
  status: string
}

export interface RenewalDeadlinesReport {
  rows: RenewalDeadlineRow[]
  countsByStatus: Record<string, number>
  /** Leases inside a company warning threshold. */
  requiringWarning: number
}

// ---------------------------------------------------------------------------------- deposits & guarantees

export interface SecurityRow {
  leaseId: EntityId
  reference: string
  tenantName: string
  propertyName: string
  depositAmount?: ZAR
  depositRequired?: ZAR
  depositShortfall: ZAR
  guaranteeAmount?: ZAR
  guaranteeRequired?: ZAR
  guaranteeShortfall: ZAR
  guaranteeExpiresOn?: ISODate
  /** GuaranteeExpiryState from @/domain. */
  guaranteeState?: string
  guaranteeDaysUntilExpiry?: number
}

export interface DepositsGuaranteesReport {
  totalDeposits: ZAR
  totalGuarantees: ZAR
  depositShortfallTotal: ZAR
  guaranteeShortfallTotal: ZAR
  leasesWithShortfall: number
  expiringGuarantees: number
  expiredGuarantees: number
  rows: SecurityRow[]
  unverifiedLeasesExcluded: number
}

// ---------------------------------------------------------------------------------- arrears

export interface ArrearsRow {
  tenantId: EntityId
  tenantName: string
  propertyId: EntityId
  propertyName: string
  statementId: EntityId
  statementDate: ISODate
  outstanding: ZAR
  ageDays: number
  /** AgeingBucketLabel from @/domain. */
  bucket: string
  underArrangement: boolean
  remindersSuppressed: boolean
}

export interface ArrearsReport {
  totalOutstanding: ZAR
  tenantCount: number
  buckets: { bucket: string; amount: ZAR; tenantCount: number }[]
  rows: ArrearsRow[]
}

// ---------------------------------------------------------------------------------- arrangements

export interface ArrangementRow {
  arrangementId: EntityId
  tenantId: EntityId
  tenantName: string
  propertyName: string
  status: ArrangementStatus
  outstandingBalance: ZAR
  paid: ZAR
  remaining: ZAR
  paidCount: number
  totalCount: number
  missedCount: number
  overdueCount: number
  nextDueDate?: ISODate
  nextAmount?: ZAR
}

export interface PaymentArrangementsReport {
  countsByStatus: Record<ArrangementStatus, number>
  activeCount: number
  outstandingUnderArrangement: ZAR
  paidToDate: ZAR
  missedInstallments: number
  overdueInstallments: number
  rows: ArrangementRow[]
}

// ---------------------------------------------------------------------------------- statements

export interface StatementProcessingReport {
  total: number
  countsByStatus: Record<StatementStatus, number>
  bySource: Record<StatementSource, number>
  /** Mean overall extraction confidence (0–1), `null` without extractions. */
  averageExtractionConfidence: number | null
  flaggedFieldCount: number
  pendingReview: number
  duplicates: { statementId: EntityId; fileName: string; duplicateOfStatementId?: EntityId }[]
}

// ---------------------------------------------------------------------------------- communications

export interface CommunicationActivityReport {
  total: number
  outbound: number
  inbound: number
  byType: Record<MessageType, number>
  byStatus: Record<DeliveryStatus, number>
  approvals: {
    pending: number
    approved: number
    rejected: number
    /** Mean minutes from request to decision, `null` without decided approvals. */
    averageTurnaroundMinutes: number | null
  }
  failed: { communicationId: EntityId; tenantId?: EntityId; recipientName: string; failureReason?: string; at: string }[]
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
