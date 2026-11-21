import { randomUUID } from 'node:crypto'

import { unwrap, type ExtractionFieldName } from '@leaseguard/api-client'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WorldLease } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Statement review integrity (20261121194500_statement_review_integrity.sql) through the API and the local database: a
 * statement that prints no number is verified once the reviewer confirms the number is not on it (audited, nothing
 * filled in) while any other missing value must still be entered; verification checks the reviewed period and that the
 * lease was in force on the reviewed statement date, in the API and again in the database; a signed-in user cannot
 * write an extraction's status or review notes, nor a statement's status or processing error, directly. Statements
 * are seeded as the statement-processing worker leaves them (service role); no worker runs here.
 */

const writer = () => apiAs('manager', 'a')

let lease: WorldLease
const ids = { statement: randomUUID(), extraction: randomUUID() }

/** The statement prints no number, and the extractor did not find the total due either. */
const VALUES: Record<ExtractionFieldName, string | number | null> = {
  tenant_name: 'Integration Trading',
  unit_number: 'Shop 1',
  statement_number: null,
  statement_date: '2026-10-31',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  opening_balance: 0,
  rental_charged: 21600,
  additional_charges: 1200,
  payments_received: 0,
  outstanding_balance: 22800,
  total_due: null,
}

const statementPath = { params: { path: { statementId: ids.statement } } } as const
const fieldPath = (fieldName: ExtractionFieldName) => ({ params: { path: { statementId: ids.statement, fieldName } } }) as const

function signedInManager() {
  const ctx = integration()
  return createClient(ctx.supabaseUrl, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ctx.accessTokens.manager}` } },
  })
}

beforeAll(async () => {
  const first = world().companies.a.leases.find((candidate) => candidate.status === 'active')
  if (!first) throw new Error('The world has no active lease in company A')
  lease = first
  const company = world().companies.a.id
  const { runId } = integration()
  const db = serviceRole()
  expectOk(
    await db.from('statements').insert({
      id: ids.statement,
      company_id: company,
      property_id: lease.propertyId,
      tenant_id: lease.tenantId,
      unit_id: lease.unitId,
      lease_id: lease.id,
      file_name: `it-no-number-${runId}.pdf`,
      storage_path: `${company}/${ids.statement}/it-no-number-${runId}.pdf`,
      mime_type: 'application/pdf',
      size_bytes: 1024,
      file_sha256: `f7${runId}`.padEnd(64, '0').replace(/[^0-9a-f]/g, 'a').slice(0, 64),
      source_system: 'MRI',
      status: 'review_required',
      uploaded_by_user_id: world().users.manager.id,
    }),
    'Insert statement',
  )
  expectOk(
    await db.from('statement_extractions').insert({
      id: ids.extraction,
      company_id: company,
      statement_id: ids.statement,
      engine: 'leaseguard-pdf 0.1.0',
      overall_confidence: 0.8,
      match_confidence: 0.95,
    }),
    'Insert extraction',
  )
  expectOk(
    await db.from('statement_extraction_fields').insert(
      (Object.keys(VALUES) as ExtractionFieldName[]).map((name) => {
        const value = VALUES[name]
        return {
          company_id: company,
          extraction_id: ids.extraction,
          name,
          raw_text: value === null ? '' : String(value),
          value,
          confidence: value === null ? 0 : 0.97,
          flagged: value === null,
        }
      }),
    ),
    'Insert fields',
  )
})

afterAll(async () => {
  const db = serviceRole()
  expectOk(await db.from('monitoring_events').delete().eq('statement_id', ids.statement), 'Delete raised events')
  expectOk(await db.from('statements').delete().eq('id', ids.statement), 'Delete statement')
})

describe('statement review integrity', () => {
  it('asks for the missing number to be entered or confirmed as not on the statement, and for the total due to be entered', async () => {
    const error = await apiErrorOf(unwrap(writer().POST('/api/v1/statements/{statementId}/verify', statementPath)))
    expect(error.status).toBe(422)
    expect(error.messages).toEqual([
      'The statement number was not found on the statement: enter it, or confirm it is not on the statement',
      'The total due was not found on the statement: enter it',
    ])
  })

  it('never lets a missing amount be confirmed as not on the statement (422)', async () => {
    const error = await apiErrorOf(
      unwrap(writer().POST('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/not-on-statement', fieldPath('total_due'))),
    )
    expect(error.status).toBe(422)
    expect(error.messages).toEqual(['The total due is on every statement, so it must be entered or confirmed, not left out'])
  })

  it('records that the number is not on the statement, audited, with nothing filled in', async () => {
    const extraction = await unwrap(
      writer().POST('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/not-on-statement', fieldPath('statement_number')),
    )
    const field = extraction.fields.find((candidate) => candidate.name === 'statement_number')
    expect(field).toMatchObject({ value: null, resolution: 'confirmed', confirmedByUserId: world().users.manager.id })
    expect(field).not.toHaveProperty('correctedValue')

    const audit = check(
      await serviceRole()
        .from('audit_logs')
        .select('actor_user_id, action, summary')
        .eq('entity_id', ids.extraction)
        .eq('summary', 'Confirmed that statement_number is not on the statement'),
      'Read audit rows',
    )
    expect(audit).toEqual([{ actor_user_id: world().users.manager.id, action: 'verify', summary: 'Confirmed that statement_number is not on the statement' }])
  })

  it('refuses a reversed period and a lease not in force on the reviewed date, in the API and in the database', async () => {
    await unwrap(writer().PUT('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction', { ...fieldPath('total_due'), body: { value: 22800 } }))
    await unwrap(
      writer().PUT('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction', { ...fieldPath('statement_date'), body: { value: '2010-10-31' } }),
    )
    await unwrap(
      writer().PUT('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction', { ...fieldPath('period_end'), body: { value: '2026-09-30' } }),
    )

    const error = await apiErrorOf(unwrap(writer().POST('/api/v1/statements/{statementId}/verify', statementPath)))
    expect(error.status).toBe(422)
    expect(error.messages).toEqual([
      'The period end is before the period start',
      `The lease ${lease.reference} was not in force on 31 Oct 2010: choose the lease again`,
    ])

    // The database checks the same, so calling the function directly is refused too.
    const rpc = await signedInManager().rpc('verify_statement', { p_company_id: world().companies.a.id, p_statement_id: ids.statement })
    expect(rpc.error?.code).toBe('23514')
    expect(rpc.error?.message).toBe(`The period end is before the period start; The lease ${lease.reference} was not in force on 31 Oct 2010`)
  })

  it('never lets a signed-in user write an extraction status, review notes, statement status or processing error directly', async () => {
    const db = signedInManager()
    const extractionStatus = await db.from('statement_extractions').update({ status: 'confirmed' }).eq('id', ids.extraction)
    expect(extractionStatus.error?.code).toBe('42501')
    const notes = await db.from('statement_extractions').update({ review_notes: 'Fine' }).eq('id', ids.extraction)
    expect(notes.error?.code).toBe('42501')
    const status = await db.from('statements').update({ status: 'processing' }).eq('id', ids.statement)
    expect(status.error?.code).toBe('42501')
    const processingError = await db.from('statements').update({ processing_error: 'Made up' }).eq('id', ids.statement)
    expect(processingError.error?.code).toBe('42501')
  })

  it('verifies the statement without a number once the review is complete', async () => {
    await unwrap(
      writer().PUT('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction', { ...fieldPath('statement_date'), body: { value: '2026-10-31' } }),
    )
    await unwrap(
      writer().PUT('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction', { ...fieldPath('period_end'), body: { value: '2026-10-31' } }),
    )

    const result = await unwrap(writer().POST('/api/v1/statements/{statementId}/verify', statementPath))
    expect(result.statement).toMatchObject({ status: 'verified', statementDate: '2026-10-31', periodEnd: '2026-10-31', closingBalance: 22800, totalDue: 22800 })
    expect(result.statement).not.toHaveProperty('statementNumber')
  })
})
