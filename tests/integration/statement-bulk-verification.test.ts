import { randomUUID } from 'node:crypto'

import { unwrap, type ExtractionFieldName } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Verifying several statements together from the list (ticket S-07) through the API and the local database: the list
 * marks only statements with nothing unresolved as ready; verifying a batch verifies and audits each statement on its
 * own, a refusal does not undo the others, and the result names every statement not verified with why. Statements are
 * seeded as review left them (service role), so no worker runs here.
 */

const writer = () => apiAs('manager', 'a')
const reader = () => apiAs('readOnly', 'a')

let lease: WorldLease
const ids = {
  first: randomUUID(),
  second: randomUUID(),
  flagged: randomUUID(),
  otherCompany: randomUUID(),
}
const batchId = `it-bulk-${randomUUID()}`

const VALUES: Record<ExtractionFieldName, string | number> = {
  tenant_name: 'Integration Trading',
  unit_number: 'Shop 1',
  statement_number: 'IT-BULK',
  statement_date: '2026-10-31',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  opening_balance: 0,
  rental_charged: 21600,
  additional_charges: 1200,
  payments_received: 0,
  outstanding_balance: 22800,
  total_due: 22800,
}

beforeAll(async () => {
  const first = world().companies.a.leases.find((candidate) => candidate.status === 'active')
  if (!first) throw new Error('The world has no active lease in company A')
  lease = first
  const company = world().companies.a.id
  const { runId } = integration()
  const db = serviceRole()
  const sha = (seed: string) => `${seed}${runId}`.padEnd(64, '0').replace(/[^0-9a-f]/g, 'b').slice(0, 64)
  const statement = (id: string, name: string, seed: string) => ({
    id,
    company_id: company,
    property_id: lease.propertyId,
    tenant_id: lease.tenantId,
    unit_id: lease.unitId,
    lease_id: lease.id,
    file_name: `it-bulk-${name}-${runId}.pdf`,
    storage_path: `${company}/${id}/it-bulk-${name}-${runId}.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 1024,
    file_sha256: sha(seed),
    source_system: 'MRI',
    status: 'review_required',
    upload_batch_id: batchId,
    uploaded_by_user_id: world().users.manager.id,
  })
  expectOk(
    await db.from('statements').insert([statement(ids.first, 'first', 'd1'), statement(ids.second, 'second', 'd2'), statement(ids.flagged, 'flagged', 'd3')]),
    'Insert statements',
  )
  for (const [statementId, flagged] of [
    [ids.first, false],
    [ids.second, false],
    [ids.flagged, true],
  ] as const) {
    const extractionId = randomUUID()
    expectOk(
      await db.from('statement_extractions').insert({
        id: extractionId,
        company_id: company,
        statement_id: statementId,
        engine: 'leaseguard-pdf 0.1.0',
        overall_confidence: 0.9,
        matched_tenant_id: lease.tenantId,
        matched_unit_id: lease.unitId,
        match_confidence: 0.95,
      }),
      'Insert extraction',
    )
    expectOk(
      await db.from('statement_extraction_fields').insert(
        (Object.keys(VALUES) as ExtractionFieldName[]).map((name) => ({
          company_id: company,
          extraction_id: extractionId,
          name,
          raw_text: String(VALUES[name]),
          value: VALUES[name],
          confidence: flagged && name === 'total_due' ? 0.5 : 0.97,
          flagged: flagged && name === 'total_due',
        })),
      ),
      'Insert fields',
    )
  }
})

afterAll(async () => {
  const db = serviceRole()
  const all = [ids.first, ids.second, ids.flagged]
  expectOk(await db.from('monitoring_events').delete().in('statement_id', all), 'Delete raised events')
  expectOk(await db.from('statements').delete().in('id', all), 'Delete statements')
})

describe('verifying statements together', () => {
  it('marks only statements with nothing unresolved as ready to verify', async () => {
    const page = await unwrap(writer().GET('/api/v1/statements', { params: { query: { uploadBatchId: batchId, pageSize: 100 } } }))
    const ready = Object.fromEntries(page.items.map((item) => [item.id, item.readyToVerify]))
    expect(ready).toEqual({ [ids.first]: true, [ids.second]: true, [ids.flagged]: false })
  })

  it('refuses a read-only member (403)', async () => {
    const error = await apiErrorOf(unwrap(reader().POST('/api/v1/statements/verify', { body: { statementIds: [ids.first] } })))
    expect(error.status).toBe(403)
  })

  it('verifies each on its own, keeps going past a refusal and names every statement not verified with why', async () => {
    const result = await unwrap(
      writer().POST('/api/v1/statements/verify', { body: { statementIds: [ids.flagged, ids.first, ids.otherCompany, ids.second] } }),
    )
    expect(result.verified.map((entry) => entry.statementId)).toEqual([ids.first, ids.second])
    expect(result.verified.every((entry) => entry.monitoringQueued)).toBe(true)
    expect(result.notVerified).toEqual([
      expect.objectContaining({ statementId: ids.flagged, fileName: expect.stringContaining('it-bulk-flagged'), reasons: ['The total due is flagged: confirm or correct it'] }),
      { statementId: ids.otherCompany, reasons: ['The statement was not found in this workspace'] },
    ])

    const rows = check(
      await serviceRole().from('statements').select('id, status, closing_balance, verified_by_user_id').in('id', [ids.first, ids.second, ids.flagged]),
      'Read statements',
    )
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
    for (const id of [ids.first, ids.second]) {
      expect(byId[id]).toMatchObject({ status: 'verified', closing_balance: 22800, verified_by_user_id: world().users.manager.id })
    }
    expect(byId[ids.flagged]).toMatchObject({ status: 'review_required', closing_balance: null })

    // One audit entry per verified statement, exactly as verifying each alone.
    const audit = check(
      await serviceRole().from('audit_logs').select('entity_id, actor_user_id').eq('action', 'verify').in('entity_id', [ids.first, ids.second, ids.flagged]),
      'Read audit rows',
    )
    expect(audit.map((row) => row.entity_id).sort()).toEqual([ids.first, ids.second].sort())
    expect(audit.every((row) => row.actor_user_id === world().users.manager.id)).toBe(true)
  })

  it('reports a statement already verified instead of verifying it twice', async () => {
    const result = await unwrap(writer().POST('/api/v1/statements/verify', { body: { statementIds: [ids.first] } }))
    expect(result.verified).toEqual([])
    expect(result.notVerified).toEqual([
      expect.objectContaining({ statementId: ids.first, reasons: ['The statement is verified; only a statement under review can be verified'] }),
    ])
  })

  it('refuses an empty or repeated selection (400)', async () => {
    const empty = await apiErrorOf(unwrap(writer().POST('/api/v1/statements/verify', { body: { statementIds: [] } })))
    expect(empty.status).toBe(400)
    const repeated = await apiErrorOf(unwrap(writer().POST('/api/v1/statements/verify', { body: { statementIds: [ids.first, ids.first] } })))
    expect(repeated.status).toBe(400)
  })
})
