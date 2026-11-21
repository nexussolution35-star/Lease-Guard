import path from 'node:path'

import { unwrap } from '@leaseguard/api-client'
import { formatSADate, formatZAR, MESSAGE_TYPES, TENANT_MESSAGE_TYPES } from '@leaseguard/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadWorkerEnv } from '../../backend/src/config/env.ts'
import { ServiceRoleClientFactory } from '../../backend/src/infrastructure/database/service-role-client.factory.ts'
import type { ProcessorRuntime } from '../../backend/src/workers/jobs/processor-runtime.ts'
import { ArrearsMonitoringProcessor } from '../../backend/src/workers/monitoring/arrears-monitoring.processor.ts'
import { LeaseMonitoringProcessor } from '../../backend/src/workers/monitoring/lease-monitoring.processor.ts'
import { StatementMonitoringProcessor } from '../../backend/src/workers/monitoring/statement-monitoring.processor.ts'
import { Clock } from '../../backend/src/workers/shared/clock.ts'
import { NOTIFY_PRIORITIES } from '../../backend/src/workers/shared/monitoring-outputs.ts'
import { AS_OF, createMonitoringPortfolio, EXAMPLES, removeMonitoringPortfolio, SCENARIOS, type MonitoringPortfolio, type Scenario } from '../fixtures/monitoring-acceptance.ts'
import { TEST_OUTPUT_ROOT } from '../fixtures/paths.ts'
import { apiAs, check, integration, serviceRole, world } from './support/clients.ts'
import { logWorkerToFile, workerEnvironment } from './support/in-process-worker.ts'

/**
 * Monitoring accuracy acceptance (ticket M7-06), PRD §13.4 with the examples of §5.7 A-E, on the local stack: one lease
 * per rule is added to the world's property DIP (`fixtures/monitoring-acceptance.ts`) and the worker's real daily scans
 * (`lease-monitoring`, `arrears-monitoring`, built in this process from the backend source as WorkersModule wires them,
 * service role, no queue consumed; log `test-results/integration/worker-monitoring-acceptance.log`) run on the
 * scenario's date, limited to the scenario's tenant so no other row of the world is touched.
 *
 * Each rule raises exactly its event with the PRD's figures, assigned to the property's manager (notified when it is
 * high or critical) and traceable through the API to its lease, tenant, unit, property and statement. Unverified lease
 * terms and statements under review raise nothing, and the same terms raise their events once a manager verifies them.
 * No event creates a tenant message: monitoring never writes communications, and the database refuses a tenant message
 * that is not a statement or payment message.
 */

let portfolio: MonitoringPortfolio
let arrears: ArrearsMonitoringProcessor
let leases: LeaseMonitoringProcessor
let statementMonitoring: StatementMonitoringProcessor
let restoreLogger: (() => void) | undefined

interface EventRow {
  id: string
  type: string
  dedupe_key: string
  status: string
  priority: string
  property_id: string
  unit_id: string | null
  tenant_id: string | null
  lease_id: string | null
  lease_reference: string | null
  statement_id: string | null
  due_date: string | null
  identified_on: string
  title: string
  description: string
  assigned_to_user_id: string | null
  calculation: { expectedAmount?: number; actualAmount?: number; difference?: number; steps: string[] } | null
}

const party = (scenario: Scenario) => portfolio.parties[scenario]

/** The daily scans for one scenario's tenant on `asOf`. */
async function scan(scenario: Scenario, asOf: string = AS_OF) {
  const scope = { tenantId: party(scenario).tenantId }
  const input = { companyId: portfolio.companyId, asOf }
  return { arrears: await arrears.scan(input, scope), leases: await leases.scan(input, scope) }
}

async function eventsOf(scenario: Scenario): Promise<EventRow[]> {
  const rows = check(
    await serviceRole()
      .from('monitoring_events')
      .select('id, type, dedupe_key, status, priority, property_id, unit_id, tenant_id, lease_id, lease_reference, statement_id, due_date, identified_on, title, description, assigned_to_user_id, calculation')
      .eq('company_id', portfolio.companyId)
      .eq('tenant_id', party(scenario).tenantId)
      .overrideTypes<EventRow[], { merge: false }>(),
    `Read the ${scenario} events`,
  )
  return rows.sort((a, b) => a.type.localeCompare(b.type))
}

/** The one event the scenario raised; fails when it raised anything else. */
async function onlyEvent(scenario: Scenario, type: string): Promise<EventRow> {
  const events = await eventsOf(scenario)
  expect(events.map((event) => event.type)).toEqual([type])
  return events[0]!
}

/** The event names the scenario's own records and is assigned to the property's manager. */
function expectTracedToLease(event: EventRow, scenario: Scenario, identifiedOn: string = AS_OF): void {
  const { tenantId, unitId, leaseId, leaseReference } = party(scenario)
  expect(event).toMatchObject({
    status: 'new',
    property_id: portfolio.propertyId,
    unit_id: unitId,
    tenant_id: tenantId,
    lease_id: leaseId,
    lease_reference: leaseReference,
    identified_on: identifiedOn,
    assigned_to_user_id: world().users.manager.id,
  })
}

/** Every event the acceptance raised, for the traceability and messaging checks. */
const raised: { scenario: Scenario; event: EventRow }[] = []

beforeAll(async () => {
  const ctx = integration()
  const company = world().companies.a
  const property = company.properties.find((candidate) => candidate.code === 'DIP')
  if (!property) throw new Error('The world has no property DIP in company A')
  portfolio = await createMonitoringPortfolio(serviceRole(), {
    companyId: company.id,
    propertyId: property.id,
    verifierUserId: world().users.manager.id,
    runId: `${ctx.runId}mon`,
  })

  restoreLogger = logWorkerToFile(path.join(TEST_OUTPUT_ROOT, 'integration', 'worker-monitoring-acceptance.log'))
  // The worker's processors on the local stack only (service role). `onModuleInit` is never called, so no queue is
  // consumed and the runtime is never used.
  const env = loadWorkerEnv(
    workerEnvironment({ NODE_ENV: 'test', SUPABASE_URL: ctx.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: ctx.serviceRoleKey, REDIS_URL: ctx.redisUrl, QUEUE_PREFIX: ctx.queuePrefix }),
  )
  const clients = new ServiceRoleClientFactory(env)
  const unusedRuntime = {} as ProcessorRuntime
  arrears = new ArrearsMonitoringProcessor(unusedRuntime, clients)
  leases = new LeaseMonitoringProcessor(unusedRuntime, clients)
  statementMonitoring = new StatementMonitoringProcessor(unusedRuntime, clients, new Clock(), arrears, leases)
})

afterAll(async () => {
  restoreLogger?.()
  if (portfolio) await removeMonitoringPortfolio(serviceRole(), portfolio)
})

describe('PRD §13.4: each rule raises its event with the PRD example, from verified data', () => {
  it('escalation: R35 000 at 8% a year billed at R35 000 is a R2 800 discrepancy against the expected R37 800', async () => {
    const { escalation } = EXAMPLES
    const result = await scan('escalation')
    expect(result.leases).toMatchObject({ findings: 1, created: 1 })
    expect(result.arrears.findings).toBe(0)

    const event = await onlyEvent('escalation', 'rental_escalation_discrepancy')
    expectTracedToLease(event, 'escalation')
    expect(event.statement_id).toBe(party('escalation').statementId)
    expect(event.dedupe_key).toBe(`rental_escalation_discrepancy:${party('escalation').statementId}`)
    expect(event.priority).toBe('high')
    // The expected amount, the billed amount, the difference and the calculation behind them (§5.7 A).
    expect(event.calculation).toMatchObject({ expectedAmount: escalation.expectedRental, actualAmount: escalation.billedRental, difference: escalation.difference })
    const steps = event.calculation!.steps.join('\n')
    expect(steps).toContain(formatZAR(escalation.initialMonthlyRental))
    expect(steps).toContain(formatZAR(escalation.expectedRental))
    expect(steps).toContain(`Billed rental: ${formatZAR(escalation.billedRental)}`)
    expect(steps).toContain(`Difference (expected − billed): ${formatZAR(escalation.difference)}`)
    expect(event.description).toContain(formatZAR(escalation.expectedRental))
    raised.push({ scenario: 'escalation', event })
  })

  it('lease expiry: a lease expiring 15 Jan 2027 is raised on 02 Nov 2026, 74 days ahead, at the 90-day notice threshold', async () => {
    const { expiry } = EXAMPLES
    const result = await scan('expiry')
    expect(result.leases).toMatchObject({ findings: 1, created: 1 })

    const event = await onlyEvent('expiry', 'lease_expiry')
    expectTracedToLease(event, 'expiry')
    expect(event.due_date).toBe(expiry.expiryDate)
    expect(event.dedupe_key).toBe(`lease_expiry:${party('expiry').leaseId}:${expiry.expiryDate}:${expiry.threshold}`)
    expect(event.title).toContain(`${expiry.daysUntilExpiry} days`)
    expect(event.title).toContain(party('expiry').tradingName)
    expect(event.description).toContain(formatSADate(expiry.expiryDate))
    raised.push({ scenario: 'expiry', event })
  })

  it('renewal: a lease expiring 31 Dec 2027 with three months of notice has its deadline on 30 Sep 2027, warned 60 days ahead', async () => {
    const { renewal } = EXAMPLES
    // On 02 Nov 2026 the deadline is almost a year away: no warning yet.
    expect((await scan('renewal')).leases.findings).toBe(0)

    const result = await scan('renewal', renewal.asOf)
    // The renewal warning, and the lease expiry five months ahead (180-day threshold) that the same date crosses.
    expect(result.leases).toMatchObject({ findings: 2, created: 2 })
    const events = await eventsOf('renewal')
    expect(events.map((event) => event.type)).toEqual(['lease_expiry', 'renewal_notice_deadline'])
    const event = events.find((candidate) => candidate.type === 'renewal_notice_deadline')!
    expectTracedToLease(event, 'renewal', renewal.asOf)
    expect(event.due_date).toBe(renewal.deadline)
    expect(event.dedupe_key).toBe(`renewal_notice_deadline:${party('renewal').leaseId}:${renewal.deadline}:${renewal.threshold}`)
    expect(event.title).toContain(`${renewal.daysUntilDeadline} days`)
    expect(event.description).toContain(formatSADate(renewal.deadline))
    expect(events.find((candidate) => candidate.type === 'lease_expiry')?.due_date).toBe(renewal.expiryDate)
    for (const each of events) raised.push({ scenario: 'renewal', event: each })
  })

  it('guarantee shortfall: three months of the original R35 000 (R105 000) is R8 400 short of three months after escalation', async () => {
    const { shortfall, escalation } = EXAMPLES
    const result = await scan('shortfall')
    expect(result.leases).toMatchObject({ findings: 1, created: 1 })

    const event = await onlyEvent('shortfall', 'guarantee_shortfall')
    expectTracedToLease(event, 'shortfall')
    expect(event.priority).toBe('high')
    expect(event.calculation).toMatchObject({ expectedAmount: shortfall.required, actualAmount: shortfall.guaranteeAmount, difference: shortfall.shortfall })
    const steps = event.calculation!.steps.join('\n')
    expect(steps).toContain(`Required guarantee: ${shortfall.basisMonths} months × ${formatZAR(escalation.expectedRental)} = ${formatZAR(shortfall.required)}`)
    expect(steps).toContain(`Shortfall: ${formatZAR(shortfall.shortfall)}`)
    raised.push({ scenario: 'shortfall', event })
  })

  it('guarantee expiry: a guarantee expiring 30 Nov 2026 is raised on 02 Nov 2026 at the 30-day notice threshold', async () => {
    const { guaranteeExpiry } = EXAMPLES
    const result = await scan('guaranteeExpiry')
    expect(result.leases).toMatchObject({ findings: 1, created: 1 })

    const event = await onlyEvent('guaranteeExpiry', 'guarantee_expiry')
    expectTracedToLease(event, 'guaranteeExpiry')
    expect(event.due_date).toBe(guaranteeExpiry.expiresOn)
    expect(event.dedupe_key).toBe(`guarantee_expiry:${party('guaranteeExpiry').leaseId}:${guaranteeExpiry.expiresOn}:${guaranteeExpiry.threshold}`)
    expect(event.description).toContain(formatSADate(guaranteeExpiry.expiresOn))
    raised.push({ scenario: 'guaranteeExpiry', event })
  })

  it('arrears: the verified statement of 30 Sep 2026 with R46 000 outstanding is raised, aged 33 days (bucket 30)', async () => {
    const { arrears: example } = EXAMPLES
    const result = await scan('arrears')
    expect(result.arrears).toMatchObject({ findings: 1, created: 1, suppressed: 0 })
    // Billed at the lease rental: no escalation discrepancy.
    expect(result.leases.findings).toBe(0)

    const event = await onlyEvent('arrears', 'arrears')
    expectTracedToLease(event, 'arrears')
    expect(event.statement_id).toBe(party('arrears').statementId)
    expect(event.dedupe_key).toBe(`arrears:${party('arrears').statementId}:${example.bucket}`)
    expect(event.calculation?.actualAmount).toBe(example.outstanding)
    expect(event.description).toContain(formatSADate(example.statementDate))
    expect(event.description).toContain(formatZAR(example.outstanding))
    expect(event.description).toContain(`ageing bucket ${example.bucket}`)
    raised.push({ scenario: 'arrears', event })
  })

  it('running every scan again raises nothing new', async () => {
    for (const scenario of SCENARIOS) {
      if (scenario === 'unverified') continue
      const again = await scan(scenario, scenario === 'renewal' ? EXAMPLES.renewal.asOf : AS_OF)
      expect(again.arrears.created + again.leases.created, scenario).toBe(0)
    }
  })
})

describe('PRD §13.4: monitoring events are traceable to their source data', () => {
  it('the API names, for any member, the lease, tenant, unit, property, statement and calculation each event came from', async () => {
    expect(raised.map(({ event }) => event.type).sort()).toEqual(
      ['arrears', 'guarantee_expiry', 'guarantee_shortfall', 'lease_expiry', 'lease_expiry', 'rental_escalation_discrepancy', 'renewal_notice_deadline'].sort(),
    )
    const propertyName = world().companies.a.properties.find((candidate) => candidate.id === portfolio.propertyId)!.name
    for (const { scenario, event } of raised) {
      const { tenantId, unitId, unitNumber, tradingName, leaseId, leaseReference, statementId } = party(scenario)
      const detail = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/monitoring/events/{eventId}', { params: { path: { eventId: event.id } } }))
      expect(detail, `${scenario} ${event.type}`).toMatchObject({
        id: event.id,
        type: event.type,
        propertyId: portfolio.propertyId,
        propertyName,
        unitId,
        unitNumber,
        tenantId,
        tenantName: tradingName,
        leaseId,
        leaseReference,
        assigneeName: world().users.manager.fullName,
        ...(event.statement_id ? { statementId } : {}),
        ...(event.calculation ? { calculation: event.calculation } : {}),
      })
      if (!event.statement_id) expect(detail.statementId).toBeUndefined()
      // The source records themselves are readable through the API.
      const lease = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/leases/{leaseId}', { params: { path: { leaseId } } }))
      expect(lease).toMatchObject({ id: leaseId, reference: leaseReference, tenantId, unitId, verified: true })
    }
  })

  it('the responsible property manager is notified of every high or critical event, with a link to it', async () => {
    const notifiable = raised.filter(({ event }) => (NOTIFY_PRIORITIES as readonly string[]).includes(event.priority))
    expect(notifiable.map(({ event }) => event.type)).toEqual(expect.arrayContaining(['rental_escalation_discrepancy', 'guarantee_shortfall']))
    const notifications = check(
      await serviceRole()
        .from('notifications')
        .select('user_id, type, link_entity_id')
        .eq('company_id', portfolio.companyId)
        .eq('link_entity_type', 'monitoring_event')
        .in('link_entity_id', raised.map(({ event }) => event.id)),
      'Read notifications',
    ) as { user_id: string; type: string; link_entity_id: string }[]
    expect(notifications.map((row) => row.link_entity_id).sort()).toEqual(notifiable.map(({ event }) => event.id).sort())
    expect(notifications.every((row) => row.user_id === world().users.manager.id && row.type === 'monitoring_event')).toBe(true)
  })
})

describe('PRD §13.4: an unverified lease or statement raises nothing', () => {
  it('a lease pending verification and a statement under review raise no event on any date, and the database refuses one', async () => {
    const unverified = party('unverified')
    for (const asOf of [AS_OF, EXAMPLES.renewal.asOf]) {
      const result = await scan('unverified', asOf)
      expect(result.leases.findings, asOf).toBe(0)
      expect(result.arrears.findings, asOf).toBe(0)
    }
    await expect(statementMonitoring.run({ companyId: portfolio.companyId, statementId: unverified.statementId! })).resolves.toEqual({ skipped: 'not_verified' })
    expect(await eventsOf('unverified')).toEqual([])

    // The last line of defence: a financial finding on unverified terms cannot be stored at all.
    const refused = await serviceRole().from('monitoring_events').insert({
      company_id: portfolio.companyId,
      dedupe_key: `m7-06-refused:${unverified.leaseId}`,
      type: 'guarantee_shortfall',
      property_id: portfolio.propertyId,
      unit_id: unverified.unitId,
      tenant_id: unverified.tenantId,
      lease_id: unverified.leaseId,
      title: 'Guarantee shortfall on unverified terms',
      description: 'Must be refused',
      identified_on: AS_OF,
      priority: 'high',
      recommended_action: 'None',
      status: 'new',
    })
    expect(refused.error?.code).toBe('23514')
    expect(refused.error?.message).toContain('require a verified lease')
  })

  it('the same terms raise their events once a property manager verifies the lease; the statement under review still raises nothing', async () => {
    const unverified = party('unverified')
    const verified = await unwrap(apiAs('manager', 'a').POST('/api/v1/leases/{leaseId}/verify', { params: { path: { leaseId: unverified.leaseId } } }))
    expect(verified).toMatchObject({ verified: true, status: 'active' })

    const result = await scan('unverified')
    expect(result.arrears.findings).toBe(0)
    const events = await eventsOf('unverified')
    expect(events.map((event) => event.type)).toEqual(['guarantee_expiry', 'guarantee_shortfall', 'lease_expiry', 'renewal_notice_deadline'])
    expect(events.find((event) => event.type === 'guarantee_shortfall')?.calculation).toMatchObject({
      expectedAmount: EXAMPLES.shortfall.required,
      actualAmount: EXAMPLES.shortfall.guaranteeAmount,
      difference: EXAMPLES.shortfall.shortfall,
    })
    // No verified statement: no escalation discrepancy and no arrears, however the lease is billed.
    expect(events.some((event) => event.statement_id !== null)).toBe(false)
    for (const event of events) raised.push({ scenario: 'unverified', event })
  })
})

describe('no tenant message for escalation, expiry, renewal or guarantee events', () => {
  it('monitoring created no communication for any tenant of the portfolio', async () => {
    expect(raised.length).toBeGreaterThan(0)
    const tenantIds = Object.values(portfolio.parties).map((each) => each.tenantId)
    const { count, error } = await serviceRole()
      .from('communications')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', portfolio.companyId)
      .in('tenant_id', tenantIds)
    expect(error).toBeNull()
    expect(count).toBe(0)
  })

  it('tenants can only ever receive statement and payment messages: the database refuses any other tenant message', async () => {
    expect([...TENANT_MESSAGE_TYPES].sort()).toEqual(
      ['arrangement_installment_reminder', 'follow_up_payment_reminder', 'initial_payment_reminder', 'monthly_statement', 'overdue_payment_reminder'].sort(),
    )
    // No message type exists for escalations, expiries, renewals, disputes or guarantees.
    expect(MESSAGE_TYPES.filter((type) => /escalat|expir|renew|disput|guarant/.test(type))).toEqual([])

    const tenant = party('escalation')
    const refused = await serviceRole().from('communications').insert({
      company_id: portfolio.companyId,
      channel: 'whatsapp',
      direction: 'outbound',
      message_type: 'manual',
      recipient_type: 'tenant',
      tenant_id: tenant.tenantId,
      property_id: portfolio.propertyId,
      lease_id: tenant.leaseId,
      counterparty_number: '+27820000000',
      company_number: '+27110000000',
      body: `Your rental increases to ${formatZAR(EXAMPLES.escalation.expectedRental)}`,
      status: 'draft',
    })
    expect(refused.error?.code).toBe('23514')
    expect(refused.error?.message).toContain('communications_tenant_message_type_check')
  })
})
