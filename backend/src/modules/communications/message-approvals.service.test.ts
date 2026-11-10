import { ConflictException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { callsTo, fakeDb, type FakeResult, type RecordedQuery, rpcArgs } from '../../common/testing/fake-db.test-helpers'
import type { EnqueueOutcome, QueueProducer } from '../../infrastructure/queues/queue-producer'
import { jobIdFor } from '../../infrastructure/queues/queue-registry'
import type { CommunicationRow, MessageApprovalRow } from './communications.mapper'
import { approvalRow, APPROVAL, communicationRow, COMPANY, MANAGER, MESSAGE, OWNER, REQUESTER, TENANT } from './communications.test-helpers'
import { MessageApprovalsService } from './message-approvals.service'

const NOW = new Date('2026-11-09T08:00:00+02:00')

class TestApprovalsService extends MessageApprovalsService {
  protected override now(): Date {
    return NOW
  }
}

const eligibleTenant = { id: TENANT, whatsapp_number: '+27821234567', whatsapp_verified: true, whatsapp_opted_out: false, status: 'in_arrears' }

interface Scenario {
  communication?: CommunicationRow | null
  approvals?: MessageApprovalRow[]
  tenant?: typeof eligibleTenant | null
  arrangements?: Record<string, unknown>[]
  profile?: { status: string; whatsapp_number: string | null } | null
  memberships?: Record<string, unknown>[]
  /** What the lifecycle's decide answers; defaults to `decided` (approval and status move together). */
  decideOutcome?: 'decided' | 'not_found' | 'not_pending' | 'approval_decided'
  /** The signed-in caller the database stamps as the approver; defaults to MANAGER. */
  caller?: string
  /** What enqueueOrRetry reports for the delivery job; defaults to `already_queued`. */
  retryOutcome?: EnqueueOutcome
  /** The company's WhatsApp account; defaults to a connected one. */
  account?: { connection_status: string } | null
}

/** A direct table write or a lifecycle transition (database function call). */
function isWrite(query: RecordedQuery): boolean {
  return callsTo(query, 'update').length > 0 || callsTo(query, 'insert').length > 0 || query.table.startsWith('rpc:')
}

function scenario(input: Scenario) {
  // The rows as the database holds them; the lifecycle's decide moves both, like the SQL function.
  let communication = input.communication === undefined ? communicationRow() : input.communication
  let approvals = input.approvals ?? [approvalRow()]
  const respond = (query: RecordedQuery): FakeResult => {
    switch (query.table) {
      case 'rpc:decide_communication': {
        const outcome = input.decideOutcome ?? 'decided'
        const args = rpcArgs(query) as { p_approval_id: string; p_decision: 'approved' | 'rejected'; p_note?: string }
        if (outcome === 'decided' && communication) {
          communication = { ...communication, status: args.p_decision }
          approvals = approvals.map((approval) =>
            approval.id === args.p_approval_id && approval.decision === 'pending'
              ? { ...approval, decision: args.p_decision, decided_by_user_id: input.caller ?? MANAGER, decided_at: NOW.toISOString(), reason: args.p_note ?? approval.reason }
              : approval,
          )
        }
        return { data: outcome, error: null }
      }
      case 'communications':
        return { data: communication ? { ...communication, approvals } : null, error: null }
      case 'message_approvals':
        // The outbound gate reads every approval of the message.
        return { data: approvals, error: null }
      case 'tenants':
        return { data: input.tenant === undefined ? eligibleTenant : input.tenant, error: null }
      case 'payment_arrangements':
        return { data: input.arrangements ?? [], error: null }
      case 'profiles':
        return { data: input.profile ?? null, error: null }
      case 'company_users':
        return { data: input.memberships ?? [], error: null }
      case 'whatsapp_accounts':
        return { data: input.account === undefined ? { connection_status: 'connected' } : input.account, error: null }
      default:
        throw new Error(`unexpected table ${query.table}`)
    }
  }
  const db = fakeDb(respond)
  const enqueue = vi.fn<QueueProducer['enqueue']>().mockImplementation((queue, payload) => Promise.resolve(jobIdFor(queue, payload)))
  const enqueueOrRetry = vi
    .fn<QueueProducer['enqueueOrRetry']>()
    .mockImplementation((queue, payload) => Promise.resolve({ jobId: jobIdFor(queue, payload), outcome: input.retryOutcome ?? 'already_queued' }))
  const service = new TestApprovalsService({ enqueue, enqueueOrRetry } as unknown as QueueProducer)
  const writes = () => db.queries.filter(isWrite)
  const decisions = () => db.queries.filter((query) => query.table === 'rpc:decide_communication').map(rpcArgs)
  return { ...db, enqueue, enqueueOrRetry, service, writes, decisions }
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

function messagesOf(error: unknown): string[] {
  const body = (error as UnprocessableEntityException).getResponse() as { message: string[] }
  return body.message
}

describe('MessageApprovalsService.approve', () => {
  it('decides through the lifecycle (approval and status together) and enqueues delivery once', async () => {
    const { service, client, decisions, writes, enqueue } = scenario({})

    const result = await service.approve(client, COMPANY, MESSAGE, { note: 'Checked figures' })

    expect(result.approval).toMatchObject({ id: APPROVAL, decision: 'approved', decidedByUserId: MANAGER, reason: 'Checked figures' })
    expect(result.communication).toMatchObject({ id: MESSAGE, status: 'approved', approvalId: APPROVAL })
    // One lifecycle transition and no direct writes: the database decides the open request and moves the
    // message in one transaction, stamping the signed-in caller as the approver.
    expect(decisions()).toEqual([
      { p_company_id: COMPANY, p_communication_id: MESSAGE, p_approval_id: APPROVAL, p_decision: 'approved', p_note: 'Checked figures' },
    ])
    expect(writes()).toHaveLength(1)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith('message-delivery', { companyId: COMPANY, communicationId: MESSAGE })
    expect(await enqueue.mock.results[0]?.value).toBe(`message-delivery.${COMPANY}.${MESSAGE}`)
  })

  it('leaves the reason untouched when there is no note', async () => {
    const { service, client, decisions } = scenario({})
    await service.approve(client, COMPANY, MESSAGE, {})
    expect(decisions()[0]).not.toHaveProperty('p_note')
  })

  it('scopes every lookup and the decision to the active company', async () => {
    const { service, client, queries, decisions } = scenario({})
    await service.approve(client, COMPANY, MESSAGE, {})
    for (const query of queries.filter((q) => !q.table.startsWith('rpc:'))) expect(callsTo(query, 'eq')).toContainEqual(['company_id', COMPANY])
    expect(decisions()[0]).toMatchObject({ p_company_id: COMPANY })
  })

  it('lets the requester approve their own request, recorded as the approver, and enqueues once', async () => {
    const { service, client, enqueue } = scenario({ caller: REQUESTER })
    const result = await service.approve(client, COMPANY, MESSAGE, {})

    expect(result.approval).toMatchObject({ decision: 'approved', decidedByUserId: REQUESTER })
    expect(result.communication.status).toBe('approved')
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith('message-delivery', { companyId: COMPANY, communicationId: MESSAGE })
  })

  it('refuses a message that mentions a forbidden tenant topic', async () => {
    const { service, client, writes, enqueue } = scenario({
      communication: communicationRow({
        body: 'Hi Lucky, R12,500.00 is outstanding. Your lease expiry is approaching; contact us about renewal.',
      }),
    })
    const error = await rejectionOf(service.approve(client, COMPANY, MESSAGE, {}))
    expect(error).toBeInstanceOf(UnprocessableEntityException)
    expect(messagesOf(error).join(' ')).toMatch(/Tenant messages may not mention: lease expiry, renewal option/)
    expect(writes()).toHaveLength(0)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('refuses a message type tenants may never receive', async () => {
    const { service, client, enqueue } = scenario({ communication: communicationRow({ message_type: 'owner_weekly_summary' }) })
    const error = await rejectionOf(service.approve(client, COMPANY, MESSAGE, {}))
    expect(error).toBeInstanceOf(UnprocessableEntityException)
    expect(messagesOf(error)).toContain('Message type "owner_weekly_summary" is not permitted for tenants')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('refuses a message that carries banking details', async () => {
    const { service, client, writes, enqueue } = scenario({
      communication: communicationRow({ body: 'Hi Lucky, please pay R12,500.00 by EFT. Account number 62012345678, branch code 250655.' }),
    })
    const error = await rejectionOf(service.approve(client, COMPANY, MESSAGE, {}))
    expect(error).toBeInstanceOf(UnprocessableEntityException)
    expect(messagesOf(error).join(' ')).toMatch(/may not contain banking details/)
    expect(writes()).toHaveLength(0)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('refuses an arrears reminder while an active arrangement suppresses reminders', async () => {
    const { service, client, enqueue } = scenario({
      arrangements: [{ tenant_id: TENANT, status: 'active', agreed_on: '2026-09-10', closed_on: null, suppress_arrears_reminders: true }],
    })
    const error = await rejectionOf(service.approve(client, COMPANY, MESSAGE, {}))
    expect(messagesOf(error)).toContain('Arrears reminders are paused by an active payment arrangement')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('refuses (422) what delivery would refuse: a changed number and a disconnected channel, listing both', async () => {
    const { service, client, writes, enqueue } = scenario({
      tenant: { ...eligibleTenant, whatsapp_number: '+27839999999' },
      account: { connection_status: 'disconnected' },
    })
    const error = await rejectionOf(service.approve(client, COMPANY, MESSAGE, {}))
    expect(error).toBeInstanceOf(UnprocessableEntityException)
    expect(messagesOf(error)).toEqual([
      "The tenant's WhatsApp number is no longer the number this message is addressed to; create a new message",
      'The company WhatsApp account is disconnected',
    ])
    expect(writes()).toHaveLength(0)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('refuses (422) a message when the company has no WhatsApp account at all', async () => {
    const { service, client, enqueue } = scenario({ account: null })
    const error = await rejectionOf(service.approve(client, COMPANY, MESSAGE, {}))
    expect(messagesOf(error)).toEqual(['The company has no WhatsApp Business account configured'])
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('lists every blocker for an ineligible tenant', async () => {
    const { service, client } = scenario({ tenant: { ...eligibleTenant, whatsapp_verified: false, whatsapp_opted_out: true } })
    const error = await rejectionOf(service.approve(client, COMPANY, MESSAGE, {}))
    expect(messagesOf(error)).toEqual([
      'Tenant WhatsApp number has not been verified',
      'Tenant has opted out of WhatsApp communication',
    ])
  })

  it('returns 409 when the message was already approved and delivery has moved on', async () => {
    const { service, client, writes, enqueue } = scenario({
      communication: communicationRow({ status: 'sent' }),
      approvals: [approvalRow({ decision: 'approved', decided_by_user_id: MANAGER, decided_at: NOW.toISOString() })],
    })
    await expect(service.approve(client, COMPANY, MESSAGE, {})).rejects.toBeInstanceOf(ConflictException)
    expect(writes()).toHaveLength(0)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('returns 409 on double approval but makes sure the not-yet-delivered message will be delivered', async () => {
    const { service, client, writes, enqueue, enqueueOrRetry } = scenario({
      communication: communicationRow({ status: 'approved' }),
      approvals: [approvalRow({ decision: 'approved', decided_by_user_id: MANAGER, decided_at: NOW.toISOString() })],
    })
    await expect(service.approve(client, COMPANY, MESSAGE, {})).rejects.toThrow(
      new ConflictException('This message has already been approved and is waiting for delivery'),
    )
    expect(writes()).toHaveLength(0)
    expect(enqueue).not.toHaveBeenCalled()
    expect(enqueueOrRetry).toHaveBeenCalledTimes(1)
    expect(enqueueOrRetry).toHaveBeenCalledWith('message-delivery', { companyId: COMPANY, communicationId: MESSAGE }, { retryFailed: expect.any(Function) })
    // The retry rule reads the recorded fact: an approved message holds no claim and was not possibly sent.
    const policy = enqueueOrRetry.mock.calls[0]?.[2]
    expect(policy?.retryFailed?.('job stalled more than allowable limit')).toBe(true)
  })

  it('never queues again a message the lifecycle records as possibly sent, whatever the job says', async () => {
    for (const status of ['failed', 'queued'] as const) {
      const { service, client, writes, enqueue, enqueueOrRetry } = scenario({
        communication: communicationRow({ status, send_uncertain_since: NOW.toISOString(), failure_reason: 'WhatsApp did not answer' }),
        approvals: [approvalRow({ decision: 'approved', decided_by_user_id: MANAGER, decided_at: NOW.toISOString() })],
      })
      await expect(service.approve(client, COMPANY, MESSAGE, {})).rejects.toThrow(
        new ConflictException(
          'This message has already been approved and may already have been sent; check the WhatsApp conversation before sending it again',
        ),
      )
      expect(writes()).toHaveLength(0)
      expect(enqueue).not.toHaveBeenCalled()
      expect(enqueueOrRetry).not.toHaveBeenCalled()
    }
  })

  it('reports a stuck delivery job that was run again', async () => {
    const { service, client } = scenario({
      communication: communicationRow({ status: 'approved' }),
      approvals: [approvalRow({ decision: 'approved', decided_by_user_id: MANAGER, decided_at: NOW.toISOString() })],
      retryOutcome: 'retried',
    })
    await expect(service.approve(client, COMPANY, MESSAGE, {})).rejects.toThrow(/delivery has been queued again/)
  })

  it('reports a failed delivery that may already have been sent instead of sending it again', async () => {
    const { service, client } = scenario({
      communication: communicationRow({ status: 'approved' }),
      approvals: [approvalRow({ decision: 'approved', decided_by_user_id: MANAGER, decided_at: NOW.toISOString() })],
      retryOutcome: 'not_retried',
    })
    await expect(service.approve(client, COMPANY, MESSAGE, {})).rejects.toThrow(/may have been sent/)
  })

  describe.each([
    ['approved', 'pending_approval'],
    ['approved', 'approved'],
  ] as const)('a recorded %s decision (message %s)', (_decision, status) => {
    it('refuses with 422 when the approval does not record who approved', async () => {
      const { service, client, writes, enqueue, enqueueOrRetry } = scenario({
        communication: communicationRow({ status }),
        approvals: [approvalRow({ decision: 'approved', decided_by_user_id: null, decided_at: NOW.toISOString() })],
      })
      const error = await rejectionOf(service.approve(client, COMPANY, MESSAGE, {}))
      expect(error).toBeInstanceOf(UnprocessableEntityException)
      expect(messagesOf(error)).toEqual(['The message approval does not record who approved it'])
      expect(writes()).toHaveLength(0)
      expect(enqueue).not.toHaveBeenCalled()
      expect(enqueueOrRetry).not.toHaveBeenCalled()
    })

    it('refuses with 422 when the message is no longer eligible', async () => {
      const { service, client, writes, enqueue, enqueueOrRetry } = scenario({
        communication: communicationRow({ status }),
        approvals: [approvalRow({ decision: 'approved', decided_by_user_id: MANAGER, decided_at: NOW.toISOString() })],
        arrangements: [{ tenant_id: TENANT, status: 'active', agreed_on: '2026-09-10', closed_on: null, suppress_arrears_reminders: true }],
      })
      const error = await rejectionOf(service.approve(client, COMPANY, MESSAGE, {}))
      expect(messagesOf(error)).toContain('Arrears reminders are paused by an active payment arrangement')
      expect(writes()).toHaveLength(0)
      expect(enqueue).not.toHaveBeenCalled()
      expect(enqueueOrRetry).not.toHaveBeenCalled()
    })
  })

  it('finishes an approval the requester recorded on their own request', async () => {
    const { service, client, enqueue } = scenario({
      approvals: [approvalRow({ decision: 'approved', decided_by_user_id: REQUESTER, decided_at: NOW.toISOString() })],
    })
    const result = await service.approve(client, COMPANY, MESSAGE, {})
    expect(result.communication.status).toBe('approved')
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('re-checks delivery of a message the requester approved, still answering 409', async () => {
    const { service, client, enqueue, enqueueOrRetry } = scenario({
      communication: communicationRow({ status: 'approved' }),
      approvals: [approvalRow({ decision: 'approved', decided_by_user_id: REQUESTER, decided_at: NOW.toISOString() })],
    })
    await expect(service.approve(client, COMPANY, MESSAGE, {})).rejects.toBeInstanceOf(ConflictException)
    expect(enqueue).not.toHaveBeenCalled()
    expect(enqueueOrRetry).toHaveBeenCalledTimes(1)
  })

  it('returns 409 when another reviewer decided first, or the message changed meanwhile', async () => {
    const otherDecision = scenario({ decideOutcome: 'approval_decided' })
    await expect(otherDecision.service.approve(otherDecision.client, COMPANY, MESSAGE, {})).rejects.toThrow(/decided by someone else/)
    expect(otherDecision.enqueue).not.toHaveBeenCalled()

    const changed = scenario({ decideOutcome: 'not_pending' })
    await expect(changed.service.approve(changed.client, COMPANY, MESSAGE, {})).rejects.toThrow(/changed while it was being decided/)
    expect(changed.enqueue).not.toHaveBeenCalled()
  })

  it('surfaces a refused decision (the database guards) as an HTTP error, never enqueueing', async () => {
    const { service, client, enqueue } = scenario({ decideOutcome: 'not_found' })
    await expect(service.approve(client, COMPANY, MESSAGE, {})).rejects.toThrow('The record was not found')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('returns 409 for a rejected message and for a message not awaiting approval', async () => {
    const rejected = scenario({
      communication: communicationRow({ status: 'rejected' }),
      approvals: [approvalRow({ decision: 'rejected', decided_by_user_id: MANAGER, decided_at: NOW.toISOString(), reason: 'No' })],
    })
    await expect(rejected.service.approve(rejected.client, COMPANY, MESSAGE, {})).rejects.toThrow(/was rejected/)

    const draft = scenario({ communication: communicationRow({ status: 'draft' }) })
    await expect(draft.service.approve(draft.client, COMPANY, MESSAGE, {})).rejects.toBeInstanceOf(ConflictException)
    expect(draft.writes()).toHaveLength(0)
  })

  it('refuses inbound messages and returns 404 for a message in no visible company', async () => {
    const inbound = scenario({ communication: communicationRow({ direction: 'inbound', message_type: 'inbound_reply', status: 'received' }) })
    await expect(inbound.service.approve(inbound.client, COMPANY, MESSAGE, {})).rejects.toBeInstanceOf(ConflictException)

    const missing = scenario({ communication: null })
    await expect(missing.service.approve(missing.client, COMPANY, MESSAGE, {})).rejects.toThrow('The record was not found')
  })

  it('finishes an approval recorded without its status move', async () => {
    const decided = approvalRow({ decision: 'approved', decided_by_user_id: MANAGER, decided_at: NOW.toISOString() })
    const { service, client, decisions, enqueue } = scenario({ approvals: [decided] })

    const result = await service.approve(client, COMPANY, MESSAGE, {})

    expect(decisions()).toEqual([{ p_company_id: COMPANY, p_communication_id: MESSAGE, p_approval_id: APPROVAL, p_decision: 'approved' }])
    expect(result.communication.status).toBe('approved')
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('surfaces a queue outage as 503 after the decision is recorded', async () => {
    const { service, client, enqueue, writes } = scenario({})
    enqueue.mockRejectedValueOnce(new ServiceUnavailableException('Background processing is not available'))
    await expect(service.approve(client, COMPANY, MESSAGE, {})).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(writes()).toHaveLength(1)
  })

  it('approves an owner summary for an active property owner with a WhatsApp number', async () => {
    const { service, client, enqueue } = scenario({
      communication: communicationRow({
        message_type: 'owner_weekly_summary',
        recipient_type: 'property_owner',
        tenant_id: null,
        owner_user_id: OWNER,
        counterparty_number: '+27825550000',
        body: 'Good morning Pieter, your LeaseGuard summary: 2 leases expire within 90 days.',
      }),
      profile: { status: 'active', whatsapp_number: '+27825550000' },
      memberships: [{ company_id: COMPANY, role: 'property_owner', is_default: true, joined_at: '2026-01-01T00:00:00+00:00' }],
    })
    const result = await service.approve(client, COMPANY, MESSAGE, {})
    expect(result.communication.status).toBe('approved')
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('refuses an owner message for a user who is not a property owner here', async () => {
    const { service, client, enqueue } = scenario({
      communication: communicationRow({
        message_type: 'owner_weekly_summary',
        recipient_type: 'property_owner',
        tenant_id: null,
        owner_user_id: OWNER,
        body: 'Good morning, your weekly summary.',
      }),
      profile: { status: 'active', whatsapp_number: null },
      memberships: [{ company_id: COMPANY, role: 'read_only', is_default: true, joined_at: '2026-01-01T00:00:00+00:00' }],
    })
    const error = await rejectionOf(service.approve(client, COMPANY, MESSAGE, {}))
    expect(messagesOf(error)).toEqual(['Owner has no WhatsApp number on record', 'User is not a property owner in this company'])
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('MessageApprovalsService.reject', () => {
  it('records the rejection with its reason and never enqueues', async () => {
    const { service, client, decisions, writes, enqueue } = scenario({})
    const result = await service.reject(client, COMPANY, MESSAGE, { note: 'Amount is wrong' })

    expect(result.approval).toMatchObject({ decision: 'rejected', reason: 'Amount is wrong' })
    expect(result.communication.status).toBe('rejected')
    expect(decisions()).toEqual([
      { p_company_id: COMPANY, p_communication_id: MESSAGE, p_approval_id: APPROVAL, p_decision: 'rejected', p_note: 'Amount is wrong' },
    ])
    expect(writes()).toHaveLength(1)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('finishes a rejection recorded without its status move', async () => {
    const { service, client, decisions } = scenario({
      approvals: [approvalRow({ decision: 'rejected', decided_by_user_id: MANAGER, decided_at: NOW.toISOString(), reason: 'No' })],
    })
    const result = await service.reject(client, COMPANY, MESSAGE, { note: 'again' })
    expect(decisions()).toEqual([{ p_company_id: COMPANY, p_communication_id: MESSAGE, p_approval_id: APPROVAL, p_decision: 'rejected' }])
    expect(result.communication.status).toBe('rejected')
  })

  it('lets the requester withdraw their own request', async () => {
    const { service, client } = scenario({ caller: REQUESTER })
    const result = await service.reject(client, COMPANY, MESSAGE, { note: 'Sent by mistake' })
    expect(result.communication.status).toBe('rejected')
  })

  it('returns 409 when already rejected or approved', async () => {
    const rejected = scenario({
      communication: communicationRow({ status: 'rejected' }),
      approvals: [approvalRow({ decision: 'rejected', decided_by_user_id: MANAGER, decided_at: NOW.toISOString(), reason: 'No' })],
    })
    await expect(rejected.service.reject(rejected.client, COMPANY, MESSAGE, { note: 'again' })).rejects.toThrow(
      /already been rejected/,
    )
    const approved = scenario({
      communication: communicationRow({ status: 'queued' }),
      approvals: [approvalRow({ decision: 'approved', decided_by_user_id: MANAGER, decided_at: NOW.toISOString() })],
    })
    await expect(approved.service.reject(approved.client, COMPANY, MESSAGE, { note: 'late' })).rejects.toThrow(
      /can no longer be rejected/,
    )
  })
})
