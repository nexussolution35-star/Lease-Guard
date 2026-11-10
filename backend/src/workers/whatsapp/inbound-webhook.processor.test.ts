import { UnrecoverableError } from 'bullmq'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import { FakeWhatsAppChannels } from '../../infrastructure/whatsapp/fake-whatsapp-channels.test-helpers'
import type { ProcessorRuntime } from '../jobs/processor-runtime'
import type { Clock } from '../shared/clock'
import { WorkerDatabaseError } from '../shared/db'
import { DatabaseInboundMessageStore, WhatsAppWebhookProcessor } from './inbound-webhook.processor'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const NUMBER = '7a1d2c1e-0000-4000-8000-000000000009'
const EVENT = '8b1d2c1e-0000-4000-8000-000000000001'
const NOW = new Date('2026-11-10T10:00:00Z')
const SHA = 'a'.repeat(64)
const LAST = { attempt: 5, maxAttempts: 5 }
const FIRST = { attempt: 1, maxAttempts: 5 }

const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: '1110001' },
            contacts: [{ wa_id: '27829990001', profile: { name: 'Ayanda' } }],
            messages: [{ id: 'wamid.1', from: '27829990001', timestamp: '1794297600', type: 'text', text: { body: 'Hi' } }],
          },
        },
      ],
    },
  ],
})

function harness(answer: (query: RecordedQuery) => FakeResult) {
  const db = fakeDb(answer)
  const channels = new FakeWhatsAppChannels({ receivingNumbers: { '1110001': { companyId: COMPANY, numberId: NUMBER } } })
  const processor = new WhatsAppWebhookProcessor(
    {} as ProcessorRuntime,
    { get: () => db.client } as unknown as ServiceRoleClientFactory,
    channels,
    { now: () => NOW } as Clock,
  )
  return { processor, queries: db.queries, channels }
}

const ok = (data: unknown = null): FakeResult => ({ data, error: null })
const job = (payload = body) => ({ payloadSha256: SHA, body: payload, receivedAt: '2026-11-10T09:59:59.000Z' })

describe('WhatsAppWebhookProcessor', () => {
  it('stores the payload once, routes it by receiving number and records the outcome on the event', async () => {
    const { processor, queries } = harness((q) => {
      if (q.table === 'whatsapp_webhook_events' && callsTo(q, 'select').length > 0) return ok({ id: EVENT, processing_status: 'received' })
      if (q.table === 'rpc:record_whatsapp_inbound_message') return ok([{ outcome: 'recorded' }])
      return ok()
    })
    const result = await processor.process(job(), FIRST)
    expect(result).toEqual({
      outcome: 'processed',
      outcomes: [{ field: 'messages', phoneNumberId: '1110001', companyId: COMPANY, messageId: 'wamid.1', outcome: 'recorded' }],
    })

    expect(callsTo(queries[0]!, 'upsert')).toEqual([
      [{ payload_sha256: SHA, payload: JSON.parse(body), received_at: '2026-11-10T09:59:59.000Z' }, { onConflict: 'payload_sha256', ignoreDuplicates: true }],
    ])
    const rpc = queries.find((q) => q.table === 'rpc:record_whatsapp_inbound_message')!
    expect(callsTo(rpc, 'rpc')[0]![0]).toEqual({
      p_company_id: COMPANY,
      p_number_id: NUMBER,
      p_provider_message_id: 'wamid.1',
      p_user_id: null,
      p_wa_id: '27829990001',
      p_profile_name: 'Ayanda',
      p_body: 'Hi',
      p_sent_at: new Date(1794297600 * 1000).toISOString(),
    })
    const update = queries.at(-1)!
    expect(callsTo(update, 'update')[0]![0]).toMatchObject({ processing_status: 'processed', processed_at: NOW.toISOString(), error_message: null })
    expect(callsTo(update, 'eq')).toEqual([['id', EVENT]])
  })

  it('skips a payload whose event was already processed (a re-delivered job)', async () => {
    const { processor, queries } = harness((q) =>
      callsTo(q, 'select').length > 0 ? ok({ id: EVENT, processing_status: 'processed' }) : ok(),
    )
    await expect(processor.process(job(), FIRST)).resolves.toEqual({ outcome: 'already_processed' })
    expect(queries.some((q) => q.table.startsWith('rpc:'))).toBe(false)
  })

  it('retries a transient database failure, and marks the event failed on the last attempt', async () => {
    const failing = (q: RecordedQuery): FakeResult => {
      if (callsTo(q, 'select').length > 0) return ok({ id: EVENT, processing_status: 'received' })
      if (q.table.startsWith('rpc:')) return { data: null, error: { code: '08006', message: 'connection failure' } }
      return ok()
    }
    const early = harness(failing)
    await expect(early.processor.process(job(), FIRST)).rejects.toBeInstanceOf(WorkerDatabaseError)
    expect(early.queries.some((q) => callsTo(q, 'update').length > 0)).toBe(false)

    const last = harness(failing)
    await expect(last.processor.process(job(), LAST)).rejects.toBeInstanceOf(WorkerDatabaseError)
    const update = last.queries.find((q) => callsTo(q, 'update').length > 0)!
    expect(callsTo(update, 'update')[0]![0]).toMatchObject({ processing_status: 'failed', error_message: expect.stringContaining('08006') })
  })

  it('refuses a queued body that is not JSON without retrying', async () => {
    const { processor } = harness(() => ok())
    await expect(processor.process(job('not json'), FIRST)).rejects.toBeInstanceOf(UnrecoverableError)
  })
})

describe('DatabaseInboundMessageStore', () => {
  const message = { providerMessageId: 'wamid.1', userId: 'ZA.1', waId: null, profileName: null, body: 'Hi', sentAt: null }
  const owner = { companyId: COMPANY, numberId: NUMBER }

  it("returns the database's outcome", async () => {
    for (const outcome of ['recorded', 'duplicate', 'unknown_number'] as const) {
      const db = fakeDb(() => ok([{ outcome }]))
      await expect(new DatabaseInboundMessageStore(db.client).record(owner, message)).resolves.toBe(outcome)
    }
  })

  it('treats input the function refuses as invalid (no retry) and anything else as a retryable failure', async () => {
    const refused = fakeDb(() => ({ data: null, error: { code: '22023', message: 'a WhatsApp message id is required' } }))
    await expect(new DatabaseInboundMessageStore(refused.client).record(owner, message)).resolves.toBe('invalid')
    const down = fakeDb(() => ({ data: null, error: { code: 'PGRST000', message: 'connection refused' } }))
    await expect(new DatabaseInboundMessageStore(down.client).record(owner, message)).rejects.toBeInstanceOf(WorkerDatabaseError)
  })
})
