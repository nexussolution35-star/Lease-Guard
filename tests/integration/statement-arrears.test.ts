import { createHash, randomUUID } from 'node:crypto'

import { unwrap } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { apiAs, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/** Statements and arrangements this file inserted (service role), removed in afterAll. */
const statementIds: string[] = []
const arrangementIds: string[] = []
let lease: WorldLease

const sha = (seed: string) => createHash('sha256').update(`${integration().runId}:${seed}`).digest('hex')

async function insertStatement(seed: string, fields: Record<string, unknown>, on: WorldLease = lease): Promise<string> {
  const company = world().companies.a
  const row = check(
    await serviceRole()
      .from('statements')
      .insert({
        company_id: company.id,
        property_id: on.propertyId,
        tenant_id: on.tenantId,
        unit_id: on.unitId,
        lease_id: on.id,
        file_name: `it-arrears-${seed}.pdf`,
        storage_path: `${company.id}/${randomUUID()}/it-arrears-${seed}.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 1024,
        file_sha256: sha(seed),
        source_system: 'MRI',
        uploaded_by_user_id: world().users.manager.id,
        ...fields,
      })
      .select('id')
      .single(),
    `Insert statement ${seed}`,
  ) as { id: string }
  statementIds.push(row.id)
  return row.id
}

const verifiedFigures = (closingBalance: number, statementDate: string) => ({
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

let olderId: string
let latestId: string
/** The same tenant's other lease (another unit), with its own statements. */
let otherLease: WorldLease
let otherLeaseId: string

beforeAll(async () => {
  const candidate = world().companies.a.leases.find((l) => l.status === 'active')
  if (!candidate) throw new Error('The world has no active lease in company A')
  lease = candidate
  olderId = await insertStatement('older', verifiedFigures(30_000, '2026-08-31'))
  latestId = await insertStatement('latest', verifiedFigures(12_345.67, '2026-09-30'))
  // A newer statement still in review: it never counts, however large.
  await insertStatement('review', { status: 'review_required', statement_date: '2026-10-31', closing_balance: null })
  const second = world().companies.a.leases.find((l) => l.tenantId === lease.tenantId && l.id !== lease.id)
  if (!second) throw new Error('The world has no second lease for the tenant of the active lease in company A')
  otherLease = second
  // The tenant's other lease: an older statement than the first lease's latest, still that lease's latest.
  otherLeaseId = await insertStatement('other-lease', verifiedFigures(4_000, '2026-08-31'), otherLease)
})

afterAll(async () => {
  const db = serviceRole()
  for (const id of arrangementIds) expectOk(await db.from('payment_arrangements').delete().eq('id', id), `Delete arrangement ${id}`)
  for (const id of statementIds) expectOk(await db.from('statements').delete().eq('id', id), `Delete statement ${id}`)
})

describe('GET /api/v1/statements/arrears', () => {
  it("counts only the latest verified statement of the tenant's lease, and the statements waiting for review", async () => {
    const summary = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/statements/arrears'))
    const entry = summary.entries.find((e) => e.leaseId === lease.id)
    expect(entry).toMatchObject({
      statementId: latestId,
      statementDate: '2026-09-30',
      outstanding: 12_345.67,
      propertyId: lease.propertyId,
      unitId: lease.unitId,
      underArrangement: false,
      verifiedByUserId: world().users.manager.id,
    })
    expect(summary.entries.some((e) => e.statementId === olderId)).toBe(false)
    expect(summary.pendingReview).toBeGreaterThanOrEqual(1)
    expect(summary.totalOutstanding).toBeCloseTo(summary.entries.reduce((sum, e) => sum + e.outstanding, 0), 2)
    expect(summary.buckets.map((b) => b.bucket)).toEqual(['current', '30', '60', '90', '120+'])
    const bucket = summary.buckets.find((b) => b.bucket === entry?.bucket)
    expect(bucket?.outstanding).toBeGreaterThanOrEqual(12_345.67)
  })

  it("counts the latest verified statement of each of the tenant's leases, and the tenant once", async () => {
    const summary = await unwrap(apiAs('manager', 'a').GET('/api/v1/statements/arrears'))
    const tenantEntries = summary.entries.filter((e) => e.tenantId === lease.tenantId)
    expect(tenantEntries.map((e) => [e.statementId, e.leaseId, e.unitId, e.outstanding])).toEqual([
      [latestId, lease.id, lease.unitId, 12_345.67],
      [otherLeaseId, otherLease.id, otherLease.unitId, 4_000],
    ])
    expect(summary.totalOutstanding).toBeGreaterThanOrEqual(16_345.67)
    expect(summary.tenantsInArrears).toBe(new Set(summary.entries.map((e) => e.tenantId)).size)
  })

  it('marks a tenant under an active payment arrangement', async () => {
    const company = world().companies.a
    const row = check(
      await serviceRole()
        .from('payment_arrangements')
        .insert({
          company_id: company.id,
          tenant_id: lease.tenantId,
          property_id: lease.propertyId,
          unit_id: lease.unitId,
          lease_id: lease.id,
          outstanding_balance: 12_345.67,
          installment_amount: 2_000,
          frequency: 'monthly',
          first_installment_date: '2026-11-01',
          final_installment_date: '2027-05-01',
          status: 'active',
          agreed_by_user_id: world().users.manager.id,
          agreed_on: '2026-10-15',
        })
        .select('id')
        .single(),
      'Insert payment arrangement',
    ) as { id: string }
    arrangementIds.push(row.id)

    const summary = await unwrap(apiAs('manager', 'a').GET('/api/v1/statements/arrears'))
    // Arrangements are per tenant: every lease of the tenant is marked.
    for (const entry of summary.entries.filter((e) => e.tenantId === lease.tenantId)) {
      expect(entry).toMatchObject({ underArrangement: true, remindersSuppressed: true })
    }
    expect(summary.tenantsUnderArrangement).toBeGreaterThanOrEqual(1)
  })

  it("never shows another company's balances", async () => {
    const summary = await unwrap(apiAs('manager', 'b').GET('/api/v1/statements/arrears'))
    expect(summary.entries.some((e) => statementIds.includes(e.statementId))).toBe(false)
  })
})
