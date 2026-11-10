import { ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { EnqueueResult, QueueProducer } from '../../infrastructure/queues/queue-producer'
import { registrationPinKey } from '../../infrastructure/whatsapp/registration-pins'
import { WhatsAppNumbersService } from './whatsapp-numbers.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const NUMBER = '7a1d2c1e-0000-4000-8000-000000000009'

function harness(
  answer: (query: RecordedQuery) => FakeResult,
  outcome: EnqueueResult['outcome'] = 'added',
  redisFails = false,
  running = false,
) {
  const db = fakeDb(answer)
  const redisValues = new Map<string, { value: string; ttl: number }>()
  const redis = {
    set: vi.fn(async (key: string, value: string, _mode: 'EX', ttl: number) => {
      if (redisFails) throw new Error('redis down')
      redisValues.set(key, { value, ttl })
      return 'OK'
    }),
    getdel: vi.fn(),
  }
  const enqueueOrRetry = vi.fn(async (): Promise<EnqueueResult> => ({ jobId: 'job', outcome }))
  const isRunning = vi.fn(async () => running)
  const queues = { enqueueOrRetry, isRunning, redis: () => redis } as unknown as QueueProducer
  const service = new WhatsAppNumbersService(queues, { QUEUE_PREFIX: 'lg' })
  return { service, db, enqueueOrRetry, isRunning, redisValues }
}

const numberRow = (extra: Record<string, unknown> = {}): FakeResult => ({
  data: { id: NUMBER, connection_status: 'pending_verification', registration_blocked_until: null, ...extra },
  error: null,
})

describe('WhatsAppNumbersService.verify', () => {
  it("queues the number's verification once per number, for the company only", async () => {
    const { service, db, enqueueOrRetry } = harness(() => numberRow({ connection_status: 'error' }))
    await expect(service.verify(db.client, COMPANY, NUMBER)).resolves.toMatchObject({ numberId: NUMBER, status: 'queued' })
    expect(enqueueOrRetry).toHaveBeenCalledWith('whatsapp-number-verification', { companyId: COMPANY, numberId: NUMBER })
    expect(callsTo(db.queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', NUMBER],
    ])
  })

  it('reports a run already waiting instead of starting another', async () => {
    const { service, db } = harness(() => numberRow(), 'already_queued')
    await expect(service.verify(db.client, COMPANY, NUMBER)).resolves.toMatchObject({ status: 'already_running' })
  })

  it('refuses a number of another company and a disconnected number', async () => {
    const missing = harness(() => ({ data: null, error: null }))
    await expect(missing.service.verify(missing.db.client, COMPANY, NUMBER)).rejects.toBeInstanceOf(NotFoundException)
    const disconnected = harness(() => numberRow({ connection_status: 'disconnected' }))
    await expect(disconnected.service.verify(disconnected.db.client, COMPANY, NUMBER)).rejects.toBeInstanceOf(ConflictException)
    expect(missing.enqueueOrRetry).not.toHaveBeenCalled()
    expect(disconnected.enqueueOrRetry).not.toHaveBeenCalled()
  })
})

describe('WhatsAppNumbersService.register', () => {
  it('hands the PIN to the worker through a short-lived key, never through the job', async () => {
    const { service, db, enqueueOrRetry, redisValues } = harness(() => numberRow())
    const result = await service.register(db.client, COMPANY, NUMBER, '123456')
    expect(result).toMatchObject({ status: 'queued' })
    expect(redisValues.get(registrationPinKey('lg', COMPANY, NUMBER))).toEqual({ value: '123456', ttl: 600 })
    expect(JSON.stringify(enqueueOrRetry.mock.calls)).not.toContain('123456')
    expect(JSON.stringify(result)).not.toContain('123456')
  })

  it("refuses with 429 while Meta's registration lock lasts, so nothing reaches Meta", async () => {
    const until = new Date(Date.now() + 3600_000).toISOString()
    const { service, db, enqueueOrRetry, redisValues } = harness(() => numberRow({ registration_blocked_until: until }))
    const error = await service.register(db.client, COMPANY, NUMBER, '123456').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpException)
    expect((error as HttpException).getStatus()).toBe(429)
    expect(JSON.stringify((error as HttpException).getResponse())).toContain('locked registration')
    expect(enqueueOrRetry).not.toHaveBeenCalled()
    expect(redisValues.size).toBe(0)
  })

  it('refuses with 409 and stores no PIN while a verification run is in progress', async () => {
    // The run may already be past the registration step and would never read the PIN (it would expire unused).
    const { service, db, enqueueOrRetry, isRunning, redisValues } = harness(() => numberRow(), 'already_queued', false, true)
    const error = await service.register(db.client, COMPANY, NUMBER, '123456').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).message).toContain('still verifying')
    expect(isRunning).toHaveBeenCalledWith('whatsapp-number-verification', { companyId: COMPANY, numberId: NUMBER })
    expect(redisValues.size).toBe(0)
    expect(enqueueOrRetry).not.toHaveBeenCalled()
  })

  it('hands the PIN to a run that is waiting and has not started yet', async () => {
    const { service, db, redisValues } = harness(() => numberRow(), 'already_queued')
    await expect(service.register(db.client, COMPANY, NUMBER, '123456')).resolves.toMatchObject({ status: 'already_running' })
    expect(redisValues.size).toBe(1)
  })

  it('allows a new attempt once the lock has ended', async () => {
    const { service, db } = harness(() => numberRow({ registration_blocked_until: new Date(Date.now() - 1000).toISOString() }))
    await expect(service.register(db.client, COMPANY, NUMBER, '123456')).resolves.toMatchObject({ status: 'queued' })
  })

  it('refuses a connected or disconnected number, and reports Redis being down as 503', async () => {
    for (const status of ['connected', 'disconnected']) {
      const h = harness(() => numberRow({ connection_status: status }))
      await expect(h.service.register(h.db.client, COMPANY, NUMBER, '123456')).rejects.toBeInstanceOf(ConflictException)
    }
    const down = harness(() => numberRow(), 'added', true)
    const error = await down.service.register(down.db.client, COMPANY, NUMBER, '123456').catch((e: unknown) => e)
    expect((error as HttpException).getStatus()).toBe(503)
    expect(down.enqueueOrRetry).not.toHaveBeenCalled()
  })
})

describe('WhatsAppNumbersService.disconnect', () => {
  it('disconnects through the database function and says whether the token was deleted', async () => {
    const { service, db } = harness(() => ({ data: [{ outcome: 'disconnected', token_removed: true }], error: null }))
    await expect(service.disconnect(db.client, COMPANY, NUMBER)).resolves.toMatchObject({ status: 'disconnected', tokenRemoved: true })
    expect(db.queries[0]?.table).toBe('rpc:disconnect_whatsapp_number')
    expect(db.queries[0]?.calls[0]?.[1]?.[0]).toEqual({ p_company_id: COMPANY, p_number_id: NUMBER })

    const kept = harness(() => ({ data: [{ outcome: 'disconnected', token_removed: false }], error: null }))
    await expect(kept.service.disconnect(kept.db.client, COMPANY, NUMBER)).resolves.toMatchObject({
      tokenRemoved: false,
      message: expect.stringContaining('another number of this workspace still uses it'),
    })
  })

  it('maps a number that is not the company\'s to 404 and an unavailable database to 503', async () => {
    const missing = harness(() => ({ data: [{ outcome: 'not_found', token_removed: false }], error: null }))
    await expect(missing.service.disconnect(missing.db.client, COMPANY, NUMBER)).rejects.toBeInstanceOf(NotFoundException)
    const down = harness(() => ({ data: null, error: { code: 'PGRST000', message: 'connection refused' } }))
    await expect(down.service.disconnect(down.db.client, COMPANY, NUMBER)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})

describe('WhatsAppNumbersService.listTemplates', () => {
  it("lists the company's synced templates with category, language and status", async () => {
    const { service, db } = harness(() => ({
      data: [
        {
          id: 't1',
          business_account_id: '771001',
          meta_template_id: '9001',
          name: 'monthly_statement',
          language: 'en_ZA',
          category: 'UTILITY',
          status: 'APPROVED',
          rejected_reason: null,
          synced_at: '2026-11-10T08:00:00Z',
        },
      ],
      error: null,
    }))
    await expect(service.listTemplates(db.client, COMPANY)).resolves.toEqual([
      {
        id: 't1',
        businessAccountId: '771001',
        metaTemplateId: '9001',
        name: 'monthly_statement',
        language: 'en_ZA',
        category: 'UTILITY',
        status: 'APPROVED',
        syncedAt: '2026-11-10T08:00:00Z',
      },
    ])
    expect(callsTo(db.queries[0]!, 'eq')).toEqual([['company_id', COMPANY]])
  })
})

describe('WhatsAppNumbersService.verifyAfterSignup', () => {
  it('queues the signed-up number and never throws', async () => {
    const ok = harness(() => ({ data: { id: NUMBER }, error: null }))
    await expect(ok.service.verifyAfterSignup(ok.db.client, COMPANY, '660001')).resolves.toBe(true)
    expect(ok.enqueueOrRetry).toHaveBeenCalledWith('whatsapp-number-verification', { companyId: COMPANY, numberId: NUMBER })
    const failing = harness(() => ({ data: { id: NUMBER }, error: null }))
    failing.enqueueOrRetry.mockRejectedValueOnce(new ServiceUnavailableException('redis down'))
    await expect(failing.service.verifyAfterSignup(failing.db.client, COMPANY, '660001')).resolves.toBe(false)
  })
})
