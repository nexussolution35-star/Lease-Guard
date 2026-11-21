import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { StorageService } from '../../infrastructure/storage/storage.service'
import { fakeStorageDb, testApiEnv, type StorageCall } from '../../infrastructure/storage/storage.test-helpers'
import { correctExtractedFieldBodySchema, setStatementMatchBodySchema } from './statement-review.schemas'
import { STATEMENT_DOWNLOAD_SECONDS, StatementReviewService } from './statement-review.service'
import type { StatementExtractionFieldRow, StatementRow } from './statements.mapper'
import { StatementsService } from './statements.service'
import { COMPANY, extractionFieldRow, extractionRow, JSON_NULL, PROPERTY, STATEMENT, statementRow, TENANT } from './statements.test-helpers'

const UNIT = '6f1d2c1e-0000-4000-8000-0000000000ee'
const LEASE = '6f1d2c1e-0000-4000-8000-0000000000ff'
const OTHER = '6f1d2c1e-0000-4000-8000-000000000999'

const leaseRow = (overrides: Record<string, unknown> = {}) => ({
  id: LEASE,
  reference: 'MSQ-L012',
  status: 'active',
  commencement_date: '2026-01-01',
  expiry_date: '2030-12-31',
  tenant_id: TENANT,
  unit_id: UNIT,
  property_id: PROPERTY,
  ...overrides,
})

interface World {
  statement?: Partial<StatementRow> | null
  extraction?: Record<string, unknown> | null
  fields?: StatementExtractionFieldRow[]
  tenant?: unknown
  unit?: unknown
  leases?: unknown[]
  lease?: unknown
  update?: FakeResult
  signedUrl?: string | null
}

const isUpdate = (query: RecordedQuery) => callsTo(query, 'update').length > 0

function harness(world: World = {}) {
  const fields = world.fields ?? [extractionFieldRow({ flagged: true })]
  const database = fakeDb((query) => {
    if (isUpdate(query)) return world.update ?? { data: { id: 'x' }, error: null }
    switch (query.table) {
      case 'statements':
        return { data: world.statement === null ? null : statementRow({ status: 'review_required', ...world.statement }), error: null }
      case 'statement_extractions':
        // getExtraction (latest, maybeSingle) or withChildren (in statement ids).
        if (callsTo(query, 'in').length > 0) return { data: [], error: null }
        return { data: world.extraction === null ? null : extractionRow(world.extraction ?? {}), error: null }
      case 'statement_extraction_fields':
        return { data: fields, error: null }
      case 'statement_line_items':
        return { data: [], error: null }
      case 'tenants':
        return { data: world.tenant === undefined ? { id: TENANT } : world.tenant, error: null }
      case 'units':
        return { data: world.unit === undefined ? { id: UNIT, property_id: PROPERTY } : world.unit, error: null }
      case 'leases':
        if (callsTo(query, 'maybeSingle').length > 0) return { data: world.lease === undefined ? leaseRow() : world.lease, error: null }
        return { data: world.leases ?? [leaseRow()], error: null }
      default:
        throw new Error(`Unexpected table ${query.table}`)
    }
  })
  const storage = fakeStorageDb((call: StorageCall) => {
    if (call.method !== 'createSignedUrl') throw new Error(`Unexpected storage call ${call.method}`)
    const url = world.signedUrl === undefined ? 'http://storage/object/sign/statement?token=s' : world.signedUrl
    return url ? { data: { signedUrl: url }, error: null } : { data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } }
  })
  const db = Object.assign(database.client, { storage: storage.client.storage })
  const service = new StatementReviewService(new StatementsService(), new StorageService(testApiEnv()))
  const updates = () => database.queries.filter(isUpdate)
  return { service, db, queries: database.queries, updates, storageCalls: storage.calls }
}

describe('StatementReviewService.downloadUrl', () => {
  it('signs a five-minute link to the original file in the statements bucket', async () => {
    const { service, db, storageCalls } = harness({ statement: { status: 'verified' } })
    expect(await service.downloadUrl(db, COMPANY, STATEMENT)).toEqual({
      url: 'http://storage/object/sign/statement?token=s',
      expiresInSeconds: STATEMENT_DOWNLOAD_SECONDS,
    })
    expect(storageCalls).toEqual([
      { bucket: 'statements', method: 'createSignedUrl', args: [statementRow().storage_path, STATEMENT_DOWNLOAD_SECONDS] },
    ])
  })

  it('answers 404 for a statement outside the company or a file that is gone', async () => {
    await expect(harness({ statement: null }).service.downloadUrl(harness({ statement: null }).db, COMPANY, STATEMENT)).rejects.toBeInstanceOf(
      NotFoundException,
    )
    const gone = harness({ signedUrl: null })
    await expect(gone.service.downloadUrl(gone.db, COMPANY, STATEMENT)).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('StatementReviewService.correctField', () => {
  it('stores the parsed value as the correction of that field of the pending extraction and returns the extraction', async () => {
    const { service, db, updates } = harness()
    const extraction = await service.correctField(db, COMPANY, STATEMENT, 'rental_charged', 38_000.5)
    const [update] = updates()
    expect(update?.table).toBe('statement_extraction_fields')
    expect(callsTo(update!, 'update')[0]?.[0]).toEqual({ corrected_value: 38_000.5 })
    expect(callsTo(update!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['extraction_id', extractionRow().id],
      ['name', 'rental_charged'],
    ])
    expect(extraction.fields[0]).toMatchObject({ name: 'rental_charged', resolution: 'unresolved' })
  })

  it('trims text corrections and refuses a value of the wrong kind (422) without writing', async () => {
    const text = harness({ fields: [extractionFieldRow({ name: 'tenant_name', value: JSON_NULL, flagged: true, raw_text: '' })] })
    await text.service.correctField(text.db, COMPANY, STATEMENT, 'tenant_name', '  Umoya  Coffee ')
    expect(callsTo(text.updates()[0]!, 'update')[0]?.[0]).toEqual({ corrected_value: 'Umoya Coffee' })

    const { service, db, updates } = harness()
    await expect(service.correctField(db, COMPANY, STATEMENT, 'rental_charged', '38000')).rejects.toThrow(
      new UnprocessableEntityException('The rental charged must be an amount in rands'),
    )
    await expect(service.correctField(db, COMPANY, STATEMENT, 'rental_charged', -5)).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect(updates()).toEqual([])
  })

  it('writes nothing when the correction is already the one stored', async () => {
    const { service, db, updates } = harness({ fields: [extractionFieldRow({ corrected_value: 38_000, corrected_by_user_id: 'u1' })] })
    await service.correctField(db, COMPANY, STATEMENT, 'rental_charged', 38_000)
    expect(updates()).toEqual([])
  })

  it('refuses a statement that is not under review, or an extraction already reviewed (409)', async () => {
    for (const status of ['uploaded', 'processing', 'verified', 'rejected', 'duplicate'] as const) {
      const { service, db } = harness({ statement: { status } })
      await expect(service.correctField(db, COMPANY, STATEMENT, 'rental_charged', 1)).rejects.toBeInstanceOf(ConflictException)
    }
    const reviewed = harness({ extraction: { status: 'corrected', reviewed_by_user_id: 'u1', reviewed_at: '2026-11-21T08:00:00+00:00' } })
    await expect(reviewed.service.correctField(reviewed.db, COMPANY, STATEMENT, 'rental_charged', 1)).rejects.toBeInstanceOf(ConflictException)
    expect(reviewed.updates()).toEqual([])
  })

  it('answers 404 without an extraction or without that field', async () => {
    const none = harness({ extraction: null })
    await expect(none.service.correctField(none.db, COMPANY, STATEMENT, 'rental_charged', 1)).rejects.toBeInstanceOf(NotFoundException)
    const missing = harness()
    await expect(missing.service.correctField(missing.db, COMPANY, STATEMENT, 'total_due', 1)).rejects.toThrow(
      new NotFoundException('The extraction has no total_due field'),
    )
  })

  it('answers 409 with the database message when the review closed meanwhile, and 403 for a privilege refusal', async () => {
    const closed = harness({
      update: { data: null, error: { code: 'P0001', message: 'This statement is no longer under review, so its extracted values cannot change.' } },
    })
    await expect(closed.service.correctField(closed.db, COMPANY, STATEMENT, 'rental_charged', 1)).rejects.toThrow(
      new ConflictException('This statement is no longer under review, so its extracted values cannot change.'),
    )
    const denied = harness({ update: { data: null, error: { code: '42501', message: 'permission denied' } } })
    await expect(denied.service.correctField(denied.db, COMPANY, STATEMENT, 'rental_charged', 1)).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('StatementReviewService.confirmField', () => {
  it('marks the field confirmed and drops any correction; the database stamps who and when', async () => {
    const { service, db, updates } = harness({ fields: [extractionFieldRow({ flagged: true, corrected_value: 1, corrected_by_user_id: 'u1' })] })
    await service.confirmField(db, COMPANY, STATEMENT, 'rental_charged')
    const patch = callsTo(updates()[0]!, 'update')[0]?.[0] as Record<string, unknown>
    expect(patch).toMatchObject({ corrected_value: null })
    expect(typeof patch['confirmed_at']).toBe('string')
  })

  it('refuses to confirm a value the extractor did not find (422): it must be entered', async () => {
    const { service, db, updates } = harness({ fields: [extractionFieldRow({ value: JSON_NULL, flagged: true, raw_text: '' })] })
    await expect(service.confirmField(db, COMPANY, STATEMENT, 'rental_charged')).rejects.toThrow(
      new UnprocessableEntityException('This value was not found on the statement, so it cannot be confirmed: enter it instead'),
    )
    expect(updates()).toEqual([])
  })

  it('changes nothing for a field already confirmed', async () => {
    const { service, db, updates } = harness({
      fields: [extractionFieldRow({ flagged: true, confirmed_by_user_id: 'u1', confirmed_at: '2026-11-21T08:00:00+00:00' })],
    })
    const extraction = await service.confirmField(db, COMPANY, STATEMENT, 'rental_charged')
    expect(extraction.fields[0]?.resolution).toBe('confirmed')
    expect(updates()).toEqual([])
  })
})

describe('StatementReviewService.confirmFieldNotOnStatement', () => {
  const missingNumber = () => extractionFieldRow({ name: 'statement_number', value: JSON_NULL, raw_text: '', confidence: 0, flagged: true })

  it('confirms a statement number the extractor did not find as not on the statement, filling nothing in', async () => {
    const { service, db, updates } = harness({ fields: [missingNumber()] })
    await service.confirmFieldNotOnStatement(db, COMPANY, STATEMENT, 'statement_number')
    const [update] = updates()
    expect(update?.table).toBe('statement_extraction_fields')
    const patch = callsTo(update!, 'update')[0]?.[0] as Record<string, unknown>
    expect(patch).toMatchObject({ corrected_value: null })
    expect(Object.keys(patch).sort()).toEqual(['confirmed_at', 'corrected_value'])
    expect(callsTo(update!, 'eq')).toContainEqual(['name', 'statement_number'])
  })

  it('reads a confirmed missing number back as resolved, and confirming it again writes nothing', async () => {
    const { service, db, updates } = harness({
      fields: [{ ...missingNumber(), confirmed_at: '2026-11-21T08:00:00+00:00', confirmed_by_user_id: 'u1' }],
    })
    const extraction = await service.confirmFieldNotOnStatement(db, COMPANY, STATEMENT, 'statement_number')
    expect(extraction.fields[0]).toMatchObject({ name: 'statement_number', value: null, resolution: 'confirmed' })
    expect(updates()).toEqual([])
  })

  it('refuses any other field, and a number that was found (422), without writing', async () => {
    const required = harness({ fields: [extractionFieldRow({ name: 'total_due', value: JSON_NULL, raw_text: '', flagged: true })] })
    await expect(required.service.confirmFieldNotOnStatement(required.db, COMPANY, STATEMENT, 'total_due')).rejects.toThrow(
      new UnprocessableEntityException('The total due is on every statement, so it must be entered or confirmed, not left out'),
    )
    expect(required.updates()).toEqual([])
    const found = harness({ fields: [extractionFieldRow({ name: 'statement_number', value: 'ST-1', raw_text: 'ST-1', flagged: true })] })
    await expect(found.service.confirmFieldNotOnStatement(found.db, COMPANY, STATEMENT, 'statement_number')).rejects.toThrow(
      new UnprocessableEntityException('The statement number was found on the statement: confirm or correct it'),
    )
    expect(found.updates()).toEqual([])
  })

  it('refuses a statement that is not under review (409)', async () => {
    const { service, db } = harness({ statement: { status: 'verified' }, fields: [missingNumber()] })
    await expect(service.confirmFieldNotOnStatement(db, COMPANY, STATEMENT, 'statement_number')).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('StatementReviewService.setMatch', () => {
  const body = { tenantId: TENANT, unitId: UNIT }

  it('finds the lease in force on the statement date and sets the tenant, unit and lease together', async () => {
    const { service, db, updates, queries } = harness({
      leases: [leaseRow({ id: OTHER, reference: 'MSQ-L001', status: 'renewed', commencement_date: '2021-01-01', expiry_date: '2025-12-31' }), leaseRow()],
    })
    await service.setMatch(db, COMPANY, STATEMENT, body)
    const leases = queries.find((query) => query.table === 'leases')!
    expect(callsTo(leases, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['tenant_id', TENANT],
      ['unit_id', UNIT],
      ['property_id', PROPERTY],
    ])
    const [update] = updates()
    expect(update?.table).toBe('statements')
    expect(callsTo(update!, 'update')[0]?.[0]).toEqual({ tenant_id: TENANT, unit_id: UNIT, lease_id: LEASE })
    expect(callsTo(update!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', STATEMENT],
      ['status', 'review_required'],
    ])
  })

  it('uses the reviewed statement date on the document over the typed one', async () => {
    const { service, db, updates } = harness({
      statement: { statement_date: '2025-10-31' },
      fields: [extractionFieldRow({ name: 'statement_date', value: '2025-10-31', flagged: true, corrected_value: '2026-10-31', corrected_by_user_id: 'u1' })],
      leases: [leaseRow({ id: OTHER, commencement_date: '2021-01-01', expiry_date: '2025-12-31' }), leaseRow()],
    })
    await service.setMatch(db, COMPANY, STATEMENT, body)
    expect(callsTo(updates()[0]!, 'update')[0]?.[0]).toMatchObject({ lease_id: LEASE })
  })

  it('refuses without a known statement date, without a lease in force, or with several (422), writing nothing', async () => {
    const unknown = harness({ statement: { statement_date: null }, fields: [] })
    await expect(unknown.service.setMatch(unknown.db, COMPANY, STATEMENT, body)).rejects.toThrow(
      new UnprocessableEntityException(['The statement date is not known yet: confirm or correct it, or choose the lease']),
    )
    const none = harness({ leases: [] })
    await expect(none.service.setMatch(none.db, COMPANY, STATEMENT, body)).rejects.toThrow(
      new UnprocessableEntityException(['No lease of this tenant for this unit was in force on 31 Oct 2026']),
    )
    const several = harness({ leases: [leaseRow(), leaseRow({ id: OTHER, reference: 'MSQ-L013' })] })
    await expect(several.service.setMatch(several.db, COMPANY, STATEMENT, body)).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect([...unknown.updates(), ...none.updates(), ...several.updates()]).toEqual([])
  })

  it('lists every reason a tenant and unit do not belong to the statement', async () => {
    const { service, db } = harness({ tenant: null, unit: { id: UNIT, property_id: OTHER } })
    await expect(service.setMatch(db, COMPANY, STATEMENT, body)).rejects.toThrow(
      new UnprocessableEntityException(['tenantId does not name a tenant in the active company', "The unit is not on the statement's property"]),
    )
  })

  it('checks a chosen lease belongs to the tenant, the unit and the property and was in force on the statement date', async () => {
    const ok = harness()
    await ok.service.setMatch(ok.db, COMPANY, STATEMENT, { ...body, leaseId: LEASE })
    expect(callsTo(ok.updates()[0]!, 'update')[0]?.[0]).toEqual({ tenant_id: TENANT, unit_id: UNIT, lease_id: LEASE })

    const wrong = harness({ lease: leaseRow({ tenant_id: OTHER, unit_id: OTHER }) })
    await expect(wrong.service.setMatch(wrong.db, COMPANY, STATEMENT, { ...body, leaseId: LEASE })).rejects.toThrow(
      new UnprocessableEntityException(['The lease belongs to a different tenant than tenantId', 'The lease is for a different unit than unitId']),
    )
    const ended = harness({ lease: leaseRow({ expiry_date: '2025-12-31' }) })
    await expect(ended.service.setMatch(ended.db, COMPANY, STATEMENT, { ...body, leaseId: LEASE })).rejects.toThrow(
      new UnprocessableEntityException(['The lease MSQ-L012 was not in force on the statement date']),
    )
    const missing = harness({ lease: null })
    await expect(missing.service.setMatch(missing.db, COMPANY, STATEMENT, { ...body, leaseId: LEASE })).rejects.toThrow(
      new UnprocessableEntityException(['leaseId does not name a lease in the active company']),
    )
  })

  it('refuses a statement that is not under review (409) and a match changed meanwhile (409)', async () => {
    const verified = harness({ statement: { status: 'verified' } })
    await expect(verified.service.setMatch(verified.db, COMPANY, STATEMENT, body)).rejects.toBeInstanceOf(ConflictException)
    const raced = harness({ update: { data: null, error: null } })
    await expect(raced.service.setMatch(raced.db, COMPANY, STATEMENT, body)).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('statement review bodies', () => {
  it('take a text or number value, and a tenant and unit with an optional lease', () => {
    expect(correctExtractedFieldBodySchema.safeParse({ value: 1 }).success).toBe(true)
    expect(correctExtractedFieldBodySchema.safeParse({ value: null }).success).toBe(false)
    expect(correctExtractedFieldBodySchema.safeParse({ value: 1, extra: true }).success).toBe(false)
    expect(setStatementMatchBodySchema.safeParse({ tenantId: TENANT, unitId: UNIT }).success).toBe(true)
    expect(setStatementMatchBodySchema.safeParse({ tenantId: TENANT }).success).toBe(false)
  })
})
