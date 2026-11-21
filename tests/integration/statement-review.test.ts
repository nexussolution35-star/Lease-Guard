import { randomUUID } from 'node:crypto'

import { unwrap, type ExtractionFieldName } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { buildStatementPdf, sha256Hex } from '../fixtures/pdf.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Statement review (ticket S-04) through the API and the local database: the original file is readable by any member,
 * corrections and confirmations are recorded with who, when, before and after, the proposed match is never applied by
 * itself, the tenant, unit and lease are set together and checked, and read-only members are refused every write.
 * The statement is seeded as the statement-processing worker leaves it (service role), so no worker runs here.
 */

const BUCKET = 'statements'
const writer = () => apiAs('manager', 'a')
const reader = () => apiAs('readOnly', 'a')

let lease: WorldLease
let statementId: string
let extractionId: string
let storagePath: string
let pdf: Uint8Array<ArrayBuffer>

interface AuditRow {
  actor_user_id: string | null
  action: string
  summary: string
  changes: { field: string; before: unknown; after: unknown }[]
}

async function auditRows(entityId: string): Promise<AuditRow[]> {
  return check(
    await serviceRole()
      .from('audit_logs')
      .select('actor_user_id, action, summary, changes')
      .eq('entity_id', entityId)
      .order('occurred_at', { ascending: true })
      .overrideTypes<AuditRow[], { merge: false }>(),
    'Read audit rows',
  )
}

const path = (fieldName: ExtractionFieldName) => ({ params: { path: { statementId, fieldName } } }) as const

beforeAll(async () => {
  const first = world().companies.a.leases.find((candidate) => candidate.status === 'active')
  if (!first) throw new Error('The world has no active lease in company A')
  lease = first
  const company = world().companies.a.id
  const { runId } = integration()
  statementId = randomUUID()
  extractionId = randomUUID()
  pdf = buildStatementPdf(['LeaseGuard integration test statement review', `Run ${runId}`, 'Monitoring record only - not a payment request'])
  storagePath = `${company}/${statementId}/it-review-${runId}.pdf`

  const db = serviceRole()
  expectOk(await db.storage.from(BUCKET).upload(storagePath, new Blob([pdf], { type: 'application/pdf' }), { contentType: 'application/pdf' }), 'Store PDF')
  expectOk(
    await db.from('statements').insert({
      id: statementId,
      company_id: company,
      property_id: lease.propertyId,
      file_name: `it-review-${runId}.pdf`,
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdf.byteLength,
      file_sha256: sha256Hex(pdf),
      source_system: 'MRI',
      status: 'review_required',
      uploaded_by_user_id: world().users.manager.id,
    }),
    'Insert statement',
  )
  expectOk(
    await db.from('statement_extractions').insert({
      id: extractionId,
      company_id: company,
      statement_id: statementId,
      engine: 'leaseguard-pdf 0.1.0',
      overall_confidence: 0.7,
      matched_tenant_id: lease.tenantId,
      matched_unit_id: lease.unitId,
      match_confidence: 0.95,
    }),
    'Insert extraction',
  )
  const field = (name: string, value: string | number | null, flagged: boolean) => ({
    company_id: company,
    extraction_id: extractionId,
    name,
    raw_text: value === null ? '' : String(value),
    confidence: flagged ? 0.5 : 0.97,
    flagged,
    ...(value === null ? {} : { value }),
  })
  expectOk(
    await db.from('statement_extraction_fields').insert([field('statement_date', '2026-10-31', true), field('rental_charged', 21600, true)]),
    'Insert fields',
  )
  // As the worker stores a value it did not find: `value` omitted, so the column default (JSON null) applies.
  expectOk(await db.from('statement_extraction_fields').insert(field('total_due', null, true)), 'Insert missing field')
})

afterAll(async () => {
  const db = serviceRole()
  expectOk(await db.from('statements').delete().eq('id', statementId), 'Delete statement')
  expectOk(await db.storage.from(BUCKET).remove([storagePath]), 'Remove object')
})

describe('statement original file', () => {
  it('gives any member, read-only included, a short-lived link to the original PDF', async () => {
    const link = await unwrap(reader().GET('/api/v1/statements/{statementId}/download-url', { params: { path: { statementId } } }))
    expect(link.expiresInSeconds).toBe(300)
    const response = await fetch(link.url)
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf)
  })

  it('answers 404 for a statement of another company', async () => {
    const error = await apiErrorOf(unwrap(apiAs('manager', 'b').GET('/api/v1/statements/{statementId}/download-url', { params: { path: { statementId } } })))
    expect(error.status).toBe(404)
  })
})

describe('statement review writes', () => {
  it('refuses every write to a read-only member (403)', async () => {
    const statuses = await Promise.all([
      apiErrorOf(unwrap(reader().PUT('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction', { ...path('total_due'), body: { value: 1 } }))),
      apiErrorOf(unwrap(reader().POST('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/confirm', path('rental_charged')))),
      apiErrorOf(
        unwrap(reader().PUT('/api/v1/statements/{statementId}/match', { params: { path: { statementId } }, body: { tenantId: lease.tenantId, unitId: lease.unitId } })),
      ),
    ])
    expect(statuses.map((error) => error.status)).toEqual([403, 403, 403])
  })

  it('offers the proposed match without applying it', async () => {
    const extraction = await unwrap(writer().GET('/api/v1/statements/{statementId}/extraction', { params: { path: { statementId } } }))
    expect(extraction).toMatchObject({ matchedTenantId: lease.tenantId, matchedUnitId: lease.unitId })
    expect(extraction.fields.map((field) => [field.name, field.resolution])).toEqual([
      ['statement_date', 'unresolved'],
      ['rental_charged', 'unresolved'],
      ['total_due', 'unresolved'],
    ])
    const statement = await unwrap(writer().GET('/api/v1/statements/{statementId}', { params: { path: { statementId } } }))
    expect(statement).not.toHaveProperty('tenantId')
    expect(statement).not.toHaveProperty('leaseId')
  })

  it('never confirms a value that was not found; entering it is a correction recorded with who, when, before and after', async () => {
    const refused = await apiErrorOf(unwrap(writer().POST('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/confirm', path('total_due'))))
    expect(refused.status).toBe(422)

    const bad = await apiErrorOf(
      unwrap(writer().PUT('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction', { ...path('total_due'), body: { value: '21600' } })),
    )
    expect(bad.status).toBe(422)

    const extraction = await unwrap(
      writer().PUT('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction', { ...path('total_due'), body: { value: 21600 } }),
    )
    const field = extraction.fields.find((candidate) => candidate.name === 'total_due')
    expect(field).toMatchObject({ value: null, correctedValue: 21600, correctedByUserId: world().users.manager.id, resolution: 'corrected' })
    expect(Date.now() - Date.parse(field?.correctedAt ?? '')).toBeLessThan(60_000)

    const audit = (await auditRows(extractionId)).filter((row) => row.summary === 'Corrected extracted field total_due')
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor_user_id: world().users.manager.id, action: 'update' })
    expect(audit[0]?.changes[0]).toEqual({ field: 'total_due', before: null, after: 21600 })
  })

  it('confirms a flagged value, recording who and when', async () => {
    const extraction = await unwrap(writer().POST('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/confirm', path('rental_charged')))
    expect(extraction.fields.find((field) => field.name === 'rental_charged')).toMatchObject({
      value: 21600,
      confirmedByUserId: world().users.manager.id,
      resolution: 'confirmed',
    })
    const audit = (await auditRows(extractionId)).filter((row) => row.summary === 'Confirmed extracted field rental_charged')
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor_user_id: world().users.manager.id, action: 'verify' })
    expect(audit[0]?.changes).toEqual([
      { field: 'rental_charged', before: 21600, after: 21600 },
      { field: 'rental_charged.confirmed', before: false, after: true },
    ])
  })

  it('sets the tenant, unit and lease together once the statement date is known, finding the lease in force', async () => {
    const match = { tenantId: lease.tenantId, unitId: lease.unitId }
    const unknownDate = await apiErrorOf(unwrap(writer().PUT('/api/v1/statements/{statementId}/match', { params: { path: { statementId } }, body: match })))
    expect(unknownDate.status).toBe(422)

    await unwrap(writer().POST('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/confirm', path('statement_date')))
    const statement = await unwrap(writer().PUT('/api/v1/statements/{statementId}/match', { params: { path: { statementId } }, body: match }))
    expect(statement).toMatchObject({ tenantId: lease.tenantId, unitId: lease.unitId, leaseId: lease.id, status: 'review_required' })

    const audit = (await auditRows(statementId)).filter((row) => row.summary.endsWith('tenant, unit and lease set'))
    expect(audit).toHaveLength(1)
    expect(audit[0]?.actor_user_id).toBe(world().users.manager.id)
    expect(audit[0]?.changes).toEqual(
      expect.arrayContaining([
        { field: 'tenantId', before: null, after: lease.tenantId },
        { field: 'unitId', before: null, after: lease.unitId },
        { field: 'leaseId', before: null, after: lease.id },
      ]),
    )
  })

  it('refuses a tenant, unit and lease that do not belong together or to the statement\'s property (422)', async () => {
    const others = world().companies.a.leases.filter((candidate) => candidate.id !== lease.id)
    const otherTenantsLease = others.find((candidate) => candidate.tenantId !== lease.tenantId)
    const otherProperty = world().companies.a.units.find((unit) => unit.propertyId !== lease.propertyId)
    if (!otherTenantsLease || !otherProperty) throw new Error('The world needs another tenant\'s lease and a unit on another property')

    const wrongLease = await apiErrorOf(
      unwrap(
        writer().PUT('/api/v1/statements/{statementId}/match', {
          params: { path: { statementId } },
          body: { tenantId: lease.tenantId, unitId: lease.unitId, leaseId: otherTenantsLease.id },
        }),
      ),
    )
    expect(wrongLease.status).toBe(422)
    const wrongUnit = await apiErrorOf(
      unwrap(writer().PUT('/api/v1/statements/{statementId}/match', { params: { path: { statementId } }, body: { tenantId: lease.tenantId, unitId: otherProperty.id } })),
    )
    expect(wrongUnit.status).toBe(422)
  })

  it('refuses changes once the statement is no longer under review (409)', async () => {
    expectOk(await serviceRole().from('statements').update({ status: 'rejected' }).eq('id', statementId), 'Reject statement')
    const error = await apiErrorOf(
      unwrap(writer().PUT('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction', { ...path('rental_charged'), body: { value: 1 } })),
    )
    expect(error.status).toBe(409)
    const match = await apiErrorOf(
      unwrap(writer().PUT('/api/v1/statements/{statementId}/match', { params: { path: { statementId } }, body: { tenantId: lease.tenantId, unitId: lease.unitId } })),
    )
    expect(match.status).toBe(409)
  })
})
