import { createHash, randomUUID } from 'node:crypto'

import { unwrap } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, check, expectOk, gatewayAs, integration, serviceRole, world } from './support/clients.ts'

/**
 * Arrears and payment arrangements (ticket R-05) on the local stack, through the gateway like the web app: the reports
 * service computes them from the reporting functions under the caller's RLS, and every figure equals the Statements
 * page's and the dashboard's (the core API) for the same data, for every member role, never across companies. Nothing
 * here takes a payment: arrangements are records.
 */

const statementIds: string[] = []
const arrangementIds: string[] = []
let lease: WorldLease
let other: WorldLease
let statementId: string
let activeId: string
let cancelledId: string

const arrearsOf = (company: 'a' | 'b', user: 'admin' | 'manager' | 'readOnly' | 'owner' = 'manager', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/arrears', { params: { query } }))
const arrangementsOf = (company: 'a' | 'b', user: 'admin' | 'manager' | 'readOnly' | 'owner' = 'manager', query = {}) =>
  unwrap(gatewayAs(user, company).GET('/api/v1/reports/payment_arrangements', { params: { query } }))

async function insertVerifiedStatement(on: WorldLease, closingBalance: number, statementDate: string): Promise<string> {
  const company = world().companies.a
  const seed = `reports-arrears-${on.id}-${statementDate}`
  const row = check(
    await serviceRole()
      .from('statements')
      .insert({
        company_id: company.id,
        property_id: on.propertyId,
        tenant_id: on.tenantId,
        unit_id: on.unitId,
        lease_id: on.id,
        file_name: `it-${seed}.pdf`,
        storage_path: `${company.id}/${randomUUID()}/it-${seed}.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 1024,
        file_sha256: createHash('sha256').update(`${integration().runId}:${seed}`).digest('hex'),
        source_system: 'MRI',
        uploaded_by_user_id: world().users.manager.id,
        status: 'verified',
        statement_date: statementDate,
        period_start: `${statementDate.slice(0, 8)}01`,
        period_end: statementDate,
        opening_balance: 0,
        rental_charged: closingBalance,
        additional_charges: 0,
        payments_received: 0,
        closing_balance: closingBalance,
        total_due: closingBalance,
        verified_by_user_id: world().users.manager.id,
        verified_at: new Date().toISOString(),
      })
      .select('id')
      .single(),
    `Insert statement ${seed}`,
  ) as { id: string }
  statementIds.push(row.id)
  return row.id
}

async function insertArrangement(on: WorldLease, fields: Record<string, unknown>): Promise<string> {
  const row = check(
    await serviceRole()
      .from('payment_arrangements')
      .insert({
        company_id: world().companies.a.id,
        tenant_id: on.tenantId,
        property_id: on.propertyId,
        unit_id: on.unitId,
        lease_id: on.id,
        outstanding_balance: 8_000,
        installment_amount: 2_000,
        frequency: 'monthly',
        first_installment_date: '2026-09-15',
        final_installment_date: '2026-12-15',
        agreed_by_user_id: world().users.manager.id,
        ...fields,
      })
      .select('id')
      .single(),
    'Insert payment arrangement',
  ) as { id: string }
  arrangementIds.push(row.id)
  return row.id
}

beforeAll(async () => {
  const company = world().companies.a
  const acp = company.leases.find((l) => l.reference === 'ACP-002')
  const bot = company.leases.find((l) => l.reference === 'BOT-001')
  if (!acp || !bot) throw new Error('The world has no ACP-002 or BOT-001 lease in company A')
  lease = acp
  other = bot
  statementId = await insertVerifiedStatement(lease, 7_500, '2026-08-31')
  await insertVerifiedStatement(other, 1_250.5, '2026-11-15')

  activeId = await insertArrangement(lease, { status: 'active', agreed_on: '2026-09-01' })
  const manager = world().users.manager.id
  expectOk(
    await serviceRole()
      .from('arrangement_installments')
      .insert([
        // A bulk insert sends every column of every row, so each row names them all.
        { company_id: company.id, arrangement_id: activeId, sequence: 1, due_date: '2026-09-15', amount: 2_000, status: 'confirmed_paid', confirmed_by_user_id: manager, confirmed_on: '2026-09-15' },
        { company_id: company.id, arrangement_id: activeId, sequence: 2, due_date: '2026-10-15', amount: 2_000, status: 'missed', confirmed_by_user_id: null, confirmed_on: null },
        { company_id: company.id, arrangement_id: activeId, sequence: 3, due_date: '2026-11-15', amount: 2_000, status: 'scheduled', confirmed_by_user_id: null, confirmed_on: null },
        { company_id: company.id, arrangement_id: activeId, sequence: 4, due_date: '2026-12-15', amount: 2_000, status: 'scheduled', confirmed_by_user_id: null, confirmed_on: null },
      ]),
    'Insert instalments',
  )
  cancelledId = await insertArrangement(other, {
    status: 'cancelled',
    agreed_on: '2026-07-01',
    closed_on: '2026-07-20',
    closed_by_user_id: manager,
    close_reason: 'Tenant settled the balance',
  })
})

afterAll(async () => {
  const db = serviceRole()
  for (const id of arrangementIds) expectOk(await db.from('payment_arrangements').delete().eq('id', id), `Delete arrangement ${id}`)
  for (const id of statementIds) expectOk(await db.from('statements').delete().eq('id', id), `Delete statement ${id}`)
})

describe('GET /api/v1/reports/arrears', () => {
  it('matches the Statements page and the dashboard for the same data, in both companies', async () => {
    for (const company of ['a', 'b'] as const) {
      const [report, summary, dashboard] = await Promise.all([
        arrearsOf(company),
        unwrap(apiAs('manager', company).GET('/api/v1/statements/arrears')),
        unwrap(apiAs('manager', company).GET('/api/v1/dashboard/summary')),
      ])
      expect(report.asOf, company).toBe(summary.asOf)
      expect(report.data.totalOutstanding, company).toBe(dashboard.totalOutstanding)
      expect(report.data.tenantCount, company).toBe(dashboard.tenantsInArrears)
      expect(report.data.totalOutstanding, company).toBe(summary.totalOutstanding)
      expect(report.data.tenantsUnderArrangement, company).toBe(summary.tenantsUnderArrangement)
      expect(report.data.ageingBuckets, company).toEqual(summary.ageingBuckets)
      expect(report.data.buckets.map((b) => [b.bucket, b.amount, b.tenantCount]), company).toEqual(
        summary.buckets.map((b) => [b.bucket, b.outstanding, b.tenantCount]),
      )
      const key = (e: { statementId: string; bucket: string; underArrangement: boolean; remindersSuppressed: boolean; outstanding: number }) =>
        `${e.statementId}:${e.bucket}:${e.underArrangement}:${e.remindersSuppressed}:${e.outstanding}`
      expect(report.data.rows.map(key).sort(), company).toEqual(summary.entries.map(key).sort())
    }
  })

  it('shows the account per tenant and unit, aged, under its active arrangement, linking to its records', async () => {
    const report = await arrearsOf('a')
    const row = report.data.rows.find((r) => r.statementId === statementId)
    expect(row).toMatchObject({
      tenantId: lease.tenantId,
      propertyId: lease.propertyId,
      unitId: lease.unitId,
      leaseId: lease.id,
      leaseReference: 'ACP-002',
      statementDate: '2026-08-31',
      outstanding: 7_500,
      underArrangement: true,
      remindersSuppressed: true,
      arrangementId: activeId,
    })
    expect(row?.unitNumber).toBeTruthy()
    expect(row?.tenantName).toBeTruthy()
    // The cancelled arrangement is no longer in force.
    expect(report.data.rows.find((r) => r.leaseId === other.id)).toMatchObject({ outstanding: 1_250.5, underArrangement: false })
  })

  it('splits into tenants under an arrangement and the others, the two adding up to the total', async () => {
    const [all, under, none] = await Promise.all([
      arrearsOf('a'),
      arrearsOf('a', 'manager', { status: ['under_arrangement'] }),
      arrearsOf('a', 'manager', { status: ['no_arrangement'] }),
    ])
    expect(under.filters).toEqual({ statuses: ['under_arrangement'] })
    expect(under.data.rows.every((r) => r.underArrangement)).toBe(true)
    expect(none.data.rows.every((r) => !r.underArrangement)).toBe(true)
    expect(under.data.totalOutstanding + none.data.totalOutstanding).toBeCloseTo(all.data.totalOutstanding, 2)
    expect(under.data.totalOutstanding).toBeCloseTo(all.data.outstandingUnderArrangement, 2)

    const property = await arrearsOf('a', 'manager', { propertyId: [lease.propertyId] })
    expect(property.data.rows.every((r) => r.propertyId === lease.propertyId)).toBe(true)
    expect((await apiErrorOf(arrearsOf('a', 'manager', { status: ['active'] }))).status).toBe(400)
  })
})

describe('GET /api/v1/reports/payment_arrangements', () => {
  it('lists active and cancelled arrangements with schedule progress and missed instalments', async () => {
    const report = await arrangementsOf('a')
    const active = report.data.rows.find((r) => r.arrangementId === activeId)
    expect(active).toMatchObject({
      tenantId: lease.tenantId,
      leaseReference: 'ACP-002',
      status: 'active',
      outstandingBalance: 8_000,
      paid: 2_000,
      remaining: 6_000,
      paidCount: 1,
      totalCount: 4,
      missedCount: 1,
    })
    const cancelled = report.data.rows.find((r) => r.arrangementId === cancelledId)
    expect(cancelled).toMatchObject({ status: 'cancelled', closedOn: '2026-07-20', overdueCount: 0, totalCount: 0 })
    expect(cancelled?.nextDueDate).toBeUndefined()

    const total = Object.values(report.data.countsByStatus).reduce((sum, n) => sum + n, 0)
    expect(total).toBe(report.data.rows.length)
    expect(report.data.missedInstallments).toBe(report.data.rows.reduce((sum, r) => sum + r.missedCount, 0))

    // The grace days come from the company's arrangement monitoring rule (none: 0).
    const rule = check(
      await serviceRole().from('monitoring_rules').select('config').eq('company_id', world().companies.a.id).eq('event_type', 'arrangement_attention'),
      'Read arrangement rule',
    ) as { config: { graceDays?: number } }[]
    expect(report.data.graceDays).toBe(rule[0]?.config.graceDays ?? 0)
  })

  it('lists the same arrangements as the Arrangements page', async () => {
    const [report, page] = await Promise.all([
      arrangementsOf('a'),
      unwrap(apiAs('manager', 'a').GET('/api/v1/arrangements', { params: { query: { tenantId: lease.tenantId } } })),
    ])
    const ofTenant = report.data.rows.filter((r) => r.tenantId === lease.tenantId).map((r) => r.arrangementId).sort()
    expect(ofTenant).toEqual(page.items.map((item) => item.id).sort())
  })

  it('narrows to arrangement statuses and the date agreed', async () => {
    const cancelled = await arrangementsOf('a', 'manager', { status: ['cancelled'] })
    expect(cancelled.data.rows.every((r) => r.status === 'cancelled')).toBe(true)
    expect(cancelled.data.rows.some((r) => r.arrangementId === cancelledId)).toBe(true)

    const since = await arrangementsOf('a', 'manager', { from: '2026-08-01', to: '2026-09-30' })
    expect(since.filters).toEqual({ from: '2026-08-01', to: '2026-09-30' })
    expect(since.data.rows.some((r) => r.arrangementId === activeId)).toBe(true)
    expect(since.data.rows.some((r) => r.arrangementId === cancelledId)).toBe(false)
  })
})

describe('arrears reports access', () => {
  it('is the same for every member role and never answers for another company', async () => {
    const manager = await arrearsOf('a')
    for (const user of ['admin', 'readOnly', 'owner'] as const) {
      expect((await arrearsOf('a', user)).data, user).toEqual(manager.data)
    }
    expect((await apiErrorOf(arrearsOf('b', 'admin'))).status).toBe(403)
    expect((await apiErrorOf(arrangementsOf('b', 'readOnly'))).status).toBe(403)
    const b = await arrangementsOf('b')
    expect(b.data.rows.some((r) => arrangementIds.includes(r.arrangementId))).toBe(false)
    expect((await apiErrorOf(unwrap(gatewayAs(null, 'a').GET('/api/v1/reports/arrears')))).status).toBe(401)
  })
})
