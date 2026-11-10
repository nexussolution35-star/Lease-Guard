import { UnrecoverableError } from 'bullmq'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import { FakeWhatsAppChannels } from '../../infrastructure/whatsapp/fake-whatsapp-channels.test-helpers'
import type { ProcessorRuntime } from '../jobs/processor-runtime'
import type { Clock } from '../shared/clock'
import { WorkerDatabaseError } from '../shared/db'
import type { WorkerEnv } from '../../config/env'
import { WhatsAppApiError } from '../../infrastructure/whatsapp/whatsapp-channels'
import { DatabaseAccountEventStore, DatabaseInboundMessageStore, StatusesNotYetRecordedError, WhatsAppWebhookProcessor } from './inbound-webhook.processor'

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
    { WHATSAPP_APP_ID: '1234' } as WorkerEnv,
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

const statusBody = (timestamp: number) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1110001' }, statuses: [{ id: 'wamid.OUT', status: 'delivered', timestamp: String(timestamp) }] } }],
      },
    ],
  })
const stored = (q: RecordedQuery) => q.table === 'whatsapp_webhook_events' && callsTo(q, 'select').length > 0

describe('WhatsAppWebhookProcessor: delivery statuses', () => {
  it("applies a status through the lifecycle to the receiving number's company", async () => {
    const { processor, queries } = harness((q) => {
      if (stored(q)) return ok({ id: EVENT, processing_status: 'received' })
      if (q.table === 'rpc:record_communication_provider_status') return ok('advanced')
      return ok()
    })
    const result = await processor.process(job(statusBody(NOW.getTime() / 1000 - 5)), FIRST)
    expect(result).toMatchObject({ outcome: 'processed', outcomes: [{ companyId: COMPANY, statusId: 'wamid.OUT', status: 'delivered', outcome: 'advanced' }] })
    const rpc = queries.find((q) => q.table === 'rpc:record_communication_provider_status')!
    expect(callsTo(rpc, 'rpc')[0]![0]).toEqual({
      p_company_id: COMPANY,
      p_provider_message_id: 'wamid.OUT',
      p_status: 'delivered',
      p_occurred_at: new Date(NOW.getTime() - 5000).toISOString(),
    })
  })

  it('retries a recent status whose message is not recorded yet (the status overtook the send), without finishing the event', async () => {
    const { processor, queries } = harness((q) => {
      if (stored(q)) return ok({ id: EVENT, processing_status: 'received' })
      if (q.table === 'rpc:record_communication_provider_status') return ok('not_found')
      return ok()
    })
    await expect(processor.process(job(statusBody(NOW.getTime() / 1000 - 5)), FIRST)).rejects.toBeInstanceOf(StatusesNotYetRecordedError)
    expect(queries.some((q) => callsTo(q, 'update').length > 0)).toBe(false)
  })

  it('records the status as not found on the last attempt, and at once for a status too old to be waiting for its send', async () => {
    const answer = (q: RecordedQuery): FakeResult => {
      if (stored(q)) return ok({ id: EVENT, processing_status: 'received' })
      if (q.table === 'rpc:record_communication_provider_status') return ok('not_found')
      return ok()
    }
    await expect(harness(answer).processor.process(job(statusBody(NOW.getTime() / 1000 - 5)), LAST)).resolves.toMatchObject({
      outcome: 'processed',
      outcomes: [{ outcome: 'not_found' }],
    })
    await expect(harness(answer).processor.process(job(statusBody(NOW.getTime() / 1000 - 3600)), FIRST)).resolves.toMatchObject({
      outcome: 'processed',
      outcomes: [{ outcome: 'not_found' }],
    })
  })
})

describe('WhatsAppWebhookProcessor: account events', () => {
  it('disconnects the account on an uninstall of this app, with the entry time', async () => {
    const uninstall = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '771001', time: 1794297600, changes: [{ field: 'account_update', value: { event: 'PARTNER_APP_UNINSTALLED', waba_info: { waba_id: '771001', partner_app_id: '1234' } } }] }],
    })
    const { processor, queries } = harness((q) => {
      if (stored(q)) return ok({ id: EVENT, processing_status: 'received' })
      if (q.table === 'rpc:remove_whatsapp_business_account_access') {
        return ok([{ company_id: COMPANY, numbers_disconnected: 1, token_removed: true, admins_notified: 1 }])
      }
      return ok()
    })
    const result = await processor.process(job(uninstall), FIRST)
    expect(result).toMatchObject({ outcome: 'processed', outcomes: [{ companyId: COMPANY, outcome: 'disconnected', tokenRemoved: true, adminsNotified: 1 }] })
    const rpc = queries.find((q) => q.table === 'rpc:remove_whatsapp_business_account_access')!
    expect(callsTo(rpc, 'rpc')[0]![0]).toEqual({
      p_business_account_id: '771001',
      p_event: 'PARTNER_APP_UNINSTALLED',
      p_occurred_at: new Date(1794297600 * 1000).toISOString(),
    })
  })
})

describe('DatabaseAccountEventStore', () => {
  const OTHER_NUMBER = '7a1d2c1e-0000-4000-8000-000000000010'

  it('passes a template status change to the database and returns its outcome per company', async () => {
    const db = fakeDb(() => ok([{ company_id: COMPANY, outcome: 'updated' }]))
    const store = new DatabaseAccountEventStore(db.client, new FakeWhatsAppChannels())
    const change = { metaTemplateId: '1001', name: 'monthly_statement_v1', language: 'en', category: null, status: 'PAUSED', reason: 'Low quality' }
    await expect(store.applyTemplateStatus('771001', change, NOW)).resolves.toEqual([{ companyId: COMPANY, outcome: 'updated' }])
    expect(callsTo(db.queries[0]!, 'rpc')[0]![0]).toEqual({
      p_business_account_id: '771001',
      p_meta_template_id: '1001',
      p_name: 'monthly_statement_v1',
      p_language: 'en',
      p_category: null,
      p_status: 'PAUSED',
      p_reason: 'Low quality',
      p_occurred_at: NOW.toISOString(),
    })
  })

  it('leaves the event time out of both calls when Meta sent no entry.time, never as an undefined key', async () => {
    // supabase-js drops an undefined key, so PostgREST looked for a signature without it and answered PGRST202; the
    // functions default the time to now when it is left out.
    const db = fakeDb((q) =>
      q.table === 'rpc:remove_whatsapp_business_account_access'
        ? ok([{ company_id: COMPANY, numbers_disconnected: 1, token_removed: false, admins_notified: 1 }])
        : ok([{ company_id: COMPANY, outcome: 'updated' }]),
    )
    const store = new DatabaseAccountEventStore(db.client, new FakeWhatsAppChannels())
    await store.removeAccess('771001', 'PARTNER_REMOVED', null)
    await store.applyTemplateStatus('771001', { metaTemplateId: '1001', name: null, language: null, category: null, status: 'PAUSED', reason: null }, null)
    for (const query of db.queries) {
      const args = callsTo(query, 'rpc')[0]![0] as Record<string, unknown>
      expect(Object.keys(args)).not.toContain('p_occurred_at')
      expect(Object.values(args)).not.toContain(undefined)
    }
  })

  it("reads Meta's view of the holder's numbers again on a quality update and records the messaging limit on the named number", async () => {
    const db = fakeDb((q) => {
      if (q.table === 'rpc:whatsapp_business_account_holders') return ok([{ company_id: COMPANY }])
      if (q.table === 'whatsapp_phone_numbers' && callsTo(q, 'select').length > 0) {
        return ok([
          { id: NUMBER, phone_number_id: '1110001' },
          { id: OTHER_NUMBER, phone_number_id: '1110002' },
        ])
      }
      return ok()
    })
    const channels = new FakeWhatsAppChannels({
      manageNumber: async () => ({
        available: true,
        businessAccountId: '771001',
        phoneNumberId: '1110001',
        inspectToken: async () => null,
        accountPhoneNumbers: async () => [
          { id: '1110001', displayPhoneNumber: '+27 11 555 0101', qualityRating: 'YELLOW', status: 'CONNECTED' },
          { id: '1110002', displayPhoneNumber: '+27 11 555 0102', qualityRating: 'GREEN' },
        ],
        subscribeApp: async () => undefined,
        register: async () => undefined,
        templates: async () => [],
      }),
    })
    const store = new DatabaseAccountEventStore(db.client, channels)
    const results = await store.refreshNumberQuality('771001', { displayPhoneNumber: '27115550101', event: 'DOWNGRADE', messagingLimitTier: 'TIER_250' }, NOW)
    expect(results).toEqual([{ companyId: COMPANY, outcome: 'refreshed', numbers: 2 }])

    const updates = db.queries.filter((q) => q.table === 'whatsapp_phone_numbers' && callsTo(q, 'update').length > 0)
    expect(updates.map((q) => [callsTo(q, 'update')[0]![0], callsTo(q, 'eq'), callsTo(q, 'or')])).toEqual([
      [{ quality_rating: 'YELLOW', meta_status: 'CONNECTED' }, [['company_id', COMPANY], ['id', NUMBER]], []],
      [{ quality_rating: 'GREEN' }, [['company_id', COMPANY], ['id', OTHER_NUMBER]], []],
      // The limit only moves forward in Meta's time: an older event that arrives late does not overwrite it.
      [
        { messaging_limit_tier: 'TIER_250', messaging_limit_updated_at: NOW.toISOString() },
        [['company_id', COMPANY], ['id', NUMBER]],
        [[`messaging_limit_updated_at.is.null,messaging_limit_updated_at.lt.${NOW.toISOString()}`]],
      ],
    ])
  })

  it("reports Meta's view as unavailable without failing when the credential is gone or Meta refuses, and retries when Meta is unreachable", async () => {
    const answer = (q: RecordedQuery): FakeResult => {
      if (q.table === 'rpc:whatsapp_business_account_holders') return ok([{ company_id: COMPANY }])
      if (callsTo(q, 'select').length > 0) return ok([{ id: NUMBER, phone_number_id: '1110001' }])
      return ok()
    }
    const update = { displayPhoneNumber: null, event: 'ONBOARDING', messagingLimitTier: null }
    const gone = new DatabaseAccountEventStore(fakeDb(answer).client, new FakeWhatsAppChannels())
    await expect(gone.refreshNumberQuality('771001', update, NOW)).resolves.toEqual([{ companyId: COMPANY, outcome: 'meta_unavailable', numbers: 0 }])

    const management = (error: WhatsAppApiError) =>
      new FakeWhatsAppChannels({
        manageNumber: async () => ({
          available: true,
          businessAccountId: '771001',
          phoneNumberId: '1110001',
          inspectToken: async () => null,
          accountPhoneNumbers: async () => {
            throw error
          },
          subscribeApp: async () => undefined,
          register: async () => undefined,
          templates: async () => [],
        }),
      })
    const refused = new DatabaseAccountEventStore(fakeDb(answer).client, management(new WhatsAppApiError('Invalid token', { graphCode: 190, retryable: false })))
    await expect(refused.refreshNumberQuality('771001', update, NOW)).resolves.toEqual([{ companyId: COMPANY, outcome: 'meta_unavailable', numbers: 0 }])
    const down = new DatabaseAccountEventStore(fakeDb(answer).client, management(new WhatsAppApiError('Meta unreachable', { retryable: true })))
    await expect(down.refreshNumberQuality('771001', update, NOW)).rejects.toBeInstanceOf(WhatsAppApiError)
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
