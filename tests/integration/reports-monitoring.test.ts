import path from 'node:path'

import { unwrap } from '@leaseguard/api-client'
import { daysBetween, OPEN_EVENT_STATUSES } from '@leaseguard/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadWorkerEnv } from '../../backend/src/config/env.ts'
import { ServiceRoleClientFactory } from '../../backend/src/infrastructure/database/service-role-client.factory.ts'
import type { ProcessorRuntime } from '../../backend/src/workers/jobs/processor-runtime.ts'
import { LeaseMonitoringProcessor } from '../../backend/src/workers/monitoring/lease-monitoring.processor.ts'
import { AS_OF, createMonitoringPortfolio, EXAMPLES, removeMonitoringPortfolio, type MonitoringPortfolio } from '../fixtures/monitoring-acceptance.ts'
import { TEST_OUTPUT_ROOT } from '../fixtures/paths.ts'
import { apiAs, apiErrorOf, check, gatewayAs, integration, serviceRole, world } from './support/clients.ts'
import { logWorkerToFile, workerEnvironment } from './support/in-process-worker.ts'

/**
 * Lease monitoring and rental discrepancies (ticket R-02) on the local stack, through the gateway like the web app: the
 * reports service computes them from the reporting functions under the caller's RLS. The monitoring acceptance
 * portfolio (`fixtures/monitoring-acceptance.ts`) is added to company A and the worker's real lease scan runs for its
 * escalation lease (R35 000 at 8% billed R35 000), so the report is checked against the event monitoring raised, the
 * dashboard's figures and the database, for every member role, never across companies.
 */

type User = 'admin' | 'manager' | 'readOnly' | 'owner'

const monitoringOf = (company: 'a' | 'b', user: User = 'manager', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/lease_monitoring', { params: { query } }))
const discrepanciesOf = (company: 'a' | 'b', user: User = 'manager', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/rental_discrepancies', { params: { query } }))
const dashboardOf = (company: 'a' | 'b') => unwrap(apiAs('manager', company).GET('/api/v1/dashboard/summary'))

interface EventRow {
  id: string
  type: string
  status: string
  identified_on: string
  statement_id: string | null
  calculation: { expectedAmount?: number; actualAmount?: number; difference?: number; steps: string[] } | null
}

async function eventsOf(companyId: string): Promise<EventRow[]> {
  return check(
    await serviceRole()
      .from('monitoring_events')
      .select('id, type, status, identified_on, statement_id, calculation')
      .eq('company_id', companyId)
      .overrideTypes<EventRow[], { merge: false }>(),
    'Read the monitoring events',
  )
}

let portfolio: MonitoringPortfolio
let restoreLogger: (() => void) | undefined

beforeAll(async () => {
  const ctx = integration()
  const company = world().companies.a
  const property = company.properties.find((candidate) => candidate.code === 'DIP')
  if (!property) throw new Error('The world has no property DIP in company A')
  portfolio = await createMonitoringPortfolio(serviceRole(), {
    companyId: company.id,
    propertyId: property.id,
    verifierUserId: world().users.manager.id,
    runId: `${ctx.runId}rpt`,
  })
  restoreLogger = logWorkerToFile(path.join(TEST_OUTPUT_ROOT, 'integration', 'worker-reports-monitoring.log'))
  const env = loadWorkerEnv(
    workerEnvironment({ NODE_ENV: 'test', SUPABASE_URL: ctx.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: ctx.serviceRoleKey, REDIS_URL: ctx.redisUrl, QUEUE_PREFIX: ctx.queuePrefix }),
  )
  // The worker's real lease scan for the escalation tenant only (service role; no queue consumed).
  const leases = new LeaseMonitoringProcessor({} as ProcessorRuntime, new ServiceRoleClientFactory(env))
  await leases.scan({ companyId: portfolio.companyId, asOf: AS_OF }, { tenantId: portfolio.parties.escalation.tenantId })
})

afterAll(async () => {
  restoreLogger?.()
  if (portfolio) await removeMonitoringPortfolio(serviceRole(), portfolio)
})

describe('GET /api/v1/reports/lease_monitoring', () => {
  it('lists the open events, counted as the dashboard and the database count them, each with its age', async () => {
    for (const company of ['a', 'b'] as const) {
      const [report, dashboard, events] = await Promise.all([monitoringOf(company), dashboardOf(company), eventsOf(world().companies[company].id)])
      const open = events.filter((event) => (OPEN_EVENT_STATUSES as readonly string[]).includes(event.status))
      expect(report.reportId).toBe('lease_monitoring')
      expect(report.asOf).toBe(dashboard.asOf)
      expect(report.data.open, company).toBe(open.length)
      expect(report.data.events.map((row) => row.eventId).sort()).toEqual(open.map((event) => event.id).sort())
      expect(report.data.byType.rental_escalation_discrepancy, company).toBe(dashboard.escalationDiscrepancies)
      expect(report.data.byType.lease_expiry, company).toBe(dashboard.upcomingExpiries)
      expect(report.data.byType.renewal_notice_deadline, company).toBe(dashboard.renewalDeadlines)
      expect(report.data.byType.guarantee_expiry, company).toBe(dashboard.expiringGuarantees)
      // The breakdowns add up to the events listed.
      expect(report.data.byProperty.reduce((total, row) => total + row.total, 0)).toBe(report.data.total)
      expect(report.data.byAge.reduce((total, row) => total + row.count, 0)).toBe(report.data.total)
      for (const row of report.data.events) {
        const event = open.find((candidate) => candidate.id === row.eventId)
        expect(row.ageDays, row.title).toBe(Math.max(0, daysBetween(event?.identified_on ?? '', report.asOf)))
      }
    }
  })

  it('narrows to event statuses, properties and the identified date range, and refuses a status it does not offer', async () => {
    const property = world().companies.a.properties.find((candidate) => candidate.code === 'DIP')
    if (!property) throw new Error('no DIP')
    const atDip = await monitoringOf('a', 'manager', { propertyId: [property.id] })
    expect(atDip.filters).toEqual({ propertyIds: [property.id] })
    expect(atDip.data.events.every((row) => row.propertyId === property.id)).toBe(true)
    expect(atDip.data.events.some((row) => row.type === 'rental_escalation_discrepancy')).toBe(true)

    const resolved = await monitoringOf('a', 'manager', { status: ['resolved', 'dismissed'] })
    expect(resolved.data.events.every((row) => row.status === 'resolved' || row.status === 'dismissed')).toBe(true)

    const identified = await monitoringOf('a', 'manager', { from: AS_OF, to: AS_OF })
    expect(identified.data.events.every((row) => row.identifiedOn === AS_OF)).toBe(true)
    expect(identified.data.events.length).toBeGreaterThan(0)

    expect((await apiErrorOf(monitoringOf('a', 'manager', { status: ['vacant'] }))).status).toBe(400)
    expect((await apiErrorOf(monitoringOf('a', 'manager', { from: '2026-12-01', to: '2026-11-01' }))).status).toBe(400)
  })
})

describe('GET /api/v1/reports/rental_discrepancies', () => {
  it('compares the escalation lease as monitoring did: the PRD example, linked to the lease, statement and event', async () => {
    const party = portfolio.parties.escalation
    const [report, events] = await Promise.all([discrepanciesOf('a'), eventsOf(portfolio.companyId)])
    const event = events.find((candidate) => candidate.type === 'rental_escalation_discrepancy' && candidate.statement_id === party.statementId)
    expect(event, 'the lease scan raised the discrepancy').toBeDefined()
    const row = report.data.rows.find((candidate) => candidate.leaseId === party.leaseId)
    expect(row).toMatchObject({
      source: 'event',
      current: true,
      eventId: event?.id,
      eventStatus: 'new',
      leaseReference: party.leaseReference,
      tenantId: party.tenantId,
      statementId: party.statementId,
      expected: EXAMPLES.escalation.expectedRental,
      billed: EXAMPLES.escalation.billedRental,
      difference: EXAMPLES.escalation.difference,
      withinTolerance: false,
    })
    // The same figures and calculation the event recorded.
    expect(row?.expected).toBe(event?.calculation?.expectedAmount)
    expect(row?.billed).toBe(event?.calculation?.actualAmount)
    expect(row?.difference).toBe(event?.calculation?.difference)
    expect(row?.steps).toEqual(event?.calculation?.steps)
  })

  it('matches the dashboard and counts the leases it could not compare', async () => {
    for (const company of ['a', 'b'] as const) {
      const [report, dashboard] = await Promise.all([discrepanciesOf(company), dashboardOf(company)])
      expect(report.data.openEventCount, company).toBe(dashboard.escalationDiscrepancies)
      const outside = report.data.rows.filter((row) => !row.withinTolerance)
      expect(report.data.outsideToleranceCount).toBe(outside.length)
      expect(report.data.totalMonthlyDifference).toBeCloseTo(outside.reduce((total, row) => total + row.difference, 0), 2)
    }
    const a = world().companies.a
    const leases = check(
      await serviceRole().from('leases').select('id, status, verified').eq('company_id', a.id),
      'leases of A',
    ) as { id: string; status: string; verified: boolean }[]
    const report = await discrepanciesOf('a')
    expect(report.data.unverifiedLeasesExcluded).toBe(leases.filter((lease) => !lease.verified && ['draft', 'pending_verification'].includes(lease.status)).length)
    expect(report.data.leasesCompared + report.data.awaitingStatement).toBe(
      leases.filter((lease) => lease.verified && ['active', 'expiring'].includes(lease.status)).length,
    )
  })

  it('narrows to the comparison outcome and the billing period', async () => {
    const outside = await discrepanciesOf('a', 'manager', { status: ['outside_tolerance'] })
    expect(outside.filters).toEqual({ statuses: ['outside_tolerance'] })
    expect(outside.data.rows.length).toBeGreaterThan(0)
    expect(outside.data.rows.every((row) => !row.withinTolerance)).toBe(true)
    const later = await discrepanciesOf('a', 'manager', { from: '2099-01-01' })
    expect(later.data.rows).toEqual([])
    expect((await apiErrorOf(discrepanciesOf('a', 'manager', { status: ['resolved'] }))).status).toBe(400)
  })
})

describe('monitoring reports access', () => {
  it('is the same for every member role of the company, and never answers for another company', async () => {
    const manager = await discrepanciesOf('a')
    const monitoring = await monitoringOf('a')
    for (const user of ['admin', 'readOnly', 'owner'] as const) {
      expect((await discrepanciesOf('a', user)).data, user).toEqual(manager.data)
      expect((await monitoringOf('a', user)).data, user).toEqual(monitoring.data)
    }
    expect((await apiErrorOf(monitoringOf('b', 'admin'))).status).toBe(403)
    expect((await apiErrorOf(discrepanciesOf('b', 'readOnly'))).status).toBe(403)
    const b = await discrepanciesOf('b')
    const aLeases = new Set(world().companies.a.leases.map((lease) => lease.id))
    expect(b.data.rows.some((row) => aLeases.has(row.leaseId))).toBe(false)
    expect((await apiErrorOf(unwrap(gatewayAs(null, 'a').GET('/api/v1/reports/lease_monitoring')))).status).toBe(401)
  })
})
