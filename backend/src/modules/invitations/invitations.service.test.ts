import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery } from '../../common/testing/fake-db.test-helpers'
import type { EnqueueResult, QueueProducer } from '../../infrastructure/queues/queue-producer'
import { jobIdFor } from '../../infrastructure/queues/queue-registry'
import type { InvitationRow } from './invitations.mapper'
import { createInvitationBodySchema, invitationListQuerySchema } from './invitations.schemas'
import { InvitationsService } from './invitations.service'
import { COMPANY, INVITATION, invitationRow } from './invitations.test-helpers'

const isWrite = (query: RecordedQuery): boolean => callsTo(query, 'insert').length > 0 || callsTo(query, 'update').length > 0

function setup(respond: (query: RecordedQuery) => FakeResult) {
  const db = fakeDb(respond)
  const enqueue = vi.fn<QueueProducer['enqueue']>().mockImplementation((queue, payload) => Promise.resolve(jobIdFor(queue, payload)))
  const enqueueOrRetry = vi
    .fn<QueueProducer['enqueueOrRetry']>()
    .mockImplementation((queue, payload): Promise<EnqueueResult> => Promise.resolve({ jobId: jobIdFor(queue, payload), outcome: 'requeued' }))
  const service = new InvitationsService({ enqueue, enqueueOrRetry } as unknown as QueueProducer)
  return { ...db, enqueue, enqueueOrRetry, service }
}

/** Answers the invitation load with `row` and writes with `written` (or the same row). */
function invitationTable(row: InvitationRow | null, written: FakeResult = { data: row, error: null }) {
  return (query: RecordedQuery): FakeResult => (isWrite(query) ? written : { data: row, error: null })
}

describe('InvitationsService.list', () => {
  it('lists one company with status filter, search, sorting and paging', async () => {
    const { service, client, queries } = setup(() => ({ data: [invitationRow], error: null, count: 3 }))
    const query = invitationListQuerySchema.parse({ status: 'pending', search: 'thandi', sort: 'email', direction: 'desc', pageSize: '2' })

    const page = await service.list(client, COMPANY, query)

    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 2, items: [{ id: INVITATION, status: 'pending' }] })
    const [q] = queries
    expect(q?.table).toBe('company_invitations')
    expect(callsTo(q!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['status', 'pending'],
    ])
    expect(callsTo(q!, 'or')).toEqual([['email.ilike."%thandi%",full_name.ilike."%thandi%"']])
    expect(callsTo(q!, 'order')).toEqual([
      ['email', { ascending: false }],
      ['id', { ascending: true }],
    ])
    expect(callsTo(q!, 'range')).toEqual([[0, 1]])
  })

  it('sorts by creation time by default', async () => {
    const { service, client, queries } = setup(() => ({ data: [], error: null, count: 0 }))
    await service.list(client, COMPANY, invitationListQuerySchema.parse({}))
    expect(callsTo(queries[0]!, 'order')[0]).toEqual(['created_at', { ascending: true }])
  })

  it('maps an unreachable database to 503', async () => {
    const { service, client } = setup(() => ({ data: null, error: { code: 'PGRST002', message: 'schema cache' } }))
    await expect(service.list(client, COMPANY, invitationListQuerySchema.parse({}))).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})

describe('createInvitationBodySchema', () => {
  it('normalises the email and name and rejects bad input', () => {
    expect(createInvitationBodySchema.parse({ email: '  Thandi@Example.CO.ZA ', role: 'read_only', fullName: '  ' })).toEqual({
      email: 'thandi@example.co.za',
      role: 'read_only',
    })
    expect(createInvitationBodySchema.safeParse({ email: 'not-an-email', role: 'read_only' }).success).toBe(false)
    expect(createInvitationBodySchema.safeParse({ email: 'a@b.co', role: 'owner' }).success).toBe(false)
    expect(createInvitationBodySchema.safeParse({ email: 'a@b.co', role: 'read_only', status: 'sent' }).success).toBe(false)
  })
})

describe('InvitationsService.create', () => {
  const body = createInvitationBodySchema.parse({ email: 'Thandi@example.co.za', role: 'property_manager', fullName: 'Thandi Mokoena' })

  it('inserts only the caller-settable columns and enqueues the send job for the new invitation', async () => {
    const { service, client, queries, enqueue } = setup((query) =>
      query.table === 'company_users' ? { data: [], error: null } : { data: invitationRow, error: null },
    )

    const invitation = await service.create(client, COMPANY, body)

    expect(invitation).toMatchObject({ id: INVITATION, status: 'pending', email: 'thandi@example.co.za' })
    const membership = queries.find((q) => q.table === 'company_users')
    expect(callsTo(membership!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['profile.email', 'thandi@example.co.za'],
    ])
    const insert = queries.find((q) => q.table === 'company_invitations')
    expect(callsTo(insert!, 'insert')).toEqual([
      [{ company_id: COMPANY, email: 'thandi@example.co.za', role: 'property_manager', full_name: 'Thandi Mokoena' }],
    ])
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith('user-invitations', { companyId: COMPANY, invitationId: INVITATION })
  })

  it('answers 409 for a duplicate open invitation and enqueues nothing', async () => {
    const { service, client, enqueue } = setup((query) =>
      query.table === 'company_users'
        ? { data: [], error: null }
        : { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    )
    const error = await service.create(client, COMPANY, body).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).message).toMatch(/open invitation/)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('answers 409 when the email already belongs to a member, without inserting', async () => {
    const { service, client, queries, enqueue } = setup(() => ({ data: [{ user_id: 'u1', profile: { email: body.email } }], error: null }))
    await expect(service.create(client, COMPANY, body)).rejects.toBeInstanceOf(ConflictException)
    expect(queries.some((q) => q.table === 'company_invitations')).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('answers 403 when Row Level Security refuses the insert (not a company admin)', async () => {
    const { service, client, enqueue } = setup((query) =>
      query.table === 'company_users' ? { data: [], error: null } : { data: null, error: { code: '42501', message: 'new row violates row-level security' } },
    )
    await expect(service.create(client, COMPANY, body)).rejects.toBeInstanceOf(ForbiddenException)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('reports 503 when the job cannot be queued', async () => {
    const { service, client, enqueue } = setup((query) =>
      query.table === 'company_users' ? { data: [], error: null } : { data: invitationRow, error: null },
    )
    enqueue.mockRejectedValueOnce(new ServiceUnavailableException('Background processing is not available; try again shortly'))
    await expect(service.create(client, COMPANY, body)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})

describe('InvitationsService.revoke', () => {
  it.each(['pending', 'sent'] as const)('revokes a %s invitation, only while it is still revocable', async (status) => {
    const revoked = { ...invitationRow, status: 'revoked', revoked_at: '2026-11-09T09:00:00+00:00' }
    const { service, client, queries } = setup(invitationTable({ ...invitationRow, status }, { data: revoked, error: null }))

    const invitation = await service.revoke(client, COMPANY, INVITATION)

    expect(invitation).toMatchObject({ status: 'revoked', revokedAt: revoked.revoked_at })
    const update = queries.find(isWrite)
    expect(callsTo(update!, 'update')).toEqual([[{ status: 'revoked' }]])
    expect(callsTo(update!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', INVITATION],
    ])
    expect(callsTo(update!, 'in')).toEqual([['status', ['pending', 'sent']]])
  })

  it.each(['accepted', 'revoked', 'failed'] as const)('refuses to revoke an invitation that is %s', async (status) => {
    const { service, client, queries } = setup(invitationTable({ ...invitationRow, status }))
    await expect(service.revoke(client, COMPANY, INVITATION)).rejects.toBeInstanceOf(ConflictException)
    expect(queries.some(isWrite)).toBe(false)
  })

  it('answers 409 when the invitation changed between the read and the update', async () => {
    const { service, client } = setup(invitationTable(invitationRow, { data: null, error: null }))
    await expect(service.revoke(client, COMPANY, INVITATION)).rejects.toBeInstanceOf(ConflictException)
  })

  it('answers 404 for an invitation that is not visible', async () => {
    const { service, client } = setup(() => ({ data: null, error: null }))
    await expect(service.revoke(client, COMPANY, INVITATION)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('maps a refused update to 403', async () => {
    const { service, client } = setup(invitationTable(invitationRow, { data: null, error: { code: '42501', message: 'denied' } }))
    await expect(service.revoke(client, COMPANY, INVITATION)).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('InvitationsService.resend', () => {
  it.each(['pending', 'sent', 'failed'] as const)('re-queues a %s invitation without changing it', async (status) => {
    const { service, client, queries, enqueueOrRetry, enqueue } = setup(invitationTable({ ...invitationRow, status, failure_reason: status === 'failed' ? 'smtp' : null }))

    const invitation = await service.resend(client, COMPANY, INVITATION)

    expect(invitation).toMatchObject({ id: INVITATION, status })
    expect(enqueueOrRetry).toHaveBeenCalledWith('user-invitations', { companyId: COMPANY, invitationId: INVITATION })
    expect(enqueue).not.toHaveBeenCalled()
    expect(queries.some(isWrite)).toBe(false)
    expect(callsTo(queries[0]!, 'eq')).toEqual([
      ['company_id', COMPANY],
      ['id', INVITATION],
    ])
  })

  it.each(['accepted', 'revoked'] as const)('refuses to resend an invitation that is %s', async (status) => {
    const { service, client, enqueueOrRetry } = setup(invitationTable({ ...invitationRow, status }))
    await expect(service.resend(client, COMPANY, INVITATION)).rejects.toBeInstanceOf(ConflictException)
    expect(enqueueOrRetry).not.toHaveBeenCalled()
  })

  it('answers 404 for an invitation that is not visible', async () => {
    const { service, client, enqueueOrRetry } = setup(() => ({ data: null, error: null }))
    await expect(service.resend(client, COMPANY, INVITATION)).rejects.toBeInstanceOf(NotFoundException)
    expect(enqueueOrRetry).not.toHaveBeenCalled()
  })
})
