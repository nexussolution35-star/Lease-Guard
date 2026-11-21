import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { callsTo, fakeDb, rpcArgs, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { EnqueueResult, QueueProducer } from '../../infrastructure/queues/queue-producer'
import { MessageTemplatesService } from './message-templates.service'

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const THANDI = '10000000-0000-4000-8000-000000000001'
const META_ID = '7a1d2c1e-0000-4000-8000-000000000009'

const STATEMENT_BODY = 'Good day {{1}}. Your {{2}} statement is attached.'
const mappingRow = (template: Record<string, unknown> = {}) => ({
  message_type: 'monthly_statement',
  message_template_id: 't1',
  mapped_at: '2026-11-21T10:00:00Z',
  mapped_by_user_id: THANDI,
  template: {
    id: 't1',
    meta_template_name: 'monthly_statement',
    language: 'en_ZA',
    category: 'utility',
    body: STATEMENT_BODY,
    variables: ['Tenant name', 'Statement period'],
    approval_status: 'approved',
    supports_document_attachment: true,
    ...template,
  },
})
const syncedRow = (extra: Record<string, unknown> = {}) => ({
  id: META_ID,
  name: 'monthly_statement',
  language: 'en_ZA',
  status: 'APPROVED',
  rejected_reason: null,
  body: STATEMENT_BODY,
  ...extra,
})

interface Answers {
  mappings?: unknown[]
  synced?: unknown[]
  connected?: number
  candidate?: unknown
  rpc?: FakeResult
  numbers?: unknown[]
}

function harness(answers: Answers = {}, outcome: EnqueueResult['outcome'] = 'added') {
  const db = fakeDb((query: RecordedQuery): FakeResult => {
    switch (query.table) {
      case 'message_type_templates':
        return { data: answers.mappings ?? [], error: null }
      case 'whatsapp_message_templates':
        return callsTo(query, 'maybeSingle').length > 0
          ? { data: answers.candidate ?? null, error: null }
          : { data: answers.synced ?? [], error: null }
      case 'whatsapp_phone_numbers':
        return callsTo(query, 'select')[0]?.[1] ? { data: null, error: null, count: answers.connected ?? 0 } : { data: answers.numbers ?? [], error: null }
      case 'profiles':
        return { data: [{ id: THANDI, full_name: 'Thandi Mokoena' }], error: null }
      case 'rpc:set_message_type_template':
        return answers.rpc ?? { data: 't1', error: null }
      default:
        throw new Error(`unexpected table ${query.table}`)
    }
  })
  const enqueueOrRetry = vi.fn(async (): Promise<EnqueueResult> => ({ jobId: 'job', outcome }))
  const service = new MessageTemplatesService({ enqueueOrRetry } as unknown as QueueProducer)
  return { service, db, enqueueOrRetry }
}

describe('MessageTemplatesService.settings', () => {
  it('lists every templated type with its audience, the tenant types first, unmapped ones not sendable', async () => {
    const { service, db } = harness({ connected: 1 })
    const settings = await service.settings(db.client, COMPANY)
    expect(settings.whatsappConnected).toBe(true)
    expect(settings.types.map((t) => [t.messageType, t.audience, t.sendable])).toEqual([
      ['monthly_statement', 'tenant', false],
      ['initial_payment_reminder', 'tenant', false],
      ['overdue_payment_reminder', 'tenant', false],
      ['follow_up_payment_reminder', 'tenant', false],
      ['arrangement_installment_reminder', 'tenant', false],
      ['owner_weekly_summary', 'property_owner', false],
      ['owner_query_response', 'property_owner', false],
    ])
    for (const query of db.queries.filter((q) => q.table !== 'profiles')) expect(callsTo(query, 'eq')[0]).toEqual(['company_id', COMPANY])
  })

  it("shows the chosen template with Meta's status, who chose it, and sends when approved", async () => {
    const { service, db } = harness({ mappings: [mappingRow()], synced: [syncedRow()], connected: 0 })
    const settings = await service.settings(db.client, COMPANY)
    expect(settings.whatsappConnected).toBe(false)
    expect(settings.types[0]).toEqual({
      messageType: 'monthly_statement',
      audience: 'tenant',
      sendable: true,
      mapping: {
        templateId: 't1',
        whatsappTemplateId: META_ID,
        metaStatus: 'APPROVED',
        metaTemplateName: 'monthly_statement',
        language: 'en_ZA',
        category: 'utility',
        body: STATEMENT_BODY,
        variables: ['Tenant name', 'Statement period'],
        approvalStatus: 'approved',
        supportsDocumentAttachment: true,
        metaBodyChanged: false,
        mappedAt: '2026-11-21T10:00:00Z',
        mappedByUserId: THANDI,
        mappedByName: 'Thandi Mokoena',
      },
    })
  })

  it("does not send a rejected template, nor one whose text Meta changed, and gives Meta's reason", async () => {
    const rejected = harness({
      mappings: [mappingRow({ approval_status: 'rejected' })],
      synced: [syncedRow({ status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' })],
    })
    const type = (await rejected.service.settings(rejected.db.client, COMPANY)).types[0]!
    expect(type.sendable).toBe(false)
    expect(type.mapping).toMatchObject({ metaStatus: 'REJECTED', rejectedReason: 'INVALID_FORMAT' })

    const edited = harness({ mappings: [mappingRow()], synced: [syncedRow({ body: 'Hello {{1}}.' })] })
    const changed = (await edited.service.settings(edited.db.client, COMPANY)).types[0]!
    expect(changed).toMatchObject({ sendable: false, mapping: { metaBodyChanged: true } })
  })
})

describe('MessageTemplatesService.choose', () => {
  const candidate = { id: META_ID, name: 'monthly_statement', language: 'en_ZA', category: 'UTILITY', status: 'APPROVED', body: STATEMENT_BODY, header_format: 'DOCUMENT' }

  it('maps the approved template through the database with the type’s variable names', async () => {
    const { service, db } = harness({ candidate, mappings: [mappingRow()], synced: [syncedRow()] })
    await expect(service.choose(db.client, COMPANY, 'monthly_statement', { whatsappTemplateId: META_ID })).resolves.toMatchObject({
      messageType: 'monthly_statement',
      sendable: true,
    })
    const rpc = db.queries.find((q) => q.table === 'rpc:set_message_type_template')!
    expect(rpcArgs(rpc)).toEqual({
      p_company_id: COMPANY,
      p_message_type: 'monthly_statement',
      p_whatsapp_template_id: META_ID,
      p_variables: ['Tenant name', 'Statement period'],
    })
  })

  it('refuses with every reason before reaching the database', async () => {
    const { service, db } = harness({ candidate: { ...candidate, category: 'MARKETING', status: 'PENDING', body: 'Your lease renewal {{1}}.' } })
    const error = await service.choose(db.client, COMPANY, 'overdue_payment_reminder', { whatsappTemplateId: META_ID }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UnprocessableEntityException)
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      message: [
        expect.stringContaining('Meta has not approved'),
        expect.stringContaining('needs a Utility template'),
        expect.stringContaining('Tenant messages may not mention: renewal option'),
      ],
    })
    expect(db.queries.some((q) => q.table.startsWith('rpc:'))).toBe(false)
  })

  it("404s a template of another company, and names the database's refusals", async () => {
    const missing = harness()
    await expect(missing.service.choose(missing.db.client, COMPANY, 'monthly_statement', { whatsappTemplateId: META_ID })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    const taken = harness({ candidate, rpc: { data: null, error: { code: 'P0001', message: '"monthly_statement" (en_ZA) already sends Owner weekly summary messages.' } } })
    await expect(taken.service.choose(taken.db.client, COMPANY, 'monthly_statement', { whatsappTemplateId: META_ID })).rejects.toThrow(
      'already sends Owner weekly summary messages',
    )
    const untemplated = harness({ candidate, rpc: { data: null, error: { code: '22023', message: 'Manual message messages are not sent with a template' } } })
    await expect(untemplated.service.choose(untemplated.db.client, COMPANY, 'monthly_statement', { whatsappTemplateId: META_ID })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })
})

describe('MessageTemplatesService.sync', () => {
  it("queues one sync per connected WhatsApp Business Account of the company", async () => {
    const { service, db, enqueueOrRetry } = harness({
      numbers: [
        { id: 'n1', business_account_id: '771001' },
        { id: 'n2', business_account_id: '771001' },
        { id: 'n3', business_account_id: '771002' },
      ],
    })
    await expect(service.sync(db.client, COMPANY)).resolves.toMatchObject({ queued: 2 })
    expect(enqueueOrRetry.mock.calls).toEqual([
      ['whatsapp-template-sync', { companyId: COMPANY, numberId: 'n1' }],
      ['whatsapp-template-sync', { companyId: COMPANY, numberId: 'n3' }],
    ])
    expect(callsTo(db.queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['connection_status', 'connected'],
    ])
  })

  it('refuses while no number is connected', async () => {
    const { service, db, enqueueOrRetry } = harness({ numbers: [] })
    await expect(service.sync(db.client, COMPANY)).rejects.toBeInstanceOf(ConflictException)
    expect(enqueueOrRetry).not.toHaveBeenCalled()
  })
})
