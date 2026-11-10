import {
  ageArrears,
  arrearsEventPriority,
  DEFAULT_AGEING_BUCKETS,
  formatSADate,
  formatZAR,
  shouldSuppressArrearsReminder,
  tenantsInArrears,
  type EntityId,
  type ISODate,
  type PaymentArrangement,
  type Statement,
} from '@leaseguard/domain'

import type { EventDraft } from '../shared/monitoring-outputs'
import type { MonitoringSettings } from '../shared/monitoring-settings'
import { dayCount, type RecordNames } from './event-presentation'

export type ArrearsStatement = Pick<
  Statement,
  'id' | 'tenantId' | 'propertyId' | 'unitId' | 'leaseId' | 'status' | 'statementDate' | 'closingBalance' | 'totalDue'
>
export type ArrearsArrangement = Pick<PaymentArrangement, 'tenantId' | 'status' | 'agreedOn' | 'closedOn' | 'suppressArrearsReminders'>

export interface ArrearsScanInput {
  statements: readonly ArrearsStatement[]
  arrangements: readonly ArrearsArrangement[]
  settings: MonitoringSettings
  names: RecordNames
  asOf: ISODate
}

export interface ArrearsFindings {
  drafts: EventDraft[]
  /** Tenants in arrears whose reminders are paused by an active payment arrangement. */
  suppressedTenantIds: EntityId[]
}

/**
 * Arrears findings for one company from VERIFIED statements only (domain `ageArrears`: the latest
 * verified statement per tenant is authoritative). Tenants with an active payment arrangement that
 * suppresses arrears reminders are skipped (domain `shouldSuppressArrearsReminder`): the arrangement is
 * monitored by the arrangement-reminders job instead. Each (statement, ageing bucket) is raised once.
 */
export function arrearsFindings(input: ArrearsScanInput): ArrearsFindings {
  const { settings, names, asOf } = input
  const rule = settings.rule('arrears')
  if (!rule.enabled) return { drafts: [], suppressedTenantIds: [] }
  const buckets = rule.config?.ageingBucketsDays ?? DEFAULT_AGEING_BUCKETS
  const threshold = rule.config?.minimumBalanceRands ?? 0
  const units = new Map(input.statements.map((s) => [s.id, s.unitId]))

  const drafts: EventDraft[] = []
  const suppressedTenantIds: EntityId[] = []
  for (const entry of tenantsInArrears(ageArrears(input.statements, asOf, buckets), threshold)) {
    if (shouldSuppressArrearsReminder(entry.tenantId, input.arrangements, asOf)) {
      suppressedTenantIds.push(entry.tenantId)
      continue
    }
    const tenant = names.tenant(entry.tenantId)
    const unitId = units.get(entry.statementId)
    const assignee = rule.defaultAssigneeUserId ?? names.managerOf(entry.propertyId)
    drafts.push({
      // One finding per statement AND ageing bucket: the event is raised once per bucket, so when the
      // debt ages into a later bucket (higher priority) a new event, and its notification, are raised.
      dedupeKey: `arrears:${entry.statementId}:${entry.bucket}`,
      type: 'arrears',
      propertyId: entry.propertyId,
      ...(unitId ? { unitId } : {}),
      tenantId: entry.tenantId,
      ...(entry.leaseId ? { leaseId: entry.leaseId } : {}),
      statementId: entry.statementId,
      ...(rule.ruleId ? { ruleId: rule.ruleId } : {}),
      title: `Arrears: ${tenant} owes ${formatZAR(entry.outstanding)}`,
      description: `The verified statement of ${formatSADate(entry.statementDate)} shows ${formatZAR(entry.outstanding)} outstanding, ${dayCount(entry.ageDays)} old (ageing bucket ${entry.bucket}).`,
      calculation: {
        actualAmount: entry.outstanding,
        steps: [
          `Latest verified statement: ${formatSADate(entry.statementDate)}`,
          `Outstanding balance: ${formatZAR(entry.outstanding)}`,
          `Age on ${formatSADate(asOf)}: ${dayCount(entry.ageDays)} (bucket ${entry.bucket})`,
        ],
      },
      identifiedOn: asOf,
      priority: arrearsEventPriority(entry.bucket, buckets, rule.defaultPriority ?? 'medium'),
      recommendedAction: 'Review the account and prepare a payment reminder for approval, or agree a payment arrangement.',
      ...(assignee ? { assignedToUserId: assignee } : {}),
    })
  }
  return { drafts, suppressedTenantIds }
}
