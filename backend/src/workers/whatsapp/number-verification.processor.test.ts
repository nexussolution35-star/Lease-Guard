import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import { WorkerDatabaseError } from '../shared/db'
import { DatabaseVerificationStore } from './number-verification.processor'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const NUMBER = '7a1d2c1e-0000-4000-8000-000000000009'
const NOW = new Date('2026-11-10T10:00:00Z')

function store(answer: (query: RecordedQuery) => FakeResult) {
  const db = fakeDb(answer)
  return { store: new DatabaseVerificationStore(db.client, () => NOW), queries: db.queries }
}

describe('DatabaseVerificationStore', () => {
  it("loads the company's number, whether it was imported and whether its signup was a WhatsApp Business app number", async () => {
    const { store: s, queries } = store((q) =>
      q.table === 'whatsapp_phone_numbers'
        ? {
            data: { connection_status: 'pending_verification', registration_blocked_until: '2026-11-12T10:00:00Z', phone_number_id: '660001', operator_imported_at: null },
            error: null,
          }
        : { data: { is_on_business_app: true }, error: null },
    )
    await expect(s.load(COMPANY, NUMBER)).resolves.toEqual({
      connectionStatus: 'pending_verification',
      registrationBlockedUntil: new Date('2026-11-12T10:00:00Z'),
      onBusinessApp: true,
      importedByOperator: false,
    })
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', NUMBER],
    ])
    expect(callsTo(queries[1]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['phone_number_id', '660001'],
    ])
  })

  it('knows a number a Nexus operator imported', async () => {
    const { store: s } = store((q) =>
      q.table === 'whatsapp_phone_numbers'
        ? {
            data: { connection_status: 'pending_verification', registration_blocked_until: null, phone_number_id: '660001', operator_imported_at: '2026-11-11T08:00:00Z' },
            error: null,
          }
        : { data: null, error: null },
    )
    await expect(s.load(COMPANY, NUMBER)).resolves.toMatchObject({ importedByOperator: true, onBusinessApp: false })
  })

  it('records steps by number and step, with the check time', async () => {
    const { store: s, queries } = store(() => ({ data: null, error: null }))
    await s.recordSteps(COMPANY, NUMBER, [{ step: 'registration', status: 'action_needed', message: 'Enter a PIN', recovery: 'Click Register number' }])
    expect(queries[0]?.table).toBe('whatsapp_number_verification_steps')
    expect(callsTo(queries[0]!, 'upsert')).toEqual([
      [
        [
          {
            company_id: COMPANY,
            number_id: NUMBER,
            step: 'registration',
            status: 'action_needed',
            message: 'Enter a PIN',
            recovery: 'Click Register number',
            meta_error_code: null,
            checked_at: NOW.toISOString(),
          },
        ],
        { onConflict: 'number_id,step' },
      ],
    ])
  })

  it('syncs templates and finishes through the service-role functions', async () => {
    const { store: s, queries } = store((q) => (q.table === 'rpc:finish_whatsapp_number_verification' ? { data: 'connected', error: null } : { data: 1, error: null }))
    await expect(
      s.syncTemplates(COMPANY, '771001', [{ id: '9001', name: 'monthly_statement', language: 'en_ZA', category: 'UTILITY', status: 'APPROVED' }]),
    ).resolves.toBe(1)
    await expect(s.finish(COMPANY, NUMBER)).resolves.toBe('connected')
    expect(queries[0]?.calls[0]?.[1]?.[0]).toEqual({
      p_company_id: COMPANY,
      p_business_account_id: '771001',
      p_templates: [{ id: '9001', name: 'monthly_statement', language: 'en_ZA', category: 'UTILITY', status: 'APPROVED', rejected_reason: null }],
    })
    expect(queries[1]?.calls[0]?.[1]?.[0]).toEqual({ p_company_id: COMPANY, p_number_id: NUMBER })
  })

  it('throws a retryable database error', async () => {
    const { store: s } = store(() => ({ data: null, error: { code: 'PGRST000', message: 'down' } }))
    await expect(s.load(COMPANY, NUMBER)).rejects.toBeInstanceOf(WorkerDatabaseError)
  })
})
