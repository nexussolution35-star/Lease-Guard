import type { CompanyScoped, EntityId, ISODate, ISODateTime, ZAR } from './common.js'

export const MONITORING_EVENT_TYPES = [
  'rental_escalation_discrepancy',
  'lease_expiry',
  'renewal_notice_deadline',
  'guarantee_expiry',
  'guarantee_shortfall',
  'deposit_shortfall',
  'arrears',
  'arrangement_attention',
  'statement_review_required',
] as const
export type MonitoringEventType = (typeof MONITORING_EVENT_TYPES)[number]

export const EVENT_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type EventPriority = (typeof EVENT_PRIORITIES)[number]

export const MONITORING_EVENT_STATUSES = [
  'new',
  'under_review',
  'action_required',
  'in_progress',
  'resolved',
  'dismissed',
] as const
export type MonitoringEventStatus = (typeof MONITORING_EVENT_STATUSES)[number]

/** Explainable calculation attached to financial events. */
export interface EventCalculation {
  expectedAmount?: ZAR
  actualAmount?: ZAR
  difference?: ZAR
  /** Human-readable steps, e.g. "R35,000 × 1.08 = R37,800". */
  steps: readonly string[]
}

export interface EventDismissal {
  reason: string
  dismissedByUserId: EntityId
  dismissedAt: ISODateTime
}

export interface MonitoringEvent extends CompanyScoped {
  type: MonitoringEventType
  propertyId: EntityId
  unitId?: EntityId
  tenantId?: EntityId
  leaseId?: EntityId
  leaseReference?: string
  statementId?: EntityId
  arrangementId?: EntityId
  ruleId?: EntityId
  title: string
  description: string
  calculation?: EventCalculation
  identifiedOn: ISODate
  dueDate?: ISODate
  priority: EventPriority
  recommendedAction: string
  assignedToUserId?: EntityId
  status: MonitoringEventStatus
  resolvedAt?: ISODateTime
  resolvedByUserId?: EntityId
  resolutionNotes?: string
  dismissal?: EventDismissal
}

/** Discriminated rule configuration so parameters are never untyped. */
export type MonitoringRuleConfig =
  | { kind: 'rental_escalation_discrepancy'; toleranceRands: ZAR; tolerancePercent: number }
  | { kind: 'lease_expiry'; noticeDays: readonly number[] }
  | { kind: 'renewal_notice_deadline'; warningDays: readonly number[] }
  | { kind: 'guarantee_expiry'; noticeDays: readonly number[] }
  | { kind: 'guarantee_shortfall'; minimumCoverageMonths: number; toleranceRands: ZAR }
  | { kind: 'deposit_shortfall'; minimumCoverageMonths: number }
  | { kind: 'arrears'; minimumBalanceRands: ZAR; ageingBucketsDays: readonly number[] }
  | { kind: 'arrangement_attention'; graceDays: number }
  | { kind: 'statement_review_required'; confidenceThreshold: number }

export interface MonitoringRule extends CompanyScoped {
  eventType: MonitoringEventType
  name: string
  description: string
  enabled: boolean
  defaultPriority: EventPriority
  config: MonitoringRuleConfig
  /** Property manager events are assigned to when raised by this rule. */
  defaultAssigneeUserId?: EntityId
}
