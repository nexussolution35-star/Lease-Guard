/**
 * Runs the pure domain rules against the demo seed at DEMO_REFERENCE_DATE and asserts that every
 * monitoring event in the seed is justified by the data it points at. Guards against the seed and
 * the business logic drifting apart.
 */
import { describe, expect, it } from 'vitest'

import { createDemoSeed, DEMO_REFERENCE_DATE } from '@/services/demo/seed'
import type { EntityId, MonitoringEvent, MonitoringEventType, MonitoringRuleConfig } from '@leaseguard/domain'

import {
  ageArrears,
  canSendTenantMessage,
  compareBilledRental,
  depositCoverage,
  findDuplicateStatement,
  guaranteeCoverage,
  guaranteeExpiryStatus,
  leasesRequiringRenewalWarning,
  overdueInstallments,
  shouldRaiseExpiryEvent,
  shouldSuppressArrearsReminder,
} from '@leaseguard/domain'

const seed = createDemoSeed()
const TODAY = DEMO_REFERENCE_DATE

const events = Object.values(seed.monitoringEvents)
const statements = Object.values(seed.statements)
const arrangements = Object.values(seed.paymentArrangements)

const openEvents = (type: MonitoringEventType): MonitoringEvent[] =>
  events.filter((e) => e.type === type && e.status !== 'dismissed' && e.status !== 'resolved')

function ruleConfig<K extends MonitoringRuleConfig['kind']>(event: MonitoringEvent, kind: K): Extract<MonitoringRuleConfig, { kind: K }> {
  const rule = seed.monitoringRules[event.ruleId as EntityId]
  expect(rule, `event ${event.id} has no rule`).toBeDefined()
  expect(rule.config.kind).toBe(kind)
  return rule.config as Extract<MonitoringRuleConfig, { kind: K }>
}

/** "… in 90 days: …" → 90 */
function daysInTitle(event: MonitoringEvent): number {
  const m = /in (\d+) days/.exec(event.title)
  expect(m, `event ${event.id} title does not state a threshold`).not.toBeNull()
  return Number(m?.[1])
}

describe('seed monitoring events are justified by the domain rules', () => {
  it('rental_escalation_discrepancy: the statement bills less than the escalated rental', () => {
    const list = openEvents('rental_escalation_discrepancy')
    expect(list.length).toBeGreaterThanOrEqual(1)
    for (const event of list) {
      const lease = seed.leases[event.leaseId as EntityId]
      const statement = seed.statements[event.statementId as EntityId]
      const tolerance = ruleConfig(event, 'rental_escalation_discrepancy')
      expect(lease.verified, `lease ${lease.reference} must be verified before monitoring`).toBe(true)
      expect(statement.status).toBe('verified')
      expect(statement.rentalCharged).toBeDefined()
      const result = compareBilledRental(lease, statement.rentalCharged as number, statement.statementDate, tolerance)
      expect(result.withinTolerance, `event ${event.id} is within tolerance`).toBe(false)
      expect(result.difference, `event ${event.id} is not an under-charge`).toBeGreaterThan(0)
      expect(result.expected).toBeCloseTo(event.calculation?.expectedAmount ?? NaN, 2)
      expect(result.billed).toBeCloseTo(event.calculation?.actualAmount ?? NaN, 2)
      expect(result.difference).toBeCloseTo(event.calculation?.difference ?? NaN, 2)
      expect(result.expected).toBeCloseTo(lease.currentMonthlyRental, 2)
    }
  })

  it('lease_expiry: leases fall inside the stated notice threshold', () => {
    const list = openEvents('lease_expiry')
    expect(list.length).toBeGreaterThanOrEqual(3)
    for (const event of list) {
      const lease = seed.leases[event.leaseId as EntityId]
      const { noticeDays } = ruleConfig(event, 'lease_expiry')
      const company = seed.companies[event.companyId]
      expect([...noticeDays]).toEqual([...company.settings.leaseExpiryNoticeDays])
      const threshold = shouldRaiseExpiryEvent(lease, TODAY, noticeDays)
      expect(threshold, `event ${event.id}: lease ${lease.reference} is not inside any threshold`).not.toBeNull()
      expect(daysInTitle(event), `event ${event.id} title threshold`).toBe(threshold)
      expect(event.dueDate).toBe(lease.expiryDate)
    }
  })

  it('dismissed lease_expiry events carry a dismissal and point at a lease that has since lapsed or been dealt with', () => {
    for (const event of events.filter((e) => e.type === 'lease_expiry' && e.status === 'dismissed')) {
      expect(event.dismissal).toBeDefined()
      const lease = seed.leases[event.leaseId as EntityId]
      expect(['expired', 'renewed', 'terminated', 'active', 'expiring']).toContain(lease.status)
    }
  })

  it('renewal_notice_deadline: deadlines fall inside the company warning window', () => {
    const list = openEvents('renewal_notice_deadline')
    expect(list.length).toBeGreaterThanOrEqual(1)
    for (const event of list) {
      const lease = seed.leases[event.leaseId as EntityId]
      const { warningDays } = ruleConfig(event, 'renewal_notice_deadline')
      const company = seed.companies[event.companyId]
      expect([...warningDays]).toEqual([...company.settings.renewalDeadlineWarningDays])
      const warnings = leasesRequiringRenewalWarning([lease], TODAY, warningDays)
      expect(warnings, `event ${event.id}: ${lease.reference} needs no renewal warning`).toHaveLength(1)
      expect(warnings[0].deadline).toBe(event.dueDate)
      expect(daysInTitle(event)).toBe(warnings[0].threshold)
      expect(lease.renewalOption.exercised).toBe(false)
    }
  })

  it('guarantee_shortfall: the guarantee really falls short of the required coverage', () => {
    const list = openEvents('guarantee_shortfall')
    expect(list.length).toBeGreaterThanOrEqual(1)
    for (const event of list) {
      const lease = seed.leases[event.leaseId as EntityId]
      const config = ruleConfig(event, 'guarantee_shortfall')
      const coverage = guaranteeCoverage(lease, TODAY)
      expect(coverage, `lease ${lease.reference} has no guarantee`).not.toBeNull()
      expect(coverage?.shortfall ?? 0).toBeGreaterThan(config.toleranceRands)
      expect(coverage?.basisMonths).toBeGreaterThanOrEqual(config.minimumCoverageMonths)
      expect(coverage?.required).toBeCloseTo(event.calculation?.expectedAmount ?? NaN, 2)
      expect(coverage?.actual).toBeCloseTo(event.calculation?.actualAmount ?? NaN, 2)
      expect(coverage?.shortfall).toBeCloseTo(event.calculation?.difference ?? NaN, 2)
    }
  })

  it('deposit_shortfall: the deposit really falls short of the required coverage', () => {
    for (const event of openEvents('deposit_shortfall')) {
      const lease = seed.leases[event.leaseId as EntityId]
      const config = ruleConfig(event, 'deposit_shortfall')
      const coverage = depositCoverage(lease, TODAY)
      expect(coverage, `lease ${lease.reference} has no deposit basis`).not.toBeNull()
      expect(coverage?.shortfall ?? 0).toBeGreaterThan(0)
      expect(coverage?.basisMonths).toBeGreaterThanOrEqual(config.minimumCoverageMonths)
      expect(coverage?.shortfall).toBeCloseTo(event.calculation?.difference ?? NaN, 2)
    }
  })

  it('guarantee_expiry: guarantees expire inside the stated notice threshold', () => {
    const list = openEvents('guarantee_expiry')
    expect(list.length).toBeGreaterThanOrEqual(1)
    for (const event of list) {
      const lease = seed.leases[event.leaseId as EntityId]
      const { noticeDays } = ruleConfig(event, 'guarantee_expiry')
      const company = seed.companies[event.companyId]
      expect([...noticeDays]).toEqual([...company.settings.guaranteeExpiryNoticeDays])
      const guarantee = lease.bankGuarantee
      expect(guarantee, `lease ${lease.reference} has no guarantee`).toBeDefined()
      if (!guarantee) continue
      const status = guaranteeExpiryStatus(guarantee, TODAY, noticeDays)
      expect(status.state, `event ${event.id}`).toBe('expiring')
      expect(guarantee.status).toBe('expiring')
      expect(daysInTitle(event)).toBe(status.thresholdCrossed)
      expect(event.dueDate).toBe(guarantee.expiresOn)
      expect(event.title).toContain(guarantee.referenceNumber)
    }
  })

  it('arrears: tenants have a verified statement with a positive closing balance above the rule minimum', () => {
    const list = openEvents('arrears')
    expect(list.length).toBeGreaterThanOrEqual(2)
    for (const event of list) {
      const statement = seed.statements[event.statementId as EntityId]
      expect(statement, `event ${event.id} has no statement`).toBeDefined()
      expect(statement.status).toBe('verified')
      expect(statement.tenantId).toBe(event.tenantId)
      expect(statement.closingBalance ?? 0).toBeGreaterThan(0)
      const config = ruleConfig(event, 'arrears')
      const companyStatements = statements.filter((s) => s.companyId === event.companyId)
      const entry = ageArrears(companyStatements, TODAY, config.ageingBucketsDays).find((a) => a.tenantId === event.tenantId)
      expect(entry, `event ${event.id}: tenant not in arrears per ageArrears`).toBeDefined()
      expect(entry?.statementId, `event ${event.id} should point at the latest verified statement`).toBe(statement.id)
      expect(entry?.outstanding).toBeCloseTo(statement.closingBalance as number, 2)
      expect(entry?.outstanding ?? 0).toBeGreaterThanOrEqual(config.minimumBalanceRands)
      if (event.calculation?.actualAmount !== undefined) expect(event.calculation.actualAmount).toBeCloseTo(statement.closingBalance as number, 2)
      if (event.arrangementId) expect(seed.paymentArrangements[event.arrangementId].tenantId).toBe(event.tenantId)
    }
  })

  it('arrangement_attention: the arrangement has an instalment overdue beyond the grace period', () => {
    const list = openEvents('arrangement_attention')
    expect(list.length).toBeGreaterThanOrEqual(1)
    for (const event of list) {
      const arrangement = seed.paymentArrangements[event.arrangementId as EntityId]
      const { graceDays } = ruleConfig(event, 'arrangement_attention')
      const missed = arrangement.installments.filter((i) => i.status === 'missed')
      const overdue = overdueInstallments({ installments: arrangement.installments.map((i) => (i.status === 'missed' ? { ...i, status: 'scheduled' as const } : i)) }, TODAY, graceDays)
      expect(missed.length + overdue.length, `event ${event.id}: nothing overdue`).toBeGreaterThan(0)
      if (event.dueDate) expect(missed.map((i) => i.dueDate)).toContain(event.dueDate)
    }
  })

  it('statement_review_required: the statement is awaiting review with confidence below threshold', () => {
    const list = openEvents('statement_review_required')
    expect(list.length).toBeGreaterThanOrEqual(1)
    for (const event of list) {
      const statement = seed.statements[event.statementId as EntityId]
      const { confidenceThreshold } = ruleConfig(event, 'statement_review_required')
      expect(statement.status).toBe('review_required')
      const extraction = seed.statementExtractions[statement.extractionId as EntityId]
      expect(extraction, `statement ${statement.id} has no extraction`).toBeDefined()
      expect(extraction.status).toBe('pending_review')
      expect(extraction.overallConfidence).toBeLessThan(confidenceThreshold)
      expect(extraction.fields.some((f) => f.flagged)).toBe(true)
    }
  })
})

describe('seed arrangements and communications agree with the eligibility rules', () => {
  const active = arrangements.filter((a) => a.status === 'active')

  it('active arrangements suppress arrears reminders for their tenants', () => {
    expect(active.length).toBeGreaterThanOrEqual(2)
    for (const a of active) {
      expect(shouldSuppressArrearsReminder(a.tenantId, arrangements, TODAY), `arrangement ${a.id}`).toBe(true)
    }
    const suppressed = new Set(active.map((a) => a.tenantId))
    for (const tenant of Object.values(seed.tenants)) {
      if (!suppressed.has(tenant.id)) expect(shouldSuppressArrearsReminder(tenant.id, arrangements, TODAY), tenant.id).toBe(false)
    }
  })

  it('canSendTenantMessage refuses arrears reminders but allows instalment reminders while an arrangement is active', () => {
    for (const a of active) {
      const tenant = seed.tenants[a.tenantId]
      const company = seed.companies[a.companyId]
      const context = { settings: company.settings, approval: { decision: 'approved' as const }, arrangements, today: TODAY }
      for (const type of ['initial_payment_reminder', 'overdue_payment_reminder', 'follow_up_payment_reminder'] as const) {
        const result = canSendTenantMessage(tenant, type, context)
        expect(result.eligible, `${tenant.tradingName} ${type}`).toBe(false)
        expect(result.reasons.join(' ')).toMatch(/payment arrangement/i)
      }
      const installment = canSendTenantMessage(tenant, 'arrangement_installment_reminder', context)
      expect(installment.reasons.join(' ')).not.toMatch(/No active payment arrangement/)
    }
  })

  it('no dispatched arrears reminder in the seed was sent while the tenant had an active arrangement', () => {
    const reminderTypes: readonly string[] = ['initial_payment_reminder', 'overdue_payment_reminder', 'follow_up_payment_reminder']
    for (const c of Object.values(seed.communications)) {
      if (!reminderTypes.includes(c.messageType) || !c.sentAt || !c.tenantId) continue
      const sentOn = c.sentAt.slice(0, 10)
      expect(shouldSuppressArrearsReminder(c.tenantId, arrangements, sentOn), `communication ${c.id} sent during an active arrangement`).toBe(false)
    }
  })

  it('every sent tenant message was eligible for its tenant', () => {
    for (const c of Object.values(seed.communications)) {
      if (c.recipientType !== 'tenant' || c.direction !== 'outbound' || !c.sentAt || !c.tenantId) continue
      const tenant = seed.tenants[c.tenantId]
      const company = seed.companies[c.companyId]
      const approval = c.approvalId ? seed.messageApprovals[c.approvalId] : undefined
      const result = canSendTenantMessage(tenant, c.messageType, {
        settings: company.settings,
        approval,
        arrangements,
        today: c.sentAt.slice(0, 10),
      })
      expect(result.eligible, `communication ${c.id}: ${result.reasons.join('; ')}`).toBe(true)
    }
  })
})

describe('seed duplicate statement is detected', () => {
  it('the statement marked duplicate matches its original through findDuplicateStatement', () => {
    const duplicates = statements.filter((s) => s.status === 'duplicate')
    expect(duplicates.length).toBeGreaterThanOrEqual(1)
    for (const dup of duplicates) {
      const others = statements.filter((s) => s.companyId === dup.companyId && s.id !== dup.id)
      const match = findDuplicateStatement(dup, others)
      expect(match, `duplicate ${dup.id} not detected`).not.toBeNull()
      expect(match?.existingStatementId).toBe(dup.duplicateOfStatementId)
    }
  })

  it('no other statement in a company is a duplicate of another', () => {
    for (const companyId of Object.keys(seed.companies)) {
      const scoped = statements.filter((s) => s.companyId === companyId && s.status !== 'duplicate')
      for (const s of scoped) {
        const match = findDuplicateStatement(s, scoped.filter((o) => o.id !== s.id))
        expect(match, `statement ${s.id} unexpectedly duplicates ${match?.existingStatementId}`).toBeNull()
      }
    }
  })
})
