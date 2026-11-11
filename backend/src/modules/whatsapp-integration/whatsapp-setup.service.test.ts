import { ConflictException, HttpException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'
import { WHATSAPP_SETUP_STEPS } from '@leaseguard/domain'
import { describe, expect, it, vi } from 'vitest'

import { fakeDb, type FakeResult, type RecordedQuery, rpcArgs } from '../../common/testing/fake-db.test-helpers'
import type { QueueProducer } from '../../infrastructure/queues/queue-producer'
import { WhatsAppSetupService } from './whatsapp-setup.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const NUMBER = '7a1d2c1e-0000-4000-8000-000000000009'
const TEMPLATE = '8a1d2c1e-0000-4000-8000-000000000001'
const TEST = '9a1d2c1e-0000-4000-8000-000000000001'
const ADMIN = '10000000-0000-4000-8000-000000000001'

const REQUIRED = new Set(['business_profile', 'meta_account', 'business_account', 'phone_number', 'webhook', 'message_templates', 'test_message', 'ready_for_activation'])
const stepRows = (state: (step: string) => string) =>
  WHATSAPP_SETUP_STEPS.map((step, i) => ({ step, step_order: i + 1, required: REQUIRED.has(step), state: state(step) }))

const testRow = {
  id: TEST,
  number_id: NUMBER,
  template_name: 'hello_world',
  template_language: 'en_US',
  to_number: '+27829990001',
  status: 'delivered',
  failure_reason: null,
  may_have_been_sent: false,
  requested_by_user_id: ADMIN,
  created_at: '2026-11-11T08:00:00+00:00',
  sent_at: '2026-11-11T08:00:01+00:00',
  delivered_at: '2026-11-11T08:00:03+00:00',
  read_at: null,
  failed_at: null,
}

function harness(answer: (query: RecordedQuery) => FakeResult, enqueueFails = false) {
  const db = fakeDb(answer)
  const enqueue = vi.fn(async () => {
    if (enqueueFails) throw new ServiceUnavailableException('Background processing is not available; try again shortly')
    return 'job'
  })
  const service = new WhatsAppSetupService({ enqueue } as unknown as QueueProducer)
  return { service, db, enqueue }
}

describe('WhatsAppSetupService.status', () => {
  it('reports the ten steps the database verified, with guidance, the activation and (for admins) the latest test message', async () => {
    const { service, db } = harness((q) => {
      if (q.table === 'rpc:whatsapp_setup_status') return { data: stepRows((s) => (s === 'ai_agent' ? 'action_needed' : 'done')), error: null }
      if (q.table === 'companies') return { data: { whatsapp_activated_at: '2026-11-11T09:00:00+00:00', whatsapp_activated_by_user_id: ADMIN }, error: null }
      return { data: testRow, error: null }
    })
    const setup = await service.status(db.client, { companyId: COMPANY, role: 'company_admin' })
    expect(rpcArgs(db.queries[0]!)).toEqual({ p_company_id: COMPANY })
    expect(setup).toMatchObject({ completedSteps: 9, totalSteps: 10, readyForActivation: true })
    expect(setup.activation).toEqual({ active: true, activatedAt: '2026-11-11T09:00:00+00:00', activatedByUserId: ADMIN })
    expect(setup.steps[6]).toMatchObject({ step: 'ai_agent', required: false, state: 'action_needed', title: 'AI agent configured' })
    expect(setup.latestTestMessage).toMatchObject({ id: TEST, status: 'delivered', toNumber: '+27829990001', deliveredAt: '2026-11-11T08:00:03+00:00' })
  })

  it('does not read test messages for members who are not admins', async () => {
    const { service, db } = harness((q) => {
      if (q.table === 'rpc:whatsapp_setup_status') return { data: stepRows(() => 'action_needed'), error: null }
      return { data: { whatsapp_activated_at: null, whatsapp_activated_by_user_id: null }, error: null }
    })
    const setup = await service.status(db.client, { companyId: COMPANY, role: 'read_only' })
    expect(db.queries.map((q) => q.table)).not.toContain('whatsapp_test_messages')
    expect(setup.latestTestMessage).toBeUndefined()
    expect(setup.activation).toEqual({ active: false })
    expect(setup.readyForActivation).toBe(false)
  })
})

describe('WhatsAppSetupService.sendTestMessage', () => {
  const body = { numberId: NUMBER, templateId: TEMPLATE, to: '+27829990001' }

  it('records the request and queues the send once', async () => {
    const { service, db, enqueue } = harness((q) =>
      q.table === 'rpc:request_whatsapp_test_message' ? { data: [{ outcome: 'created', test_message_id: TEST }], error: null } : { data: { ...testRow, status: 'queued', delivered_at: null, sent_at: null }, error: null },
    )
    const result = await service.sendTestMessage(db.client, COMPANY, body)
    expect(rpcArgs(db.queries[0]!)).toEqual({ p_company_id: COMPANY, p_number_id: NUMBER, p_template_id: TEMPLATE, p_to_number: '+27829990001' })
    expect(enqueue).toHaveBeenCalledWith('whatsapp-test-message', { companyId: COMPANY, testMessageId: TEST })
    expect(result).toMatchObject({ id: TEST, status: 'queued' })
  })

  it.each([
    ['number_not_found', NotFoundException],
    ['template_not_found', NotFoundException],
    ['number_not_connected', ConflictException],
    ['template_not_approved', UnprocessableEntityException],
    ['tenant', UnprocessableEntityException],
  ])('refuses %s without queueing anything', async (outcome, error) => {
    const { service, db, enqueue } = harness(() => ({ data: [{ outcome, test_message_id: null }], error: null }))
    await expect(service.sendTestMessage(db.client, COMPANY, body)).rejects.toBeInstanceOf(error)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('answers 429 when the company sent too many test messages this hour', async () => {
    const { service, db } = harness(() => ({ data: [{ outcome: 'rate_limited', test_message_id: null }], error: null }))
    const error: unknown = await service.sendTestMessage(db.client, COMPANY, body).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpException)
    expect((error as HttpException).getStatus()).toBe(429)
  })

  it('marks the test message failed and answers 503 when the worker cannot be reached', async () => {
    const { service, db } = harness(
      (q) => (q.table === 'rpc:request_whatsapp_test_message' ? { data: [{ outcome: 'created', test_message_id: TEST }], error: null } : { data: true, error: null }),
      true,
    )
    await expect(service.sendTestMessage(db.client, COMPANY, body)).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(db.queries.at(-1)?.table).toBe('rpc:abandon_whatsapp_test_message')
    expect(rpcArgs(db.queries.at(-1)!)).toMatchObject({ p_company_id: COMPANY, p_test_message_id: TEST })
  })
})

describe('WhatsAppSetupService.activate', () => {
  it('activates when the database agrees every required step is verified', async () => {
    const { service, db } = harness((q) => {
      if (q.table === 'rpc:activate_company_whatsapp') return { data: 'activated', error: null }
      return { data: { whatsapp_activated_at: '2026-11-11T09:00:00+00:00', whatsapp_activated_by_user_id: ADMIN }, error: null }
    })
    await expect(service.activate(db.client, COMPANY)).resolves.toEqual({ active: true, activatedAt: '2026-11-11T09:00:00+00:00', activatedByUserId: ADMIN })
  })

  it('refuses with 409 while a required step is not verified', async () => {
    const { service, db } = harness(() => ({ data: 'not_ready', error: null }))
    await expect(service.activate(db.client, COMPANY)).rejects.toBeInstanceOf(ConflictException)
  })

  it('deactivates', async () => {
    const { service, db } = harness((q) => (q.table === 'rpc:deactivate_company_whatsapp' ? { data: true, error: null } : { data: { whatsapp_activated_at: null, whatsapp_activated_by_user_id: null }, error: null }))
    await expect(service.deactivate(db.client, COMPANY)).resolves.toEqual({ active: false })
  })
})
