import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../common/testing/fake-db.test-helpers'
import { DatabaseNumberImportStore, QueueVerificationStarter } from './number-import-store'

const COMPANY = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
const NUMBER = '7a1d2c1e-0000-4000-8000-000000000009'
const SETTINGS = { accessToken: 'EAAG-the-installation-test-number-token-0123456789', phoneNumberId: '660001', businessAccountId: '771001' }

function store(answer: (query: RecordedQuery) => FakeResult) {
  const db = fakeDb(answer)
  return { store: new DatabaseNumberImportStore(db.client), queries: db.queries }
}

const ROW = {
  outcome: 'new_number',
  applied: true,
  company_name: 'Nexus Solution',
  number_id: NUMBER,
  previous_status: null,
  conflicting_company_id: null,
  conflicting_company_name: null,
  secrets_deleted: 0,
}

describe('DatabaseNumberImportStore', () => {
  it('finds a company by id, or by initials in any case', async () => {
    const { store: s, queries } = store(() => ({ data: [{ id: COMPANY, name: 'Nexus Solution', initials: 'NS', status: 'active' }], error: null }))
    await expect(s.findCompanies(COMPANY.toUpperCase())).resolves.toEqual([{ id: COMPANY, name: 'Nexus Solution', initials: 'NS', status: 'active' }])
    await s.findCompanies('ns')
    expect(queries.map((q) => q.table)).toEqual(['companies', 'companies'])
    expect(callsTo(queries[0]!, 'eq')).toEqual([['id', COMPANY]])
    expect(callsTo(queries[1]!, 'eq')).toEqual([['initials', 'NS']])
  })

  it('plans and applies through import_whatsapp_number with the service role', async () => {
    const { store: s, queries } = store(() => ({ data: [ROW], error: null }))
    await expect(s.importNumber(COMPANY, SETTINGS, true)).resolves.toEqual({
      outcome: 'new_number',
      applied: true,
      companyName: 'Nexus Solution',
      numberId: NUMBER,
      secretsDeleted: 0,
    })
    expect(queries[0]?.table).toBe('rpc:import_whatsapp_number')
    expect(queries[0]?.calls[0]?.[1]?.[0]).toEqual({
      p_company_id: COMPANY,
      p_business_account_id: '771001',
      p_phone_number_id: '660001',
      p_access_token: SETTINGS.accessToken,
      p_apply: true,
    })
  })

  it('names the company that holds the number', async () => {
    const { store: s } = store(() => ({
      data: [{ ...ROW, outcome: 'number_in_use', applied: false, number_id: null, conflicting_company_id: 'c2', conflicting_company_name: 'Kgalagadi' }],
      error: null,
    }))
    await expect(s.importNumber(COMPANY, SETTINGS, false)).resolves.toMatchObject({
      outcome: 'number_in_use',
      conflictingCompany: { id: 'c2', name: 'Kgalagadi' },
    })
  })

  it('throws on a database error or an unknown answer, without the token', async () => {
    const failing = store(() => ({ data: null, error: { code: '22023', message: 'The access token is not a valid token' } }))
    await expect(failing.store.importNumber(COMPANY, SETTINGS, true)).rejects.toThrow(/22023.*not a valid token/)
    const odd = store(() => ({ data: [{ ...ROW, outcome: 'surprise' }], error: null }))
    await expect(odd.store.importNumber(COMPANY, SETTINGS, false)).rejects.toThrow(/unexpected outcome/)
    const empty = store(() => ({ data: [], error: null }))
    await expect(empty.store.importNumber(COMPANY, SETTINGS, false)).rejects.toThrow(/no answer/)
  })
})

describe('QueueVerificationStarter', () => {
  it('queues the number verification job of the company and number', async () => {
    const calls: unknown[] = []
    const starter = new QueueVerificationStarter({
      async enqueueOrRetry(queue, payload) {
        calls.push([queue, payload])
        return { jobId: 'job', outcome: calls.length === 1 ? 'added' : 'already_queued' }
      },
    })
    await expect(starter.start(COMPANY, NUMBER)).resolves.toBe('queued')
    await expect(starter.start(COMPANY, NUMBER)).resolves.toBe('already_running')
    expect(calls[0]).toEqual(['whatsapp-number-verification', { companyId: COMPANY, numberId: NUMBER }])
  })
})
