import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import { unwrap } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadWorkerEnv } from '../../backend/src/config/env.ts'
import { ServiceRoleClientFactory } from '../../backend/src/infrastructure/database/service-role-client.factory.ts'
import type { ProcessorRuntime } from '../../backend/src/workers/jobs/processor-runtime.ts'
import { ArrangementRemindersProcessor } from '../../backend/src/workers/monitoring/arrangement-reminders.processor.ts'
import { ArrearsMonitoringProcessor } from '../../backend/src/workers/monitoring/arrears-monitoring.processor.ts'
import { Clock } from '../../backend/src/workers/shared/clock.ts'
import type { WorldLease } from '../fixtures/world.ts'
import { TEST_OUTPUT_ROOT } from '../fixtures/paths.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'
import { logWorkerToFile, workerEnvironment } from './support/in-process-worker.ts'

/**
 * Payment arrangements through the API on the local stack (ticket M7-03): recorded, edited, an instalment outcome
 * confirmed, closed; one active per tenant; every change audited; while active the tenant's arrears are under the
 * arrangement and normal arrears reminders are suppressed; a verified statement whose payments do not cover an
 * instalment raises an arrangement_attention event naming that statement. No payment is ever collected, and no tenant
 * message is created.
 */

const writer = () => apiAs('manager', 'a')
const today = () => new Clock().today()

let lease: WorldLease
let statementId: string
let arrangementId: string | undefined
let reminders: ArrangementRemindersProcessor
let arrears: ArrearsMonitoringProcessor
let restoreLogger: (() => void) | undefined
/** Events raised by this file's scans are the tenant's events created from here on. */
const startedAt = new Date().toISOString()

beforeAll(async () => {
  const company = world().companies.a
  const candidate = company.leases.find((l) => l.reference.startsWith('BOT-') && l.status === 'active')
  if (!candidate) throw new Error('The world has no active BOT lease in company A')
  lease = candidate

  // October: R12 000 rental charged and R12 000 received, so the R2 000 instalment due on 15 Oct was not covered.
  const row = check(
    await serviceRole()
      .from('statements')
      .insert({
        company_id: company.id,
        property_id: lease.propertyId,
        tenant_id: lease.tenantId,
        unit_id: lease.unitId,
        lease_id: lease.id,
        file_name: 'it-arrangement-oct.pdf',
        storage_path: `${company.id}/${randomUUID()}/it-arrangement-oct.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 1024,
        file_sha256: createHash('sha256').update(`${integration().runId}:arrangement`).digest('hex'),
        source_system: 'MRI',
        uploaded_by_user_id: world().users.manager.id,
        status: 'verified',
        statement_date: '2026-10-31',
        period_start: '2026-10-01',
        period_end: '2026-10-31',
        opening_balance: 6_000,
        rental_charged: 12_000,
        additional_charges: 0,
        payments_received: 12_000,
        closing_balance: 6_000,
        total_due: 6_000,
        verified_by_user_id: world().users.manager.id,
        verified_at: new Date().toISOString(),
      })
      .select('id')
      .single(),
    'Insert verified statement',
  ) as { id: string }
  statementId = row.id

  const ctx = integration()
  restoreLogger = logWorkerToFile(path.join(TEST_OUTPUT_ROOT, 'integration', 'worker-arrangement-writes.log'))
  const env = loadWorkerEnv(
    workerEnvironment({ NODE_ENV: 'test', SUPABASE_URL: ctx.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: ctx.serviceRoleKey, REDIS_URL: ctx.redisUrl, QUEUE_PREFIX: ctx.queuePrefix }),
  )
  const clients = new ServiceRoleClientFactory(env)
  const unusedRuntime = {} as ProcessorRuntime
  reminders = new ArrangementRemindersProcessor(unusedRuntime, clients)
  arrears = new ArrearsMonitoringProcessor(unusedRuntime, clients)
})

afterAll(async () => {
  restoreLogger?.()
  const db = serviceRole()
  const companyId = world().companies.a.id
  // Everything the scans raised for this tenant: events, and the notifications linking to them or the arrangement.
  const events = check(
    await db.from('monitoring_events').select('id').eq('company_id', companyId).eq('tenant_id', lease.tenantId).gte('created_at', startedAt),
    'Read raised events',
  ) as { id: string }[]
  const linked = [...events.map((e) => e.id), ...(arrangementId ? [arrangementId] : [])]
  if (linked.length) expectOk(await db.from('notifications').delete().eq('company_id', companyId).in('link_entity_id', linked), 'Delete notifications')
  if (events.length) expectOk(await db.from('monitoring_events').delete().in('id', events.map((e) => e.id)), 'Delete events')
  expectOk(await db.from('payment_arrangements').delete().eq('company_id', companyId).eq('tenant_id', lease.tenantId), 'Delete arrangements')
  expectOk(await db.from('statements').delete().eq('id', statementId), 'Delete statement')
})

const terms = () => ({
  tenantId: lease.tenantId,
  propertyId: lease.propertyId,
  outstandingBalance: 6_000,
  installmentAmount: 2_000,
  frequency: 'monthly' as const,
  firstInstallmentDate: '2026-10-15',
  agreedOn: '2026-10-10',
  notes: 'Agreed at the centre office',
})

const auditOf = async (id: string) =>
  check(
    await serviceRole().from('audit_logs').select('action, summary, actor_user_id').eq('entity_type', 'payment_arrangement').eq('entity_id', id).order('occurred_at'),
    'Read arrangement audit',
  ) as { action: string; summary: string; actor_user_id: string | null }[]

describe('payment arrangements (M7-03)', () => {
  it('refuses members who cannot write', async () => {
    expect((await apiErrorOf(unwrap(apiAs('readOnly', 'a').POST('/api/v1/arrangements', { body: terms() })))).status).toBe(403)
    expect((await apiErrorOf(unwrap(apiAs('owner', 'a').POST('/api/v1/arrangements', { body: terms() })))).status).toBe(403)
  })

  it('records an arrangement, takes the lease in force and generates the schedule; audited', async () => {
    const created = await unwrap(writer().POST('/api/v1/arrangements', { body: terms() }))
    arrangementId = created.id
    expect(created).toMatchObject({
      leaseId: lease.id,
      unitId: lease.unitId,
      status: 'active',
      finalInstallmentDate: '2026-12-15',
      suppressArrearsReminders: true,
      agreedByUserId: world().users.manager.id,
    })
    expect(created.installments.map((i) => [i.sequence, i.dueDate, i.amount, i.status])).toEqual([
      [1, '2026-10-15', 2_000, 'scheduled'],
      [2, '2026-11-15', 2_000, 'scheduled'],
      [3, '2026-12-15', 2_000, 'scheduled'],
    ])
    expect(await auditOf(created.id)).toEqual([expect.objectContaining({ action: 'create', actor_user_id: world().users.manager.id })])
  })

  it('names the tenant, property, unit and lease of each arrangement it returns (ticket M7-04)', async () => {
    const tenant = check(await serviceRole().from('tenants').select('trading_name').eq('id', lease.tenantId).single(), 'Read tenant') as { trading_name: string }
    const property = check(await serviceRole().from('properties').select('name').eq('id', lease.propertyId).single(), 'Read property') as { name: string }
    const unit = world().companies.a.units.find((u) => u.id === lease.unitId)!
    const names = { tenantName: tenant.trading_name, propertyName: property.name, unitNumber: unit.unitNumber, leaseReference: lease.reference }

    const detail = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/arrangements/{arrangementId}', { params: { path: { arrangementId: arrangementId! } } }))
    expect(detail).toMatchObject(names)
    const listed = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/arrangements', { params: { query: { tenantId: lease.tenantId } } }))
    expect(listed.items.find((a) => a.id === arrangementId)).toMatchObject(names)
  })

  it('allows one active arrangement per tenant and words the terms that do not fit', async () => {
    const second = await apiErrorOf(unwrap(writer().POST('/api/v1/arrangements', { body: terms() })))
    expect(second.status).toBe(409)
    expect(second.message).toContain('already has an active payment arrangement')
    const tooLarge = await apiErrorOf(unwrap(writer().POST('/api/v1/arrangements', { body: { ...terms(), installmentAmount: 9_000 } })))
    expect(tooLarge.status).toBe(422)
    expect(tooLarge.message).toContain('The instalment amount cannot be more than the outstanding balance.')
  })

  it("puts the tenant's arrears under the arrangement and suppresses normal arrears reminders", async () => {
    const summary = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/statements/arrears'))
    expect(summary.entries.find((e) => e.leaseId === lease.id)).toMatchObject({ statementId, underArrangement: true })
    const scanned = await arrears.scan({ companyId: world().companies.a.id, asOf: today() }, { tenantId: lease.tenantId })
    expect(scanned.suppressed).toBe(1)
    const events = check(
      await serviceRole().from('monitoring_events').select('id').eq('statement_id', statementId).eq('type', 'arrears'),
      'Read arrears events',
    ) as unknown[]
    expect(events).toEqual([])
  })

  it('flags the instalment the verified statement shows was not covered, naming the statement; no tenant message', async () => {
    const id = arrangementId as string
    const messages = async () =>
      (check(await serviceRole().from('communications').select('id').eq('tenant_id', lease.tenantId), 'Read messages') as unknown[]).length
    const before = await messages()
    await reminders.scan({ companyId: world().companies.a.id, asOf: today() })
    const instalment = (await unwrap(writer().GET('/api/v1/arrangements/{arrangementId}', { params: { path: { arrangementId: id } } }))).installments[0]
    const flagged = check(
      await serviceRole()
        .from('monitoring_events')
        .select('type, statement_id, lease_id, calculation, due_date')
        .eq('arrangement_id', id)
        .eq('dedupe_key', `arrangement_attention:statement:${instalment?.id}`),
      'Read statement flag',
    ) as { type: string; statement_id: string; calculation: { expectedAmount: number; actualAmount: number; difference: number } }[]
    expect(flagged).toEqual([
      expect.objectContaining({
        type: 'arrangement_attention',
        statement_id: statementId,
        lease_id: lease.id,
        due_date: '2026-10-15',
        calculation: expect.objectContaining({ expectedAmount: 14_000, actualAmount: 12_000, difference: 2_000 }),
      }),
    ])
    expect(await messages()).toBe(before)
  })

  it("lists the arrangement's findings filtered by arrangement on the server, not every finding on its lease", async () => {
    const id = arrangementId as string
    // A finding on the same lease that is not about this arrangement (removed with the tenant's events in afterAll).
    expectOk(
      await serviceRole().from('monitoring_events').insert({
        company_id: world().companies.a.id,
        type: 'arrangement_attention',
        property_id: lease.propertyId,
        unit_id: lease.unitId,
        tenant_id: lease.tenantId,
        lease_id: lease.id,
        lease_reference: lease.reference,
        title: `Integration ${integration().runId}: another arrangement's finding`,
        description: 'Not about the arrangement under test.',
        identified_on: today(),
        priority: 'medium',
        recommended_action: 'Check the other arrangement.',
      }),
      'Insert a finding of the lease without the arrangement',
    )
    const list = (query: { arrangementId?: string; leaseId?: string }) =>
      unwrap(apiAs('readOnly', 'a').GET('/api/v1/monitoring/events', { params: { query: { type: 'arrangement_attention', pageSize: 100, ...query } } }))

    const byArrangement = await list({ arrangementId: id })
    expect(byArrangement.items.length).toBeGreaterThan(0)
    expect(byArrangement.items.every((event) => event.arrangementId === id)).toBe(true)
    expect(byArrangement.total).toBe(byArrangement.items.length)
    const byLease = await list({ leaseId: lease.id })
    expect(byLease.total).toBeGreaterThan(byArrangement.total)
    expect((await apiErrorOf(list({ arrangementId: 'ARR-1' }))).status).toBe(400)
  })

  it('records the manager confirming a missed instalment, then fixes the schedule; audited', async () => {
    const id = arrangementId as string
    const current = await unwrap(writer().GET('/api/v1/arrangements/{arrangementId}', { params: { path: { arrangementId: id } } }))
    const first = current.installments[0]
    if (!first) throw new Error('No instalment')
    const recorded = await unwrap(
      writer().POST('/api/v1/arrangements/{arrangementId}/installments/{installmentId}/outcome', {
        params: { path: { arrangementId: id, installmentId: first.id } },
        body: { outcome: 'missed', note: 'Tenant confirmed by phone' },
      }),
    )
    expect(recorded.installments[0]).toMatchObject({ status: 'missed', outcomeRecordedByUserId: world().users.manager.id, notes: 'Tenant confirmed by phone' })

    const fixed = await apiErrorOf(unwrap(writer().PATCH('/api/v1/arrangements/{arrangementId}', { params: { path: { arrangementId: id } }, body: { installmentAmount: 1_500 } })))
    expect(fixed.status).toBe(409)
    const noted = await unwrap(writer().PATCH('/api/v1/arrangements/{arrangementId}', { params: { path: { arrangementId: id } }, body: { notes: 'Second call booked' } }))
    expect(noted.notes).toBe('Second call booked')
    expect((await auditOf(id)).map((a) => a.summary)).toEqual(
      expect.arrayContaining(['Instalment 1 of 3 (due 15 Oct 2026) recorded as missed', expect.stringMatching(/ updated$/)]),
    )
  })

  it('closes the arrangement; it is then read-only and normal arrears monitoring resumes', async () => {
    const id = arrangementId as string
    expect((await apiErrorOf(unwrap(writer().POST('/api/v1/arrangements/{arrangementId}/cancel', { params: { path: { arrangementId: id } }, body: { reason: ' ' } })))).status).toBe(400)
    const closed = await unwrap(
      writer().POST('/api/v1/arrangements/{arrangementId}/close', { params: { path: { arrangementId: id } }, body: { outcome: 'defaulted', reason: 'Stopped paying' } }),
    )
    expect(closed).toMatchObject({ status: 'defaulted', closedOn: today(), closedByUserId: world().users.manager.id, closeReason: 'Stopped paying' })
    const again = await apiErrorOf(unwrap(writer().PATCH('/api/v1/arrangements/{arrangementId}', { params: { path: { arrangementId: id } }, body: { notes: 'late' } })))
    expect(again.status).toBe(409)
    expect(again.message).toBe('This arrangement is defaulted and can no longer change.')

    const summary = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/statements/arrears'))
    expect(summary.entries.find((e) => e.leaseId === lease.id)?.underArrangement).toBe(false)
    const scanned = await arrears.scan({ companyId: world().companies.a.id, asOf: today() }, { tenantId: lease.tenantId })
    expect(scanned.suppressed).toBe(0)
  })
})
