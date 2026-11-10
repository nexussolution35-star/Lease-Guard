import { describe, expect, it } from 'vitest'

import { fakeDb, type FakeResult, rpcArgs } from '../common/testing/fake-db.test-helpers'
import {
  claim,
  CommunicationLifecycleError,
  decide,
  deliveryState,
  mayHaveBeenSent,
  mayRetryDelivery,
  recordFailed,
  recordProviderStatus,
  recordSent,
  release,
} from './communication-lifecycle'

// The transitions themselves (conditions, atomicity, claim ownership, the transition table, provider
// status ordering) are tested through this same interface against local Postgres in
// tests/integration/communication-lifecycle.test.ts, and rule by rule in
// supabase/tests/communication_lifecycle.test.sql. This file covers what needs no database: how odd
// answers and database failures come back, and the questions about a loaded row.

const MESSAGE = { companyId: 'company-1', communicationId: 'message-1' }

function answering(result: FakeResult) {
  return fakeDb(() => result)
}

describe('communication lifecycle (TypeScript interface)', () => {
  it('hands the claim\'s token to its winner and presents it only where the claim is held', async () => {
    const token = '2026-11-10T08:00:00.123456+00:00'
    const won = await claim(answering({ data: token, error: null }).client, MESSAGE)
    expect(won).toEqual({ ...MESSAGE, token })
    await expect(claim(answering({ data: null, error: null }).client, MESSAGE)).resolves.toBeNull()

    const db = answering({ data: true, error: null })
    await release(db.client, won!)
    await recordFailed(db.client, won!, { reason: 'Refused', mayHaveBeenSent: false })
    await recordFailed(db.client, MESSAGE, { reason: 'Gate', mayHaveBeenSent: false })
    expect(db.queries.map((q) => rpcArgs(q).p_claim)).toEqual([token, token, undefined])
  })

  it('returns the outcome of a decision and of a recorded send', async () => {
    await expect(decide(answering({ data: 'approval_decided', error: null }).client, MESSAGE, { approvalId: 'a-1', decision: 'approved' })).resolves.toBe(
      'approval_decided',
    )
    await expect(recordSent(answering({ data: 'already_recorded', error: null }).client, MESSAGE, 'wamid.1')).resolves.toBe('already_recorded')
  })

  it('passes a provider status keyed by company and provider id, with WhatsApp\'s time and reason', async () => {
    const db = answering({ data: 'recorded', error: null })
    await expect(
      recordProviderStatus(db.client, {
        companyId: 'company-1',
        providerMessageId: 'wamid.1',
        status: 'failed',
        occurredAt: '2026-11-10T10:00:00+02:00',
        failureReason: '131049: not delivered',
      }),
    ).resolves.toBe('recorded')
    expect(rpcArgs(db.queries[0]!)).toEqual({
      p_company_id: 'company-1',
      p_provider_message_id: 'wamid.1',
      p_status: 'failed',
      p_occurred_at: '2026-11-10T10:00:00+02:00',
      p_failure_reason: '131049: not delivered',
    })
  })

  it('throws CommunicationLifecycleError for a database failure or an answer it does not know', async () => {
    const unreachable = claim(answering({ data: null, error: { code: 'PGRST000', message: 'connection refused' } }).client, MESSAGE)
    await expect(unreachable).rejects.toBeInstanceOf(CommunicationLifecycleError)
    await expect(unreachable).rejects.toMatchObject({ databaseError: { code: 'PGRST000' }, operation: 'Claim message for sending' })
    await expect(recordSent(answering({ data: 'sent?', error: null }).client, MESSAGE, 'wamid.1')).rejects.toBeInstanceOf(CommunicationLifecycleError)
    await expect(claim(answering({ data: true, error: null }).client, MESSAGE)).rejects.toBeInstanceOf(CommunicationLifecycleError)
  })

  it('places a loaded message for delivery from the recorded facts', () => {
    const row = (status: string, external_message_id: string | null = null, send_uncertain_since: string | null = null) =>
      ({ status, external_message_id, send_uncertain_since }) as Parameters<typeof deliveryState>[0]
    expect(deliveryState(row('approved'))).toBe('sendable')
    expect(deliveryState(row('queued', null, '2026-11-10T08:00:00Z'))).toBe('possibly_sent')
    expect(deliveryState(row('failed', null, '2026-11-10T08:00:00Z'))).toBe('possibly_sent')
    expect(deliveryState(row('rejected', null, '2026-11-10T08:00:00Z'))).toBe('possibly_sent')
    expect(deliveryState(row('failed'))).toBe('not_sendable')
    expect(deliveryState(row('pending_approval'))).toBe('not_sendable')
    expect(deliveryState(row('received', 'wamid.in'))).toBe('already_sent')
    for (const status of ['sent', 'delivered', 'read']) expect(deliveryState(row(status, 'wamid.1'))).toBe('already_sent')
    // A provider status of failed after the send: WhatsApp accepted it once; never sent again.
    expect(deliveryState(row('failed', 'wamid.1'))).toBe('already_sent')
  })

  it('answers "may it have been sent?" and "may its delivery run again?" from the recorded fact', () => {
    const approved = { status: 'approved' as const, external_message_id: null, send_uncertain_since: null }
    expect(mayHaveBeenSent(approved)).toBe(false)
    expect(mayRetryDelivery(approved)).toBe(true)

    const possiblySent = { status: 'failed' as const, external_message_id: null, send_uncertain_since: '2026-11-10T08:00:00Z' }
    expect(mayHaveBeenSent(possiblySent)).toBe(true)
    expect(mayRetryDelivery(possiblySent)).toBe(false)

    expect(mayRetryDelivery({ status: 'queued', external_message_id: null, send_uncertain_since: '2026-11-10T08:00:00Z' })).toBe(false)
    expect(mayRetryDelivery({ status: 'failed', external_message_id: null, send_uncertain_since: null })).toBe(false)
    expect(mayRetryDelivery({ status: 'sent', external_message_id: 'wamid.1', send_uncertain_since: null })).toBe(false)
  })
})
