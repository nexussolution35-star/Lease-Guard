import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'
import { EXTRACTION_FIELD_NAMES, type ExtractionFieldName } from '@leaseguard/domain'
import { describe, expect, it, vi } from 'vitest'

import { fakeDb, rpcArgs, type FakeResult } from '../../common/testing/fake-db.test-helpers'
import type { Json } from '../../infrastructure/database/database.types'
import type { QueueProducer } from '../../infrastructure/queues/queue-producer'
import { markStatementDuplicateBodySchema, rejectStatementBodySchema, verifyStatementsBodySchema } from './statement-verification.schemas'
import { StatementVerificationService } from './statement-verification.service'
import type { StatementExtractionFieldRow, StatementRow } from './statements.mapper'
import { StatementsService } from './statements.service'
import { COMPANY, extractionFieldRow, extractionRow, JSON_NULL, STATEMENT, statementRow, TENANT } from './statements.test-helpers'

const UNIT = '6f1d2c1e-0000-4000-8000-0000000000ee'
const LEASE = '6f1d2c1e-0000-4000-8000-0000000000ff'
const OTHER = '6f1d2c1e-0000-4000-8000-000000000999'

const VALUES: Record<ExtractionFieldName, NonNullable<Json>> = {
  tenant_name: 'Dlamini Cellular',
  unit_number: 'Shop 12',
  statement_number: 'ST-1042',
  statement_date: '2026-10-31',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  opening_balance: 0,
  rental_charged: 12_000,
  additional_charges: 960,
  payments_received: 0,
  outstanding_balance: 12_960,
  total_due: 12_960,
}

const resolvedFields = (overrides: Partial<Record<ExtractionFieldName, Partial<StatementExtractionFieldRow>>> = {}) =>
  EXTRACTION_FIELD_NAMES.map((name, index) =>
    extractionFieldRow({ id: `6f1d2c1e-0000-4000-8000-${String(index).padStart(12, '0')}`, name, value: VALUES[name], ...overrides[name] }),
  )

interface World {
  statement?: Partial<StatementRow>
  extraction?: Record<string, unknown> | null
  fields?: StatementExtractionFieldRow[]
  rpc?: FakeResult
  enqueueFails?: boolean
}

function harness(world: World = {}) {
  const matched = { status: 'review_required' as const, tenant_id: TENANT, unit_id: UNIT, lease_id: LEASE, ...world.statement }
  const database = fakeDb((query) => {
    if (query.table.startsWith('rpc:')) return world.rpc ?? { data: STATEMENT, error: null }
    switch (query.table) {
      case 'statements':
        return { data: statementRow(matched), error: null }
      case 'statement_extractions':
        if (query.calls.some(([method]) => method === 'in')) return { data: [], error: null }
        return { data: world.extraction === null ? null : extractionRow(world.extraction ?? {}), error: null }
      case 'statement_extraction_fields':
        return { data: world.fields ?? resolvedFields(), error: null }
      case 'statement_line_items':
        return { data: [], error: null }
      case 'leases':
        return {
          data: { id: LEASE, reference: 'MSQ-L012', status: 'active', commencement_date: '2026-01-01', expiry_date: '2030-12-31' },
          error: null,
        }
      default:
        throw new Error(`Unexpected table ${query.table}`)
    }
  })
  const enqueue = vi.fn(async () => {
    if (world.enqueueFails) throw new ServiceUnavailableException('Background processing is not available')
    return 'job'
  })
  const service = new StatementVerificationService(new StatementsService(), { enqueue } as unknown as QueueProducer)
  const rpcs = () => database.queries.filter((query) => query.table.startsWith('rpc:'))
  return { service, db: database.client, rpcs, enqueue }
}

describe('StatementVerificationService.verify', () => {
  it('verifies a resolved, matched statement through the database and queues monitoring for its tenant', async () => {
    const { service, db, rpcs, enqueue } = harness()
    const result = await service.verify(db, COMPANY, STATEMENT)
    expect(result.monitoringQueued).toBe(true)
    expect(result.statement.id).toBe(STATEMENT)
    expect(rpcs().map((query) => [query.table, rpcArgs(query)])).toEqual([
      ['rpc:verify_statement', { p_company_id: COMPANY, p_statement_id: STATEMENT }],
    ])
    expect(enqueue).toHaveBeenCalledWith('statement-monitoring', { companyId: COMPANY, statementId: STATEMENT })
  })

  it('never sends figures: the database writes the reviewed values', async () => {
    const { service, db, rpcs } = harness()
    await service.verify(db, COMPANY, STATEMENT)
    expect(Object.keys(rpcArgs(rpcs()[0]!))).toEqual(['p_company_id', 'p_statement_id'])
  })

  it('refuses with every reason while fields are unresolved or the match is missing, without calling the database', async () => {
    const { service, db, rpcs } = harness({
      statement: { lease_id: null },
      fields: resolvedFields({ rental_charged: { flagged: true }, total_due: { value: JSON_NULL, flagged: true } }),
    })
    const error = await service.verify(db, COMPANY, STATEMENT).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(UnprocessableEntityException)
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      message: [
        'The rental charged is flagged: confirm or correct it',
        'The total due was not found on the statement: enter it',
        'The lease is not set',
      ],
    })
    expect(rpcs()).toEqual([])
  })

  it('refuses a statement without an extraction (422) or not under review (409)', async () => {
    const unextracted = harness({ extraction: null })
    await expect(unextracted.service.verify(unextracted.db, COMPANY, STATEMENT)).rejects.toBeInstanceOf(UnprocessableEntityException)
    const verified = harness({ statement: { status: 'verified' } })
    await expect(verified.service.verify(verified.db, COMPANY, STATEMENT)).rejects.toBeInstanceOf(ConflictException)
    expect(verified.rpcs()).toEqual([])
  })

  it('maps the database refusals: a change since the check (422 with the reasons, 409 when closed), a read-only member (403)', async () => {
    const changed = harness({ rpc: { data: null, error: { code: '23514', message: 'The lease is not set; total_due is not confirmed or corrected' } } })
    const error = await changed.service.verify(changed.db, COMPANY, STATEMENT).catch((caught: unknown) => caught)
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      message: ['The lease is not set', 'total_due is not confirmed or corrected'],
    })
    const closed = harness({ rpc: { data: null, error: { code: 'P0001', message: 'This statement is verified, so it cannot be verified.' } } })
    await expect(closed.service.verify(closed.db, COMPANY, STATEMENT)).rejects.toBeInstanceOf(ConflictException)
    const readOnly = harness({ rpc: { data: null, error: { code: '42501', message: 'Only a company admin or property manager can verify a statement.' } } })
    await expect(readOnly.service.verify(readOnly.db, COMPANY, STATEMENT)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('keeps the verification when monitoring cannot be queued, and says so', async () => {
    const { service, db } = harness({ enqueueFails: true })
    await expect(service.verify(db, COMPANY, STATEMENT)).resolves.toMatchObject({ monitoringQueued: false })
  })
})

describe('StatementVerificationService.reject and markDuplicate', () => {
  it('rejects with the reason and marks a duplicate with the other statement', async () => {
    const { service, db, rpcs } = harness()
    await service.reject(db, COMPANY, STATEMENT, { reason: 'Not our tenant' })
    await service.markDuplicate(db, COMPANY, STATEMENT, { duplicateOfStatementId: OTHER })
    expect(rpcs().map((query) => [query.table, rpcArgs(query)])).toEqual([
      ['rpc:reject_statement', { p_company_id: COMPANY, p_statement_id: STATEMENT, p_reason: 'Not our tenant' }],
      ['rpc:mark_statement_duplicate', { p_company_id: COMPANY, p_statement_id: STATEMENT, p_duplicate_of_statement_id: OTHER }],
    ])
  })

  it('answers 404 for a statement outside the company and 422 for an unusable duplicate target', async () => {
    const missing = harness({ rpc: { data: null, error: null } })
    await expect(missing.service.reject(missing.db, COMPANY, STATEMENT, { reason: 'x' })).rejects.toBeInstanceOf(NotFoundException)
    const self = harness({ rpc: { data: null, error: { code: '23514', message: 'A statement cannot be a duplicate of itself.' } } })
    await expect(self.service.markDuplicate(self.db, COMPANY, STATEMENT, { duplicateOfStatementId: STATEMENT })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    )
  })

  it('needs a reason and the other statement', () => {
    expect(rejectStatementBodySchema.safeParse({ reason: '   ' }).success).toBe(false)
    expect(rejectStatementBodySchema.parse({ reason: ' Wrong tenant ' })).toEqual({ reason: 'Wrong tenant' })
    expect(markStatementDuplicateBodySchema.safeParse({}).success).toBe(false)
    expect(markStatementDuplicateBodySchema.safeParse({ duplicateOfStatementId: 'nope' }).success).toBe(false)
  })
})

describe('StatementVerificationService.verifyMany', () => {
  const READY = STATEMENT
  const FLAGGED = '6f1d2c1e-0000-4000-8000-0000000000a1'
  const CLOSED = '6f1d2c1e-0000-4000-8000-0000000000a2'
  const BROKEN = '6f1d2c1e-0000-4000-8000-0000000000a3'
  const MISSING = '6f1d2c1e-0000-4000-8000-0000000000a4'

  /** Several statements of one company, each answering for itself; BROKEN's database call fails unexpectedly. */
  function batch() {
    const rows: Record<string, Partial<StatementRow>> = {
      [READY]: { file_name: 'ready.pdf', statement_number: 'ST-1' },
      [FLAGGED]: { file_name: 'flagged.pdf' },
      [CLOSED]: { file_name: 'closed.pdf', status: 'verified' },
      [BROKEN]: { file_name: 'broken.pdf' },
    }
    const row = (id: string) => statementRow({ status: 'review_required', tenant_id: TENANT, unit_id: UNIT, lease_id: LEASE, id, ...rows[id] })
    const idOf = (query: { calls: [string, unknown[]][] }, column: string) =>
      query.calls.find(([method, args]) => method === 'eq' && args[0] === column)?.[1][1] as string | undefined
    // The statement whose extraction was read last: its fields are read next.
    let extracting: string | undefined
    const database = fakeDb((query) => {
      if (query.table === 'rpc:verify_statement') {
        const id = rpcArgs(query).p_statement_id
        if (id === BROKEN) return { data: null, error: { code: 'XX000', message: 'connection lost' } }
        return { data: id, error: null }
      }
      switch (query.table) {
        case 'statements': {
          const listed = query.calls.find(([method]) => method === 'in')
          if (listed) return { data: (listed[1][1] as string[]).filter((id) => id in rows).map(row), error: null }
          return { data: row(idOf(query, 'id')!), error: null }
        }
        case 'statement_extractions':
          if (query.calls.some(([method]) => method === 'in')) return { data: [], error: null }
          extracting = idOf(query, 'statement_id')
          return { data: extractionRow({ statement_id: extracting! }), error: null }
        case 'statement_extraction_fields':
          return { data: resolvedFields(extracting === FLAGGED ? { total_due: { flagged: true } } : {}), error: null }
        case 'statement_line_items':
          return { data: [], error: null }
        case 'leases':
          return { data: { id: LEASE, reference: 'MSQ-L012', status: 'active', commencement_date: '2026-01-01', expiry_date: '2030-12-31' }, error: null }
        default:
          throw new Error(`Unexpected table ${query.table}`)
      }
    })
    const enqueue = vi.fn(async () => 'job')
    const service = new StatementVerificationService(new StatementsService(), { enqueue } as unknown as QueueProducer)
    const rpcs = () => database.queries.filter((query) => query.table.startsWith('rpc:')).map((query) => rpcArgs(query).p_statement_id)
    return { service, db: database.client, rpcs, enqueue }
  }

  it('verifies each statement on its own and names every one it did not verify, with every reason', async () => {
    const { service, db, rpcs, enqueue } = batch()
    const result = await service.verifyMany(db, COMPANY, { statementIds: [FLAGGED, READY, CLOSED, MISSING, BROKEN] })

    expect(result.verified).toEqual([{ statementId: READY, fileName: 'ready.pdf', statementNumber: 'ST-1', monitoringQueued: true }])
    expect(result.notVerified).toEqual([
      { statementId: FLAGGED, fileName: 'flagged.pdf', reasons: ['The total due is flagged: confirm or correct it'] },
      { statementId: CLOSED, fileName: 'closed.pdf', reasons: ['The statement is verified; only a statement under review can be verified'] },
      { statementId: MISSING, reasons: ['The statement was not found in this workspace'] },
      { statementId: BROKEN, fileName: 'broken.pdf', reasons: ['The statement could not be verified just now: try again'] },
    ])
    // One database call per statement that passed its checks: each verified (and audited) on its own.
    expect(rpcs()).toEqual([READY, BROKEN])
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith('statement-monitoring', { companyId: COMPANY, statementId: READY })
  })

  it('keeps going after a refusal: statements after it are still verified', async () => {
    const { service, db, rpcs } = batch()
    const result = await service.verifyMany(db, COMPANY, { statementIds: [CLOSED, READY] })
    expect(result.verified.map((entry) => entry.statementId)).toEqual([READY])
    expect(rpcs()).toEqual([READY])
  })

  it('takes one to a hundred distinct statement ids', () => {
    expect(verifyStatementsBodySchema.safeParse({ statementIds: [] }).success).toBe(false)
    expect(verifyStatementsBodySchema.safeParse({ statementIds: [READY, READY.toUpperCase()] }).success).toBe(false)
    expect(verifyStatementsBodySchema.safeParse({ statementIds: ['nope'] }).success).toBe(false)
    expect(verifyStatementsBodySchema.safeParse({ statementIds: Array.from({ length: 101 }, () => READY) }).success).toBe(false)
    expect(verifyStatementsBodySchema.parse({ statementIds: [READY, FLAGGED] })).toEqual({ statementIds: [READY, FLAGGED] })
  })
})
