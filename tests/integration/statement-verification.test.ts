import { randomUUID } from 'node:crypto'

import { unwrap, type ExtractionFieldName } from '@leaseguard/api-client'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { listKeysWithPrefix } from '../fixtures/redis.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Statement verification, rejection and marking as a duplicate (ticket S-05) through the API and the local database:
 * verification is refused with every reason while a field is unresolved or the match is missing, then writes the
 * reviewed values as the figures, stamps the verifier, closes the review event and queues monitoring for the tenant;
 * figures never reach a statement any other way; a rejection keeps its reason; a duplicate names the other statement;
 * every outcome is audited and read-only members are refused. Statements are seeded as the statement-processing
 * worker leaves them (service role), so no worker runs here (no worker consumes this run's queue prefix either).
 */

const writer = () => apiAs('manager', 'a')
const reader = () => apiAs('readOnly', 'a')

let lease: WorldLease
const ids = { toVerify: randomUUID(), toReject: randomUUID(), copy: randomUUID(), extraction: randomUUID(), event: randomUUID() }

const VALUES: Record<ExtractionFieldName, string | number> = {
  tenant_name: 'Integration Trading',
  unit_number: 'Shop 1',
  statement_number: 'IT-2026-10',
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

interface AuditRow {
  actor_user_id: string | null
  action: string
  changes: { field: string; before: unknown; after: unknown }[]
}

async function auditRows(entityId: string, action: string): Promise<AuditRow[]> {
  return check(
    await serviceRole()
      .from('audit_logs')
      .select('actor_user_id, action, changes')
      .eq('entity_id', entityId)
      .eq('action', action)
      .overrideTypes<AuditRow[], { merge: false }>(),
    'Read audit rows',
  )
}

const statementPath = (statementId: string) => ({ params: { path: { statementId } } }) as const
const fieldPath = (fieldName: ExtractionFieldName) => ({ params: { path: { statementId: ids.toVerify, fieldName } } }) as const

beforeAll(async () => {
  const first = world().companies.a.leases.find((candidate) => candidate.status === 'active')
  if (!first) throw new Error('The world has no active lease in company A')
  lease = first
  const company = world().companies.a.id
  const { runId } = integration()
  const db = serviceRole()
  const statement = (id: string, name: string, sha: string) => ({
    id,
    company_id: company,
    property_id: lease.propertyId,
    file_name: `it-${name}-${runId}.pdf`,
    storage_path: `${company}/${id}/it-${name}-${runId}.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 1024,
    file_sha256: sha,
    source_system: 'MRI',
    status: 'review_required',
    uploaded_by_user_id: world().users.manager.id,
  })
  const sha = (seed: string) => `${seed}${runId}`.padEnd(64, '0').replace(/[^0-9a-f]/g, 'a').slice(0, 64)
  expectOk(
    await db.from('statements').insert([statement(ids.toVerify, 'verify', sha('a1')), statement(ids.toReject, 'reject', sha('b2')), statement(ids.copy, 'copy', sha('c3'))]),
    'Insert statements',
  )
  expectOk(
    await db.from('statement_extractions').insert({
      id: ids.extraction,
      company_id: company,
      statement_id: ids.toVerify,
      engine: 'leaseguard-pdf 0.1.0',
      overall_confidence: 0.8,
      matched_tenant_id: lease.tenantId,
      matched_unit_id: lease.unitId,
      match_confidence: 0.95,
    }),
    'Insert extraction',
  )
  const flagged = new Set<ExtractionFieldName>(['rental_charged', 'total_due'])
  expectOk(
    await db.from('statement_extraction_fields').insert(
      (Object.keys(VALUES) as ExtractionFieldName[]).map((name) => ({
        company_id: company,
        extraction_id: ids.extraction,
        name,
        raw_text: String(VALUES[name]),
        value: VALUES[name],
        confidence: flagged.has(name) ? 0.5 : 0.97,
        flagged: flagged.has(name),
      })),
    ),
    'Insert fields',
  )
  expectOk(
    await db.from('monitoring_events').insert({
      id: ids.event,
      company_id: company,
      dedupe_key: `statement_review_required:${ids.toVerify}`,
      type: 'statement_review_required',
      property_id: lease.propertyId,
      statement_id: ids.toVerify,
      title: 'Statement needs review',
      description: 'Two values are flagged',
      identified_on: '2026-11-01',
      priority: 'medium',
      recommended_action: 'Review the statement',
      status: 'new',
    }),
    'Insert review event',
  )
})

afterAll(async () => {
  const db = serviceRole()
  expectOk(await db.from('monitoring_events').delete().eq('id', ids.event), 'Delete event')
  expectOk(await db.from('monitoring_events').delete().eq('statement_id', ids.toVerify), 'Delete raised events')
  expectOk(await db.from('statements').delete().eq('id', ids.copy), 'Delete duplicate')
  expectOk(await db.from('statements').delete().in('id', [ids.toVerify, ids.toReject]), 'Delete statements')
})

describe('statement review outcome', () => {
  it('refuses every outcome to a read-only member (403)', async () => {
    const statuses = await Promise.all([
      apiErrorOf(unwrap(reader().POST('/api/v1/statements/{statementId}/verify', statementPath(ids.toVerify)))),
      apiErrorOf(unwrap(reader().POST('/api/v1/statements/{statementId}/reject', { ...statementPath(ids.toReject), body: { reason: 'x' } }))),
      apiErrorOf(
        unwrap(reader().POST('/api/v1/statements/{statementId}/mark-duplicate', { ...statementPath(ids.copy), body: { duplicateOfStatementId: ids.toVerify } })),
      ),
    ])
    expect(statuses.map((error) => error.status)).toEqual([403, 403, 403])
  })

  it('refuses verification while fields are unresolved and the match is missing, listing every reason (422)', async () => {
    const error = await apiErrorOf(unwrap(writer().POST('/api/v1/statements/{statementId}/verify', statementPath(ids.toVerify))))
    expect(error.status).toBe(422)
    expect(error.messages).toEqual([
      'The rental charged is flagged: confirm or correct it',
      'The total due is flagged: confirm or correct it',
      'The tenant is not set',
      'The unit is not set',
      'The lease is not set',
    ])
  })

  it('never lets a signed-in user write figures or an outcome directly', async () => {
    const ctx = integration()
    const asManager = createClient(ctx.supabaseUrl, ctx.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${ctx.accessTokens.manager}` } },
    })
    const figures = await asManager.from('statements').update({ closing_balance: 1 }).eq('id', ids.toVerify)
    expect(figures.error?.code).toBe('42501')
    const outcome = await asManager.from('statements').update({ status: 'verified' }).eq('id', ids.toVerify)
    expect(outcome.error?.code).toBe('42501')
    const rpc = await asManager.rpc('verify_statement', { p_company_id: world().companies.a.id, p_statement_id: ids.toVerify })
    expect(rpc.error?.code).toBe('23514')
  })

  it('verifies a reviewed, matched statement: figures, verifier, closed review and monitoring queued for the tenant', async () => {
    await unwrap(writer().POST('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/confirm', fieldPath('rental_charged')))
    await unwrap(
      writer().PUT('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction', { ...fieldPath('total_due'), body: { value: 22800 } }),
    )
    await unwrap(writer().PUT('/api/v1/statements/{statementId}/match', { ...statementPath(ids.toVerify), body: { tenantId: lease.tenantId, unitId: lease.unitId } }))

    const result = await unwrap(writer().POST('/api/v1/statements/{statementId}/verify', statementPath(ids.toVerify)))
    expect(result.monitoringQueued).toBe(true)
    expect(result.statement).toMatchObject({
      status: 'verified',
      tenantId: lease.tenantId,
      leaseId: lease.id,
      statementNumber: 'IT-2026-10',
      statementDate: '2026-10-31',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      openingBalance: 0,
      rentalCharged: 21600,
      additionalCharges: 1200,
      paymentsReceived: 0,
      closingBalance: 22800,
      totalDue: 22800,
      verifiedByUserId: world().users.manager.id,
    })

    const extraction = await unwrap(writer().GET('/api/v1/statements/{statementId}/extraction', statementPath(ids.toVerify)))
    expect(extraction).toMatchObject({ status: 'corrected', reviewedByUserId: world().users.manager.id })
    const event = check(await serviceRole().from('monitoring_events').select('status, resolved_by_user_id').eq('id', ids.event).single(), 'Read event')
    expect(event).toEqual({ status: 'resolved', resolved_by_user_id: world().users.manager.id })

    const { redisUrl, queuePrefix } = integration()
    const jobId = `statement-monitoring.${world().companies.a.id.toLowerCase()}.${ids.toVerify.toLowerCase()}`
    const keys = await listKeysWithPrefix(redisUrl, queuePrefix)
    expect(keys).toContain(`${queuePrefix}:statement-monitoring:${jobId}`)

    const audit = await auditRows(ids.toVerify, 'verify')
    expect(audit).toHaveLength(1)
    expect(audit[0]?.actor_user_id).toBe(world().users.manager.id)
    expect(audit[0]?.changes).toEqual(
      expect.arrayContaining([
        { field: 'status', before: 'review_required', after: 'verified' },
        { field: 'closingBalance', before: null, after: 22800 },
      ]),
    )
  })

  it('verifies a statement once (409)', async () => {
    const error = await apiErrorOf(unwrap(writer().POST('/api/v1/statements/{statementId}/verify', statementPath(ids.toVerify))))
    expect(error.status).toBe(409)
  })

  it('rejects only with a reason, keeping it with the statement', async () => {
    const missing = await apiErrorOf(unwrap(writer().POST('/api/v1/statements/{statementId}/reject', { ...statementPath(ids.toReject), body: { reason: ' ' } })))
    expect(missing.status).toBe(400)
    const rejected = await unwrap(
      writer().POST('/api/v1/statements/{statementId}/reject', { ...statementPath(ids.toReject), body: { reason: 'Statement for a different tenant' } }),
    )
    expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: 'Statement for a different tenant' })
    expect(rejected).not.toHaveProperty('closingBalance')
    const audit = await auditRows(ids.toReject, 'reject')
    expect(audit[0]?.changes).toEqual(expect.arrayContaining([{ field: 'rejectionReason', before: null, after: 'Statement for a different tenant' }]))
  })

  it('marks a duplicate only of another live statement', async () => {
    const self = await apiErrorOf(
      unwrap(writer().POST('/api/v1/statements/{statementId}/mark-duplicate', { ...statementPath(ids.copy), body: { duplicateOfStatementId: ids.copy } })),
    )
    expect(self.status).toBe(422)
    const ofRejected = await apiErrorOf(
      unwrap(writer().POST('/api/v1/statements/{statementId}/mark-duplicate', { ...statementPath(ids.copy), body: { duplicateOfStatementId: ids.toReject } })),
    )
    expect(ofRejected.status).toBe(422)
    const duplicate = await unwrap(
      writer().POST('/api/v1/statements/{statementId}/mark-duplicate', { ...statementPath(ids.copy), body: { duplicateOfStatementId: ids.toVerify } }),
    )
    expect(duplicate).toMatchObject({ status: 'duplicate', duplicateOfStatementId: ids.toVerify })
    const audit = await auditRows(ids.copy, 'reject')
    expect(audit[0]?.changes).toEqual(expect.arrayContaining([{ field: 'duplicateOfStatementId', before: null, after: ids.toVerify }]))
  })
})
