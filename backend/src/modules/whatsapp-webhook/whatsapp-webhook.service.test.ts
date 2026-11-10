import { createHmac } from 'node:crypto'
import { BadRequestException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { EnqueueResult, QueueProducer } from '../../infrastructure/queues/queue-producer'
import { WhatsAppWebhookService } from './whatsapp-webhook.service'

const SECRET = 'test-app-secret'
const VERIFY = 'test-verify-token'
const AT = new Date('2026-11-10T08:00:00.000Z')
const payload = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [] }] }))
const sign = (raw: Buffer, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`

function service(env: { WHATSAPP_APP_SECRET?: string; WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string } = { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY }) {
  const enqueueOrRetry = vi.fn(async (): Promise<EnqueueResult> => ({ jobId: 'job-id', outcome: 'added' }))
  // No plain `enqueue`: a redelivered body must revive its failed job, which only enqueueOrRetry does.
  const queues = { enqueueOrRetry } as unknown as QueueProducer
  return { webhook: new WhatsAppWebhookService(env, queues), enqueue: enqueueOrRetry }
}

describe('WhatsAppWebhookService.verifySubscription', () => {
  it("echoes Meta's challenge for the right verify token", () => {
    expect(service().webhook.verifySubscription({ mode: 'subscribe', verifyToken: VERIFY, challenge: '1158201444' })).toBe('1158201444')
  })

  it('refuses a wrong token or mode, an unsafe challenge, and answers 503 when not configured', () => {
    const { webhook } = service()
    expect(() => webhook.verifySubscription({ mode: 'subscribe', verifyToken: 'wrong', challenge: '1' })).toThrow(ForbiddenException)
    expect(() => webhook.verifySubscription({ mode: 'unsubscribe', verifyToken: VERIFY, challenge: '1' })).toThrow(ForbiddenException)
    expect(() => webhook.verifySubscription({ mode: 'subscribe', challenge: '1' })).toThrow(ForbiddenException)
    expect(() => webhook.verifySubscription({ mode: 'subscribe', verifyToken: VERIFY, challenge: '<script>' })).toThrow(BadRequestException)
    expect(() => service({}).webhook.verifySubscription({ mode: 'subscribe', verifyToken: VERIFY, challenge: '1' })).toThrow(ServiceUnavailableException)
  })
})

describe('WhatsAppWebhookService.receive', () => {
  it('queues a signed WhatsApp payload unchanged, keyed by the SHA-256 of its raw bytes', async () => {
    const { webhook, enqueue } = service()
    await expect(webhook.receive(payload, sign(payload), AT)).resolves.toEqual({ received: true, queued: true })
    expect(enqueue).toHaveBeenCalledWith('whatsapp-webhook', {
      payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      body: payload.toString('utf8'),
      receivedAt: AT.toISOString(),
    })
  })

  it('gives the same job key to the same body delivered twice (Meta retries)', async () => {
    const { webhook, enqueue } = service()
    await webhook.receive(payload, sign(payload), AT)
    await webhook.receive(Buffer.from(payload), sign(payload), new Date())
    const keys = enqueue.mock.calls.map((call) => (call as unknown as [string, { payloadSha256: string }])[1].payloadSha256)
    expect(new Set(keys).size).toBe(1)
  })

  it("revives the failed job of a body Meta delivers again, so an acknowledged payload is not lost", async () => {
    const { webhook, enqueue } = service()
    enqueue.mockResolvedValueOnce({ jobId: 'job-id', outcome: 'retried', failedReason: 'database unavailable' })
    await expect(webhook.receive(payload, sign(payload), AT)).resolves.toEqual({ received: true, queued: true })
    // No retry policy: every failure of this job may run again (the worker skips an event already processed).
    expect(enqueue).toHaveBeenCalledWith('whatsapp-webhook', expect.objectContaining({ body: payload.toString('utf8') }))
    expect(enqueue.mock.calls[0]).toHaveLength(2)
  })

  it('rejects unsigned, tampered and wrongly signed requests before parsing, and queues nothing', async () => {
    const { webhook, enqueue } = service()
    const tampered = Buffer.from(payload.toString().replace('"1"', '"2"'))
    await expect(webhook.receive(payload, undefined)).rejects.toBeInstanceOf(UnauthorizedException)
    await expect(webhook.receive(tampered, sign(payload))).rejects.toBeInstanceOf(UnauthorizedException)
    await expect(webhook.receive(payload, sign(payload, 'other-secret'))).rejects.toBeInstanceOf(UnauthorizedException)
    await expect(webhook.receive({ object: 'whatsapp_business_account' }, sign(payload))).rejects.toBeInstanceOf(UnauthorizedException)
    const notJson = Buffer.from('not json')
    await expect(webhook.receive(notJson, sign(notJson))).rejects.toBeInstanceOf(BadRequestException)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('acknowledges a signed payload of another Meta product without queueing it', async () => {
    const { webhook, enqueue } = service()
    const page = Buffer.from(JSON.stringify({ object: 'page', entry: [] }))
    await expect(webhook.receive(page, sign(page))).resolves.toEqual({ received: true, queued: false })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('answers 503 without an app secret, so Meta retries once LeaseGuard is configured', async () => {
    await expect(service({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY }).webhook.receive(payload, sign(payload))).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
