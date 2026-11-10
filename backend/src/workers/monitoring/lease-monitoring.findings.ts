import {
  EXPIRY_EVENT_PRIORITY,
  RENEWAL_EVENT_PRIORITY,
  buildEscalationCalculation,
  compareBilledRental,
  depositCoverage,
  daysUntilExpiry,
  expiryStatusForDays,
  formatSADate,
  formatZAR,
  guaranteeCoverage,
  guaranteeExpiryStatus,
  leasesRequiringRenewalWarning,
  MONITORED_LEASE_STATUSES,
  renewalDeadlineStatus,
  shouldRaiseExpiryEvent,
  type EntityId,
  type ISODate,
  type Lease,
  type MonitoringEventType,
  type ZAR,
} from '@leaseguard/domain'

import type { EventDraft } from '../shared/monitoring-outputs'
import type { MonitoringSettings, RuleSettings } from '../shared/monitoring-settings'
import { dayCount, type RecordNames } from './event-presentation'

/** Rental billed on the latest verified statement of a lease. */
export interface BilledRental {
  statementId: EntityId
  /** Billing period start: the date the contractual rental is evaluated at. */
  periodStart: ISODate
  rentalCharged: ZAR
}

export interface LeaseScanInput {
  leases: readonly Lease[]
  /** Latest verified statement with a rental figure, per lease id. */
  billedRentals: ReadonlyMap<EntityId, BilledRental>
  settings: MonitoringSettings
  names: RecordNames
  asOf: ISODate
}

const money = (amount: ZAR): string => amount.toFixed(2)

/**
 * The lease findings for one company on `asOf`. Only VERIFIED leases in a monitored status are
 * considered: unverified terms never drive monitoring (the database also rejects financial events on
 * unverified leases). Every rule comes from @leaseguard/domain; company rules may disable an event type
 * or override its parameters, otherwise the company settings apply.
 */
export function leaseFindings(input: LeaseScanInput): EventDraft[] {
  const { settings, names, asOf } = input
  const leases = input.leases.filter((lease) => lease.verified && MONITORED_LEASE_STATUSES.includes(lease.status))
  const drafts: EventDraft[] = []

  const base = (lease: Lease, rule: Pick<RuleSettings<MonitoringEventType>, 'ruleId' | 'defaultAssigneeUserId'>) => {
    const assignee = rule.defaultAssigneeUserId ?? names.managerOf(lease.propertyId)
    return {
      propertyId: lease.propertyId,
      unitId: lease.unitId,
      tenantId: lease.tenantId,
      leaseId: lease.id,
      leaseReference: lease.reference,
      identifiedOn: asOf,
      ...(rule.ruleId ? { ruleId: rule.ruleId } : {}),
      ...(assignee ? { assignedToUserId: assignee } : {}),
    }
  }
  const who = (lease: Lease): string => `${names.tenant(lease.tenantId)} (${names.unit(lease.unitId)})`

  // ---------------------------------------------------------------- lease expiry
  const expiryRule = settings.rule('lease_expiry')
  if (expiryRule.enabled) {
    const noticeDays = expiryRule.config?.noticeDays ?? settings.company.leaseExpiryNoticeDays
    for (const lease of leases) {
      const threshold = shouldRaiseExpiryEvent(lease, asOf, noticeDays)
      if (threshold === null) continue
      const days = daysUntilExpiry(lease, asOf)
      drafts.push({
        ...base(lease, expiryRule),
        dedupeKey: `lease_expiry:${lease.id}:${lease.expiryDate}:${threshold}`,
        type: 'lease_expiry',
        title: `Lease expires in ${dayCount(days)}: ${who(lease)}`,
        description: `Lease ${lease.reference} expires on ${formatSADate(lease.expiryDate)} (${threshold}-day notice threshold reached).`,
        dueDate: lease.expiryDate,
        priority: EXPIRY_EVENT_PRIORITY[expiryStatusForDays(days)],
        recommendedAction: 'Confirm renewal, relocation or vacating plans with the owner and record the outcome on the lease.',
      })
    }
  }

  // ---------------------------------------------------------------- renewal notice deadline
  const renewalRule = settings.rule('renewal_notice_deadline')
  if (renewalRule.enabled) {
    const warningDays = renewalRule.config?.warningDays ?? settings.company.renewalDeadlineWarningDays
    for (const warning of leasesRequiringRenewalWarning(leases, asOf, warningDays)) {
      const { lease, deadline, daysUntilDeadline, threshold } = warning
      drafts.push({
        ...base(lease, renewalRule),
        dedupeKey: `renewal_notice_deadline:${lease.id}:${deadline}:${threshold}`,
        type: 'renewal_notice_deadline',
        title: `Renewal notice deadline in ${dayCount(daysUntilDeadline)}: ${who(lease)}`,
        description: `Written notice to exercise the renewal option on lease ${lease.reference} must be given by ${formatSADate(deadline)}.`,
        dueDate: deadline,
        priority: RENEWAL_EVENT_PRIORITY[renewalDeadlineStatus(lease, asOf)],
        recommendedAction: 'Confirm with the owner whether the renewal option will be exercised before the deadline.',
      })
    }
  }

  // ---------------------------------------------------------------- bank guarantee expiry
  const guaranteeExpiryRule = settings.rule('guarantee_expiry')
  if (guaranteeExpiryRule.enabled) {
    const noticeDays = guaranteeExpiryRule.config?.noticeDays ?? settings.company.guaranteeExpiryNoticeDays
    for (const lease of leases) {
      const guarantee = lease.bankGuarantee
      if (!guarantee) continue
      const status = guaranteeExpiryStatus(guarantee, asOf, noticeDays)
      if (status.state !== 'expiring' && status.state !== 'expired') continue
      const expired = status.state === 'expired'
      drafts.push({
        ...base(lease, guaranteeExpiryRule),
        dedupeKey: `guarantee_expiry:${lease.id}:${guarantee.expiresOn}:${expired ? 'expired' : status.thresholdCrossed}`,
        type: 'guarantee_expiry',
        title: expired
          ? `Bank guarantee has expired: ${guarantee.bank} ${guarantee.referenceNumber}`
          : `Bank guarantee expires in ${dayCount(status.daysUntilExpiry)}: ${guarantee.bank} ${guarantee.referenceNumber}`,
        description: `The ${formatZAR(guarantee.amount)} bank guarantee for ${who(lease)} on lease ${lease.reference} ${expired ? 'expired' : 'expires'} on ${formatSADate(guarantee.expiresOn)}.`,
        dueDate: guarantee.expiresOn,
        priority: EXPIRY_EVENT_PRIORITY[expiryStatusForDays(status.daysUntilExpiry)],
        recommendedAction: 'Request a renewed or replacement bank guarantee and update the lease record.',
      })
    }
  }

  // ---------------------------------------------------------------- guarantee shortfall
  const guaranteeShortfallRule = settings.rule('guarantee_shortfall')
  if (guaranteeShortfallRule.enabled) {
    const toleranceRands = guaranteeShortfallRule.config?.toleranceRands ?? 0
    const minimumMonths = guaranteeShortfallRule.config?.minimumCoverageMonths ?? 0
    for (const lease of leases) {
      const guarantee = lease.bankGuarantee
      if (!guarantee || (guarantee.status !== 'active' && guarantee.status !== 'expiring')) continue
      const coverage = guaranteeCoverage(lease, asOf)
      if (!coverage) continue
      if (coverage.shortfall <= toleranceRands && coverage.coverageMonths >= minimumMonths) continue
      drafts.push({
        ...base(lease, guaranteeShortfallRule),
        dedupeKey: `guarantee_shortfall:${lease.id}:${money(coverage.required)}:${money(coverage.actual)}`,
        type: 'guarantee_shortfall',
        title: `Guarantee shortfall: ${names.tenant(lease.tenantId)} guarantee covers ${coverage.coverageMonths} months of current rental`,
        description: `The guarantee of ${formatZAR(coverage.actual)} is ${formatZAR(coverage.shortfall)} short of the ${formatZAR(coverage.required)} required (${coverage.basisMonths} months of the expected rental of ${formatZAR(coverage.expectedMonthlyRental)}).`,
        calculation: {
          expectedAmount: coverage.required,
          actualAmount: coverage.actual,
          difference: coverage.shortfall,
          steps: [
            ...buildEscalationCalculation(lease, asOf).steps,
            `Required guarantee: ${coverage.basisMonths} months × ${formatZAR(coverage.expectedMonthlyRental)} = ${formatZAR(coverage.required)}`,
            `Guarantee held: ${formatZAR(coverage.actual)} (${coverage.coverageMonths} months)`,
            `Shortfall: ${formatZAR(coverage.shortfall)}`,
          ],
        },
        priority: guaranteeShortfallRule.defaultPriority ?? 'high',
        recommendedAction: 'Ask the tenant for an increased bank guarantee in line with the escalated rental.',
      })
    }
  }

  // ---------------------------------------------------------------- deposit shortfall
  const depositRule = settings.rule('deposit_shortfall')
  if (depositRule.enabled) {
    for (const lease of leases) {
      const coverage = depositCoverage(lease, asOf)
      if (!coverage) continue
      const minimumMonths = depositRule.config?.minimumCoverageMonths ?? coverage.basisMonths
      if (coverage.coverageMonths >= minimumMonths) continue
      drafts.push({
        ...base(lease, depositRule),
        dedupeKey: `deposit_shortfall:${lease.id}:${money(coverage.expectedMonthlyRental)}:${money(coverage.actual)}`,
        type: 'deposit_shortfall',
        title: `Deposit shortfall: ${names.tenant(lease.tenantId)} deposit covers ${coverage.coverageMonths} months of rental`,
        description: `The deposit of ${formatZAR(coverage.actual)} covers ${coverage.coverageMonths} months of the expected rental of ${formatZAR(coverage.expectedMonthlyRental)}; at least ${minimumMonths} months are expected.`,
        calculation: {
          expectedAmount: coverage.required,
          actualAmount: coverage.actual,
          difference: coverage.shortfall,
          steps: [
            ...buildEscalationCalculation(lease, asOf).steps,
            `Deposit held: ${formatZAR(coverage.actual)} = ${coverage.coverageMonths} months of ${formatZAR(coverage.expectedMonthlyRental)}`,
            `Minimum cover: ${minimumMonths} months`,
          ],
        },
        priority: depositRule.defaultPriority ?? 'medium',
        recommendedAction: 'Review the deposit against the lease terms and agree a top-up with the owner if required.',
      })
    }
  }

  // ---------------------------------------------------------------- rental escalation discrepancy
  const escalationRule = settings.rule('rental_escalation_discrepancy')
  if (escalationRule.enabled) {
    const tolerance = escalationRule.config ?? { toleranceRands: 0, tolerancePercent: 0 }
    for (const lease of leases) {
      const billed = input.billedRentals.get(lease.id)
      if (!billed) continue
      const comparison = compareBilledRental(lease, billed.rentalCharged, billed.periodStart, tolerance)
      if (comparison.withinTolerance) continue
      const under = comparison.difference > 0
      drafts.push({
        ...base(lease, escalationRule),
        statementId: billed.statementId,
        dedupeKey: `rental_escalation_discrepancy:${billed.statementId}`,
        type: 'rental_escalation_discrepancy',
        title: `Rental ${under ? 'under' : 'over'}-charged: ${who(lease)}`,
        description: `The statement for the period from ${formatSADate(billed.periodStart)} billed ${formatZAR(comparison.billed)}; the verified lease terms expect ${formatZAR(comparison.expected)} (difference ${formatZAR(comparison.difference)}).`,
        calculation: comparison.calculation,
        priority: escalationRule.defaultPriority ?? 'high',
        recommendedAction: 'Check the escalation in the accounting system and correct the billed rental.',
      })
    }
  }

  return drafts
}
