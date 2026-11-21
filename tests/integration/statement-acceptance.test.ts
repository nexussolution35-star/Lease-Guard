import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import { unwrap, type ExtractionFieldName } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadWorkerEnv } from '../../backend/src/config/env.ts'
import { ServiceRoleClientFactory } from '../../backend/src/infrastructure/database/service-role-client.factory.ts'
import type { ProcessorRuntime } from '../../backend/src/workers/jobs/processor-runtime.ts'
import { ArrearsMonitoringProcessor } from '../../backend/src/workers/monitoring/arrears-monitoring.processor.ts'
import { LeaseMonitoringProcessor } from '../../backend/src/workers/monitoring/lease-monitoring.processor.ts'
import { StatementMonitoringProcessor } from '../../backend/src/workers/monitoring/statement-monitoring.processor.ts'
import { Clock } from '../../backend/src/workers/shared/clock.ts'
import { TEST_OUTPUT_ROOT } from '../fixtures/paths.ts'
import { SAGE_SAMPLE } from '../fixtures/sample-statements.ts'
import { createAcceptancePortfolio, ESCALATION_EXAMPLE, removeAcceptancePortfolio, type AcceptanceParty, type AcceptancePortfolio } from '../fixtures/statement-acceptance.ts'
import { apiAs, check, expectOk, integration, serviceRole, world } from './support/clients.ts'
import { logWorkerToFile, workerEnvironment } from './support/in-process-worker.ts'

/**
 * Statements acceptance (ticket S-09), the monitoring side of PRD §13.3 and §13.4: arrears and escalation events come
 * only from VERIFIED statements and each names the statement it came from. Statements are seeded as the
 * statement-processing worker leaves them (service role); the reviewer's work, rejection, marking as a duplicate and
 * verification go through the API; the worker's real monitoring processors (the daily arrears and lease scans and the
 * post-verification `statement-monitoring` job) run in this process against the local database with the service role.
 * No queue is consumed: the jobs the API enqueues stay in this run's prefix and are deleted at teardown.
 *
 * The browser journey (upload in two layouts, flag, correct, duplicate, verify, events) is
 * tests/e2e/statements-acceptance.spec.ts.
 */

const writer = () => apiAs('manager', 'a')

let portfolio: AcceptancePortfolio
let arrears: ArrearsMonitoringProcessor
let leases: LeaseMonitoringProcessor
let statementMonitoring: StatementMonitoringProcessor
let restoreLogger: (() => void) | undefined
const today = () => new Clock().today()

const ids = {
  verified: randomUUID(),
  underReview: randomUUID(),
  rejected: randomUUID(),
  copy: randomUUID(),
  uploaded: randomUUID(),
}
const unverifiedIds = () => [ids.underReview, ids.rejected, ids.copy, ids.uploaded]

/** What the extraction read, as the worker stores it (every value present and confident). */
const VALUES: Record<ExtractionFieldName, string | number> = {
  tenant_name: '',
  unit_number: '',
  statement_number: '',
  statement_date: SAGE_SAMPLE.statementDate,
  period_start: SAGE_SAMPLE.periodStart,
  period_end: SAGE_SAMPLE.periodEnd,
  opening_balance: SAGE_SAMPLE.openingBalance,
  rental_charged: SAGE_SAMPLE.rentalCharged,
  additional_charges: SAGE_SAMPLE.additionalCharges,
  payments_received: SAGE_SAMPLE.paymentsReceived,
  outstanding_balance: SAGE_SAMPLE.outstandingBalance,
  total_due: SAGE_SAMPLE.totalDue,
}

interface EventRow {
  id: string
  type: string
  statement_id: string | null
  tenant_id: string | null
  lease_id: string | null
  calculation: { expectedAmount?: number; actualAmount?: number; difference?: number; steps: string[] } | null
}

async function eventsFor(column: 'statement_id' | 'tenant_id', values: readonly string[]): Promise<EventRow[]> {
  return check(
    await serviceRole()
      .from('monitoring_events')
      .select('id, type, statement_id, tenant_id, lease_id, calculation')
      .eq('company_id', portfolio.companyId)
      .in(column, [...values])
      .overrideTypes<EventRow[], { merge: false }>(),
    'Read monitoring events',
  )
}

/** One statement row as the processing worker leaves it: matched or not, never with figures. */
async function seedStatement(id: string, party: AcceptanceParty, status: 'uploaded' | 'review_required', withExtraction: boolean): Promise<void> {
  const db = serviceRole()
  const name = `acceptance-${portfolio.marker}-${id.slice(0, 8)}.pdf`
  expectOk(
    await db.from('statements').insert({
      id,
      company_id: portfolio.companyId,
      property_id: portfolio.propertyId,
      file_name: name,
      storage_path: `${portfolio.companyId}/${id}/${name}`,
      mime_type: 'application/pdf',
      size_bytes: 2048,
      file_sha256: createHash('sha256').update(id).digest('hex'),
      source_system: 'Sage',
      status,
      uploaded_by_user_id: world().users.manager.id,
    }),
    `Insert statement ${id}`,
  )
  if (!withExtraction) return
  const extractionId = randomUUID()
  expectOk(
    await db.from('statement_extractions').insert({
      id: extractionId,
      company_id: portfolio.companyId,
      statement_id: id,
      engine: 'leaseguard-document-processing 0.1.0',
      overall_confidence: 0.95,
      matched_tenant_id: party.tenantId,
      matched_unit_id: party.unitId,
      match_confidence: 0.95,
    }),
    'Insert extraction',
  )
  const values: Record<ExtractionFieldName, string | number> = {
    ...VALUES,
    tenant_name: party.tradingName,
    unit_number: party.unitNumber,
    statement_number: `ACC-${portfolio.marker}-${id.slice(0, 4)}`,
  }
  expectOk(
    await db.from('statement_extraction_fields').insert(
      (Object.keys(values) as ExtractionFieldName[]).map((name) => ({
        company_id: portfolio.companyId,
        extraction_id: extractionId,
        name,
        raw_text: String(values[name]),
        value: values[name],
        confidence: 0.95,
        flagged: false,
      })),
    ),
    'Insert extraction fields',
  )
}

const statementPath = (statementId: string) => ({ params: { path: { statementId } } }) as const

beforeAll(async () => {
  const ctx = integration()
  const company = world().companies.a
  const property = company.properties.find((candidate) => candidate.code === 'DIP')
  if (!property) throw new Error('The world has no property DIP in company A')
  portfolio = await createAcceptancePortfolio(serviceRole(), {
    companyId: company.id,
    propertyId: property.id,
    verifierUserId: world().users.manager.id,
    runId: `${ctx.runId}it`,
  })

  restoreLogger = logWorkerToFile(path.join(TEST_OUTPUT_ROOT, 'integration', 'worker-statement-acceptance.log'))
  // The worker's processors, built as WorkersModule wires them, on the local stack only (service role). Their
  // `onModuleInit` is never called, so no queue is consumed and the runtime is never used.
  const env = loadWorkerEnv(
    workerEnvironment({ NODE_ENV: 'test', SUPABASE_URL: ctx.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: ctx.serviceRoleKey, REDIS_URL: ctx.redisUrl, QUEUE_PREFIX: ctx.queuePrefix }),
  )
  const clients = new ServiceRoleClientFactory(env)
  const unusedRuntime = {} as ProcessorRuntime
  arrears = new ArrearsMonitoringProcessor(unusedRuntime, clients)
  leases = new LeaseMonitoringProcessor(unusedRuntime, clients)
  statementMonitoring = new StatementMonitoringProcessor(unusedRuntime, clients, new Clock(), arrears, leases)

  // The escalating lease's tenant gets the statement that will be verified; the other tenant only unverified ones.
  await seedStatement(ids.verified, portfolio.escalating, 'review_required', true)
  await seedStatement(ids.underReview, portfolio.other, 'review_required', true)
  await seedStatement(ids.rejected, portfolio.other, 'review_required', true)
  await seedStatement(ids.copy, portfolio.other, 'review_required', true)
  await seedStatement(ids.uploaded, portfolio.other, 'uploaded', false)
  await unwrap(writer().POST('/api/v1/statements/{statementId}/reject', { ...statementPath(ids.rejected), body: { reason: 'Statement for another property' } }))
  await unwrap(writer().POST('/api/v1/statements/{statementId}/mark-duplicate', { ...statementPath(ids.copy), body: { duplicateOfStatementId: ids.underReview } }))
  // The other tenant's statement under review is matched: only verification is missing.
  await unwrap(writer().PUT('/api/v1/statements/{statementId}/match', { ...statementPath(ids.underReview), body: { tenantId: portfolio.other.tenantId, unitId: portfolio.other.unitId } }))
})

afterAll(async () => {
  restoreLogger?.()
  if (portfolio) await removeAcceptancePortfolio(serviceRole(), portfolio, Object.values(ids))
})

describe('statements acceptance: monitoring comes only from verified statements', () => {
  it('raises no arrears or escalation event from statements that are uploaded, under review, rejected or a duplicate', async () => {
    const statuses = check(
      await serviceRole().from('statements').select('id, status, closing_balance').in('id', unverifiedIds()),
      'Read unverified statements',
    ) as { id: string; status: string; closing_balance: number | null }[]
    expect(Object.fromEntries(statuses.map((row) => [row.id, row.status]))).toEqual({
      [ids.underReview]: 'review_required',
      [ids.rejected]: 'rejected',
      [ids.copy]: 'duplicate',
      [ids.uploaded]: 'uploaded',
    })
    // Figures reach a statement only by verification: none of these has a balance, whatever the extraction read.
    expect(statuses.every((row) => row.closing_balance === null)).toBe(true)

    // The daily scans (the tenant's records only, so no other test's rows are touched) and the post-verification job.
    const scanned = await arrears.scan({ companyId: portfolio.companyId, asOf: today() }, { tenantId: portfolio.other.tenantId })
    expect(scanned.findings).toBe(0)
    const leaseScan = await leases.scan({ companyId: portfolio.companyId, asOf: today() }, { tenantId: portfolio.other.tenantId })
    expect(leaseScan.findings).toBe(0)
    for (const statementId of unverifiedIds()) {
      await expect(statementMonitoring.run({ companyId: portfolio.companyId, statementId })).resolves.toEqual({ skipped: 'not_verified' })
    }

    const raised = [...(await eventsFor('statement_id', unverifiedIds())), ...(await eventsFor('tenant_id', [portfolio.other.tenantId]))]
    expect(raised.filter((event) => event.type === 'arrears' || event.type === 'rental_escalation_discrepancy')).toEqual([])
  })

  it('a verified statement raises arrears and the escalation discrepancy, each tracing back to that statement', async () => {
    const before = await eventsFor('statement_id', [ids.verified])
    expect(before.filter((event) => event.type === 'arrears' || event.type === 'rental_escalation_discrepancy')).toEqual([])

    await unwrap(writer().PUT('/api/v1/statements/{statementId}/match', { ...statementPath(ids.verified), body: { tenantId: portfolio.escalating.tenantId, unitId: portfolio.escalating.unitId } }))
    const result = await unwrap(writer().POST('/api/v1/statements/{statementId}/verify', statementPath(ids.verified)))
    expect(result.monitoringQueued).toBe(true)
    expect(result.statement).toMatchObject({ status: 'verified', leaseId: portfolio.escalating.leaseId, closingBalance: SAGE_SAMPLE.outstandingBalance })

    // What the queued statement-monitoring job does when the worker takes it.
    const run = await statementMonitoring.run({ companyId: portfolio.companyId, statementId: ids.verified })
    expect(run).toMatchObject({ tenantId: portfolio.escalating.tenantId, asOf: today() })

    const events = await eventsFor('statement_id', [ids.verified])
    const arrearsEvent = events.find((event) => event.type === 'arrears')
    expect(arrearsEvent).toMatchObject({ tenant_id: portfolio.escalating.tenantId, lease_id: portfolio.escalating.leaseId })
    expect(arrearsEvent?.calculation?.actualAmount).toBe(SAGE_SAMPLE.outstandingBalance)
    const escalation = events.find((event) => event.type === 'rental_escalation_discrepancy')
    expect(escalation).toMatchObject({ tenant_id: portfolio.escalating.tenantId, lease_id: portfolio.escalating.leaseId })
    expect(escalation?.calculation).toMatchObject({ expectedAmount: ESCALATION_EXAMPLE.expectedRental, difference: ESCALATION_EXAMPLE.difference })

    // Running again (the daily scan, or a retried job) raises nothing new.
    const again = await statementMonitoring.run({ companyId: portfolio.companyId, statementId: ids.verified })
    expect(again).toMatchObject({ arrears: { created: 0 }, leases: { created: 0 } })

    // The other tenant still has nothing: their statements are not verified.
    const other = await eventsFor('tenant_id', [portfolio.other.tenantId])
    expect(other.filter((event) => event.type === 'arrears' || event.type === 'rental_escalation_discrepancy')).toEqual([])
  })
})
