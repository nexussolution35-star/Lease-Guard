import {
  daysBetween,
  formatSADate,
  formatZAR,
  installmentShortfallsOnStatements,
  isArrangementActive,
  nextInstallment,
  overdueInstallments,
  type ArrangementStatementFigures,
  type ISODate,
  type PaymentArrangement,
} from '@leaseguard/domain'

import type { EventDraft, NotificationDraft } from '../shared/monitoring-outputs'
import type { MonitoringSettings } from '../shared/monitoring-settings'
import { dayCount, type RecordNames } from './event-presentation'

export type ReminderArrangement = Pick<
  PaymentArrangement,
  | 'id'
  | 'tenantId'
  | 'propertyId'
  | 'unitId'
  | 'leaseId'
  | 'status'
  | 'agreedOn'
  | 'closedOn'
  | 'installments'
>

export interface ArrangementScanInput {
  arrangements: readonly ReminderArrangement[]
  settings: MonitoringSettings
  names: RecordNames
  asOf: ISODate
  /** Verified statements of the arrangements' leases, to flag instalments a statement shows were not covered. */
  statements?: readonly ArrangementStatementFigures[]
}

export interface ArrangementFindings {
  /** 'arrangement_attention' events for open instalments past their due date plus grace days. */
  overdue: EventDraft[]
  /** 'arrangement_attention' events for open instalments a verified statement shows were not covered. */
  shortOnStatement: EventDraft[]
  /** Heads-up for the responsible property manager about instalments due within the lead days. */
  upcoming: NotificationDraft[]
}

/**
 * Instalment findings for one company. This job never messages tenants: a tenant instalment reminder is
 * a communication a property manager prepares and approves. It also never changes instalment status:
 * LeaseGuard does not process or confirm payments, so whether an instalment was paid, missed or waived
 * is recorded by the property manager (or a verified statement), never inferred here.
 */
export function arrangementFindings(input: ArrangementScanInput): ArrangementFindings {
  const { settings, names, asOf } = input
  const rule = settings.rule('arrangement_attention')
  const graceDays = rule.config?.graceDays ?? 0
  const leadDays = settings.company.installmentReminderLeadDays
  const overdue: EventDraft[] = []
  const shortOnStatement: EventDraft[] = []
  const upcoming: NotificationDraft[] = []
  const statements = input.statements ?? []

  for (const arrangement of input.arrangements) {
    if (!isArrangementActive(arrangement, asOf)) continue
    const tenant = names.tenant(arrangement.tenantId)
    const total = arrangement.installments.length
    const manager = names.managerOf(arrangement.propertyId)

    if (rule.enabled) {
      const assignee = rule.defaultAssigneeUserId ?? manager
      for (const instalment of overdueInstallments(arrangement, asOf, graceDays)) {
        const late = daysBetween(instalment.dueDate, asOf)
        overdue.push({
          dedupeKey: `arrangement_attention:${instalment.id}`,
          type: 'arrangement_attention',
          propertyId: arrangement.propertyId,
          unitId: arrangement.unitId,
          tenantId: arrangement.tenantId,
          leaseId: arrangement.leaseId,
          arrangementId: arrangement.id,
          ...(rule.ruleId ? { ruleId: rule.ruleId } : {}),
          title: `Missed instalment: ${tenant} arrangement (${instalment.sequence} of ${total})`,
          description: `Instalment ${instalment.sequence} of ${formatZAR(instalment.amount)} was due on ${formatSADate(instalment.dueDate)} and is not recorded as paid ${dayCount(late)} later.`,
          identifiedOn: asOf,
          dueDate: instalment.dueDate,
          priority: rule.defaultPriority ?? 'high',
          recommendedAction: 'Confirm with the tenant or the latest statement whether the instalment was paid, and record the outcome on the arrangement.',
          ...(assignee ? { assignedToUserId: assignee } : {}),
        })
      }

      // A verified statement whose period holds the due date and whose payments do not cover that period's charges
      // plus the instalments due: flagged for the manager to confirm, never recorded as missed here.
      for (const found of installmentShortfallsOnStatements(arrangement, statements)) {
        const { installment } = found
        const period = `${formatSADate(found.periodStart)} to ${formatSADate(found.periodEnd)}`
        shortOnStatement.push({
          dedupeKey: `arrangement_attention:statement:${installment.id}`,
          type: 'arrangement_attention',
          propertyId: arrangement.propertyId,
          unitId: arrangement.unitId,
          tenantId: arrangement.tenantId,
          leaseId: arrangement.leaseId,
          arrangementId: arrangement.id,
          statementId: found.statementId,
          ...(rule.ruleId ? { ruleId: rule.ruleId } : {}),
          title: `Instalment not covered on statement: ${tenant} arrangement (${installment.sequence} of ${total})`,
          description: `The verified statement for ${period} shows ${formatZAR(found.paymentsReceived)} received against ${formatZAR(found.expected)} due in that period, including instalment ${installment.sequence} of ${formatZAR(installment.amount)} due on ${formatSADate(installment.dueDate)}.`,
          calculation: {
            expectedAmount: found.expected,
            actualAmount: found.paymentsReceived,
            difference: found.shortfall,
            steps: [
              `Rental charged ${formatZAR(found.rentalCharged)} + additional charges ${formatZAR(found.additionalCharges)} + instalments due ${formatZAR(found.installmentsDue)} = ${formatZAR(found.expected)}`,
              `Payments received ${formatZAR(found.paymentsReceived)}`,
              `Short by ${formatZAR(found.shortfall)}`,
            ],
          },
          identifiedOn: asOf,
          dueDate: installment.dueDate,
          priority: rule.defaultPriority ?? 'high',
          recommendedAction: 'Confirm with the tenant whether the instalment was paid, and record it on the arrangement as paid or missed.',
          ...(assignee ? { assignedToUserId: assignee } : {}),
        })
      }
    }

    const next = nextInstallment(arrangement, asOf)
    if (next && manager && daysBetween(asOf, next.dueDate) <= leadDays) {
      upcoming.push({
        dedupeKey: `arrangement_instalment_due:${next.id}:${manager}`,
        userId: manager,
        type: 'arrangement',
        severity: 'info',
        title: `Instalment due ${formatSADate(next.dueDate)}: ${tenant}`,
        body: `Instalment ${next.sequence} of ${total} (${formatZAR(next.amount)}) under the payment arrangement is due on ${formatSADate(next.dueDate)}. Prepare an instalment reminder for approval if the tenant should be reminded.`,
        link: { entityType: 'payment_arrangement', entityId: arrangement.id },
      })
    }
  }
  return { overdue, shortOnStatement, upcoming }
}
