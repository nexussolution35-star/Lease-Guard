import type { EventPriority, LeaseStatus, MonitoringEventStatus } from '../types/index.js'
import { ageingBucketLabels, type AgeingBucketLabel } from './arrears.js'
import type { LeaseExpiryStatus } from './leaseExpiry.js'
import type { RenewalDeadlineStatus } from './renewalNotice.js'

/**
 * Monitoring-event workflow and priorities, shared by the API, the worker and the demo data source.
 */

/** Statuses that still need someone's attention. */
export const OPEN_EVENT_STATUSES: readonly MonitoringEventStatus[] = ['new', 'under_review', 'action_required', 'in_progress']

/** Final statuses: an event in one of these never moves again and is never raised again. */
export const TERMINAL_EVENT_STATUSES: readonly MonitoringEventStatus[] = ['resolved', 'dismissed']

/** Forward workflow; `dismissed` is also reachable from any non-terminal status. */
export const EVENT_TRANSITIONS: Readonly<Record<MonitoringEventStatus, readonly MonitoringEventStatus[]>> = {
  new: ['under_review', 'dismissed'],
  under_review: ['action_required', 'dismissed'],
  action_required: ['in_progress', 'dismissed'],
  in_progress: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
}

export function canTransition(from: MonitoringEventStatus, to: MonitoringEventStatus): boolean {
  return EVENT_TRANSITIONS[from].includes(to)
}

export function isOpenEventStatus(status: MonitoringEventStatus): boolean {
  return OPEN_EVENT_STATUSES.includes(status)
}

/** Lease (and bank guarantee) expiry urgency → event priority. */
export const EXPIRY_EVENT_PRIORITY: Readonly<Record<LeaseExpiryStatus, EventPriority>> = {
  expired: 'critical',
  expiring_critical: 'critical',
  expiring_soon: 'high',
  expiring_watch: 'medium',
  current: 'low',
}

/** Renewal notice deadline urgency → event priority. */
export const RENEWAL_EVENT_PRIORITY: Readonly<Record<RenewalDeadlineStatus, EventPriority>> = {
  passed: 'critical',
  due_critical: 'critical',
  due_soon: 'high',
  upcoming: 'medium',
  open: 'low',
  exercised: 'low',
  not_applicable: 'low',
}

/**
 * Arrears ageing bucket → event priority: the oldest (open-ended) bucket is critical, any older bucket
 * is high, and the current bucket uses the rule's default priority.
 */
export function arrearsEventPriority(
  bucket: AgeingBucketLabel,
  buckets: readonly number[] | undefined,
  defaultPriority: EventPriority,
): EventPriority {
  const labels = ageingBucketLabels(buckets)
  const index = labels.indexOf(bucket)
  if (index === labels.length - 1) return 'critical'
  if (index > 0) return 'high'
  return defaultPriority
}

/**
 * Lease status once its terms are verified: a draft or pending lease becomes active (and therefore
 * monitored); any other status is kept.
 */
export function leaseStatusAfterVerification(status: LeaseStatus): LeaseStatus {
  return status === 'draft' || status === 'pending_verification' ? 'active' : status
}
