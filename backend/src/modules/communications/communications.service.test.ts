import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { currentApproval } from '../../messaging/governing-approval'
import { toCommunication } from './communications.mapper'
import { approvalQueueQuerySchema, communicationListQuerySchema } from './communications.schemas'
import { COMMUNICATION_SELECT, CommunicationsService } from './communications.service'
import { approvalRow, APPROVAL, communicationRow, COMPANY, MESSAGE, TENANT } from './communications.test-helpers'

const PROPERTY = '6f1d2c1e-0000-4000-8000-0000000000f1'
const OLD_APPROVAL = '6f1d2c1e-0000-4000-8000-0000000000e0'

describe('communications mapper', () => {
  it('turns nullable columns into absent optional fields', () => {
    const communication = toCommunication(communicationRow())
    expect(communication).toMatchObject({ id: MESSAGE, companyId: COMPANY, tenantId: TENANT, status: 'pending_approval' })
    for (const field of ['ownerUserId', 'propertyId', 'attachment', 'approvalId', 'sentAt', 'failureReason']) {
      expect(communication).not.toHaveProperty(field)
    }
  })

  it('maps a complete attachment and omits an incomplete one instead of inventing values', () => {
    const attachment = {
      attachment_file_name: 'MSQ-2026-10.pdf',
      attachment_storage_path: `${COMPANY}/statements/MSQ-2026-10.pdf`,
      attachment_mime_type: 'application/pdf',
      attachment_size_bytes: 48213,
      attachment_sha256: 'a'.repeat(64),
    }
    expect(toCommunication(communicationRow(attachment)).attachment).toEqual({
      fileName: 'MSQ-2026-10.pdf',
      storagePath: `${COMPANY}/statements/MSQ-2026-10.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 48213,
      sha256: 'a'.repeat(64),
    })
    expect(toCommunication(communicationRow({ ...attachment, attachment_sha256: null }))).not.toHaveProperty('attachment')
  })

  it('derives approvalId from the open request, else the most recent decision', () => {
    const older = { id: OLD_APPROVAL, decision: 'rejected' as const, requested_at: '2026-11-01T08:00:00+00:00' }
    const newer = { id: APPROVAL, decision: 'approved' as const, requested_at: '2026-11-05T08:00:00+00:00' }
    const pending = { id: 'p', decision: 'pending' as const, requested_at: '2026-10-01T08:00:00+00:00' }
    expect(currentApproval([older, newer])?.id).toBe(APPROVAL)
    expect(currentApproval([older, newer, pending])?.id).toBe('p')
    expect(currentApproval([])).toBeUndefined()
  })
})

describe('CommunicationsService', () => {
  const service = new CommunicationsService()

  it('lists one company with every filter, newest first by default', async () => {
    const { client, queries } = fakeDb(() => ({
      data: [{ ...communicationRow(), approvals: [{ id: APPROVAL, decision: 'pending', requested_at: '2026-11-08T08:00:00+00:00' }] }],
      error: null,
      count: 3,
    }))
    const query = communicationListQuerySchema.parse({
      status: 'pending_approval',
      messageType: 'overdue_payment_reminder',
      recipientType: 'tenant',
      channel: 'whatsapp',
      tenantId: TENANT,
      propertyId: PROPERTY,
      search: '+2782',
    })

    const page = await service.list(client, COMPANY, query)

    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 25 })
    expect(page.items[0]).toMatchObject({ id: MESSAGE, approvalId: APPROVAL })
    const [q] = queries
    expect(q?.table).toBe('communications')
    expect(callsTo(q!, 'select')).toEqual([[COMMUNICATION_SELECT, { count: 'exact' }]])
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['status', 'pending_approval'],
      ['message_type', 'overdue_payment_reminder'],
      ['recipient_type', 'tenant'],
      ['channel', 'whatsapp'],
      ['tenant_id', TENANT],
      ['property_id', PROPERTY],
    ])
    expect(callsTo(q!, 'or')).toEqual([['body.ilike."%+2782%",counterparty_number.ilike."%+2782%"']])
    // created_at is NOT NULL: no NULLS LAST, so the (company_id, created_at desc) index can supply the order.
    expect(callsTo(q!, 'order')[0]).toEqual(['created_at', { ascending: false }])
  })

  it('sorts unsent messages last only for the nullable sent_at column', async () => {
    for (const [sort, direction, expected] of [
      ['sentAt', 'desc', ['sent_at', { ascending: false, nullsFirst: false }]],
      ['sentAt', 'asc', ['sent_at', { ascending: true, nullsFirst: false }]],
      ['status', 'desc', ['status', { ascending: false }]],
      [undefined, 'asc', ['created_at', { ascending: true }]],
    ] as const) {
      const { client, queries } = fakeDb(() => ({ data: [], error: null, count: 0 }))
      await service.list(client, COMPANY, communicationListQuerySchema.parse({ sort, direction }))
      expect(callsTo(queries[0]!, 'order')).toEqual([expected, ['id', { ascending: true }]])
    }
  })

  it('rejects unknown filter values', () => {
    expect(communicationListQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false)
    expect(communicationListQuerySchema.safeParse({ tenantId: 'not-a-uuid' }).success).toBe(false)
    expect(communicationListQuerySchema.safeParse({ sort: 'body' }).success).toBe(false)
  })

  it('returns 404 when the message is not visible', async () => {
    const { client } = fakeDb(() => ({ data: null, error: null }))
    await expect(service.get(client, COMPANY, MESSAGE)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('lists the pending approval queue oldest first with each message', async () => {
    const { client, queries } = fakeDb(() => ({
      data: [{ ...approvalRow(), communication: communicationRow() }],
      error: null,
      count: 1,
    }))

    const page = await service.listPendingApprovals(client, COMPANY, approvalQueueQuerySchema.parse({}))

    expect(page.total).toBe(1)
    expect(page.items[0]?.approval).toMatchObject({ id: APPROVAL, decision: 'pending', communicationId: MESSAGE })
    expect(page.items[0]?.approval).not.toHaveProperty('decidedByUserId')
    expect(page.items[0]?.communication).toMatchObject({ id: MESSAGE, approvalId: APPROVAL })
    const [q] = queries
    expect(q?.table).toBe('message_approvals')
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['decision', 'pending'],
    ])
    expect(callsTo(q!, 'order')[0]).toEqual(['requested_at', { ascending: true }])
  })

  it('maps an unreachable database to 503', async () => {
    const { client } = fakeDb(() => ({ data: null, error: { code: 'PGRST002', message: 'schema cache' } }))
    await expect(service.listPendingApprovals(client, COMPANY, approvalQueueQuerySchema.parse({}))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })
})
