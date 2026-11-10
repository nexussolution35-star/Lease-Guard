import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '../../backend/src/infrastructure/database/database.types.ts'
import {
  claim,
  type CommunicationRef,
  CommunicationLifecycleError,
  decide,
  recordFailed,
  recordProviderStatus,
  recordSent,
  release,
  type SendClaim,
} from '../../backend/src/messaging/communication-lifecycle.ts'
import { check, expectOk, integration, world } from './support/clients.ts'

/**
 * The outbound communication lifecycle module (backend/src/messaging/communication-lifecycle.ts),
 * driven through its interface against the local stack with the real roles: the service role the
 * worker and webhook use, and a signed-in manager's token as the API forwards it. Covers the seam
 * between the TypeScript interface and the SQL functions, and what one pgTAP transaction cannot:
 * concurrent claims and concurrent, out-of-order WhatsApp status callbacks. The rules for every single
 * transition are in supabase/tests/communication_lifecycle.test.sql.
 */

type Db = SupabaseClient<Database>

interface LifecycleRow {
  status: string
  send_uncertain_since: string | null
  external_message_id: string | null
  delivered_at: string | null
  read_at: string | null
  failure_reason: string | null
}

const createdCommunicationIds: string[] = []

let service: Db | undefined
/** The backend's client (the delivery worker, the webhook next). */
function serviceDb(): Db {
  const ctx = integration()
  service ??= createClient<Database>(ctx.supabaseUrl, ctx.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return service
}

/** The signed-in manager of company A, as the API's per-request client (RLS applies). */
function managerDb(): Db {
  const ctx = integration()
  return createClient<Database>(ctx.supabaseUrl, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ctx.accessTokens.manager}` } },
  })
}

function companyA(): string {
  return world().companies.a.id
}

/** An outbound tenant message awaiting approval in company A (setup only, through the service role). */
async function pendingMessage(label: string): Promise<{ ref: CommunicationRef; approvalId: string }> {
  const tenant = world().companies.a.tenants[0]
  if (!tenant) throw new Error('The world has no tenant in company A')
  const communication = check(
    await serviceDb()
      .from('communications')
      .insert({
        company_id: companyA(),
        channel: 'whatsapp',
        direction: 'outbound',
        message_type: 'monthly_statement',
        recipient_type: 'tenant',
        tenant_id: tenant.id,
        counterparty_number: tenant.whatsappNumber,
        company_number: '+27 11 555 0100',
        body: `Good day. Your October 2026 statement is ready. (lifecycle ${label} ${integration().runId})`,
        status: 'pending_approval',
        created_by_user_id: world().users.manager.id,
      })
      .select('id')
      .single(),
    `Insert message ${label}`,
  )
  createdCommunicationIds.push(communication.id)
  const approval = check(
    await serviceDb()
      .from('message_approvals')
      .insert({ company_id: companyA(), communication_id: communication.id, requested_by_user_id: world().users.manager.id })
      .select('id')
      .single(),
    `Request approval for ${label}`,
  )
  return { ref: { companyId: companyA(), communicationId: communication.id }, approvalId: approval.id }
}

/** A message the manager approved: ready for the delivery worker to claim. */
async function approvedMessage(label: string): Promise<CommunicationRef> {
  const { ref, approvalId } = await pendingMessage(label)
  expect(await decide(managerDb(), ref, { approvalId, decision: 'approved' })).toBe('decided')
  return ref
}

async function row(message: CommunicationRef): Promise<LifecycleRow> {
  return check(
    await serviceDb()
      .from('communications')
      .select('status, send_uncertain_since, external_message_id, delivered_at, read_at, failure_reason')
      .eq('id', message.communicationId)
      .single(),
    'Read message',
  )
}

/** The database error code a lifecycle call failed with. */
async function refusal(call: Promise<unknown>): Promise<string> {
  const error: unknown = await call.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  if (!(error instanceof CommunicationLifecycleError)) throw new Error(`Expected a CommunicationLifecycleError, got ${String(error)}`)
  return error.databaseError.code
}

function heldClaim(value: SendClaim | null): SendClaim {
  if (!value) throw new Error('Expected to win the claim')
  return value
}

let sentMessage: CommunicationRef
const wamid = () => `wamid.it-${integration().runId}`

beforeAll(async () => {
  sentMessage = (await pendingMessage('decided')).ref
})

afterAll(async () => {
  for (const id of createdCommunicationIds) {
    // Approval requests cascade with their communication.
    expectOk(await serviceDb().from('communications').delete().eq('id', id), `Delete communication ${id}`)
  }
})

describe('communication lifecycle', () => {
  it('decides as the signed-in manager: approval and status move together, with the manager as approver', async () => {
    const approval = check(
      await serviceDb().from('message_approvals').select('id').eq('communication_id', sentMessage.communicationId).single(),
      'Read approval request',
    )
    // The decision is the signed-in user's alone; the backend's service role cannot make it.
    expect(await refusal(decide(serviceDb(), sentMessage, { approvalId: approval.id, decision: 'approved' }))).toBe('42501')

    expect(await decide(managerDb(), sentMessage, { approvalId: approval.id, decision: 'approved', note: 'Integration test: lifecycle' })).toBe('decided')
    expect((await row(sentMessage)).status).toBe('approved')
    const decided = check(
      await serviceDb().from('message_approvals').select('decision, decided_by_user_id, reason').eq('id', approval.id).single(),
      'Read approval',
    )
    expect(decided).toEqual({ decision: 'approved', decided_by_user_id: world().users.manager.id, reason: 'Integration test: lifecycle' })
    expect(await decide(managerDb(), sentMessage, { approvalId: approval.id, decision: 'rejected' })).toBe('not_pending')
  })

  it('hands exactly one of many concurrent claims the claim, and only the backend may claim', async () => {
    expect(await refusal(claim(managerDb(), sentMessage))).toBe('42501')

    const claims = await Promise.all(Array.from({ length: 12 }, () => claim(serviceDb(), sentMessage)))
    const winners = claims.filter((value) => value !== null)
    expect(winners).toHaveLength(1)
    expect(winners[0]).toMatchObject(sentMessage)
    const claimed = await row(sentMessage)
    expect(claimed.status).toBe('queued')
    expect(claimed.send_uncertain_since).not.toBeNull()
  })

  it('lets only the claim holder hand a claim back or say its send did not happen', async () => {
    const message = await approvedMessage('owned')
    const first = heldClaim(await claim(serviceDb(), message))
    expect(await release(serviceDb(), first)).toBe(true)
    expect(await row(message)).toMatchObject({ status: 'approved', send_uncertain_since: null })

    // The holder of the earlier claim can no longer act on the next one.
    const second = heldClaim(await claim(serviceDb(), message))
    expect(second.token).not.toBe(first.token)
    expect(await release(serviceDb(), first)).toBe(false)
    expect(await recordFailed(serviceDb(), first, { reason: 'Refused', mayHaveBeenSent: false })).toBe(false)

    // A second run of the job that failed before its own claim (no claim) while this send is in flight.
    expect(await recordFailed(serviceDb(), message, { reason: 'Delivery failed after 3 attempts: storage', mayHaveBeenSent: false })).toBe(false)
    expect(await row(message)).toMatchObject({ status: 'queued', send_uncertain_since: expect.any(String), failure_reason: null })

    // The holder learns WhatsApp refused it for good: certainly not sent.
    expect(await recordFailed(serviceDb(), second, { reason: 'Recipient is not on WhatsApp', mayHaveBeenSent: false })).toBe(true)
    expect(await row(message)).toMatchObject({ status: 'failed', send_uncertain_since: null, failure_reason: 'Recipient is not on WhatsApp' })
  })

  it('keeps a possibly sent message from ever being claimed again, and still records the send that went out', async () => {
    // A run that found the claim abandoned records it as possibly sent; any run may, the fact is kept.
    expect(await recordFailed(serviceDb(), sentMessage, { reason: 'Integration test: WhatsApp did not answer', mayHaveBeenSent: true })).toBe(true)
    expect(await row(sentMessage)).toMatchObject({ status: 'failed', send_uncertain_since: expect.any(String) })
    expect(await claim(serviceDb(), sentMessage)).toBeNull()

    expect(await recordSent(serviceDb(), sentMessage, wamid())).toBe('recorded')
    expect(await row(sentMessage)).toMatchObject({ status: 'sent', external_message_id: wamid(), send_uncertain_since: null, failure_reason: null })
    expect(await recordSent(serviceDb(), sentMessage, wamid())).toBe('already_recorded')
    expect(await recordSent(serviceDb(), sentMessage, `${wamid()}-other`)).toBe('conflict')
  })

  it('applies concurrent, out-of-order WhatsApp status callbacks without moving backwards or losing a time', async () => {
    const callback = (status: 'delivered' | 'read' | 'failed', occurredAt: string, companyId = companyA()) =>
      recordProviderStatus(serviceDb(), { companyId, providerMessageId: wamid(), status, occurredAt })
    // Meta does not order callbacks: "read" and a repeated "delivered" race each other.
    await Promise.all([
      callback('read', '2026-11-10T10:05:00+02:00'),
      callback('delivered', '2026-11-10T10:01:00+02:00'),
      callback('delivered', '2026-11-10T10:01:00+02:00'),
      callback('read', '2026-11-10T10:05:00+02:00'),
    ])
    const final = await row(sentMessage)
    expect(final.status).toBe('read')
    expect(new Date(final.delivered_at ?? '').toISOString()).toBe('2026-11-10T08:01:00.000Z')
    expect(new Date(final.read_at ?? '').toISOString()).toBe('2026-11-10T08:05:00.000Z')

    // A late failure is contradicted by the read receipt; a callback for another company finds nothing.
    expect(await callback('failed', '2026-11-10T10:06:00+02:00')).toBe('unchanged')
    expect(await callback('read', '2026-11-10T10:05:00+02:00', world().companies.b.id)).toBe('not_found')
    expect(
      await refusal(recordProviderStatus(managerDb(), { companyId: companyA(), providerMessageId: wamid(), status: 'read', occurredAt: '2026-11-10T10:05:00+02:00' })),
    ).toBe('42501')
  })

  it('refuses delivery state written around the lifecycle, for the backend too', async () => {
    const pending = (await pendingMessage('bypass')).ref
    const outsideTable = await serviceDb().from('communications').update({ status: 'sent' }).eq('id', pending.communicationId)
    expect(outsideTable.error?.code).toBe('42501')

    // A move the table allows is still refused when written directly: the fact would be erased with no id.
    const claimed = await approvedMessage('bypass-claimed')
    heldClaim(await claim(serviceDb(), claimed))
    const direct = await serviceDb().from('communications').update({ status: 'sent', send_uncertain_since: null }).eq('id', claimed.communicationId)
    expect(direct.error?.code).toBe('42501')
    expect(await row(claimed)).toMatchObject({ status: 'queued', send_uncertain_since: expect.any(String) })
  })
})
