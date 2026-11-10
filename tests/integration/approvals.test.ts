import { unwrap } from '@leaseguard/api-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, check, expectOk, integration, serviceRole, world } from './support/clients.ts'
import { listKeysWithPrefix } from '../fixtures/redis.ts'

interface StatusRow {
  status: string
  approvals: { decision: string }[]
}

/** Communications this file inserted (with their approval requests); deleted in afterAll. */
const createdCommunicationIds: string[] = []

/**
 * Inserts an outbound tenant message awaiting approval, requested by `requestedBy`, through the
 * service role (setup only). The message is eligible for a tenant: a monthly statement to an active,
 * verified, opted-in tenant, with no banking details or forbidden topics.
 */
async function createPendingTenantMessage(
  requestedBy: string,
  overrides: Record<string, unknown> = {},
): Promise<{ communicationId: string; approvalId: string }> {
  const db = serviceRole()
  // An active, WhatsApp-verified, opted-in tenant created by the world in company A.
  const tenant = world().companies.a.tenants[0]
  if (!tenant) throw new Error('The world has no tenant in company A')

  const communication = check(
    await db
      .from('communications')
      .insert({
        company_id: world().companies.a.id,
        channel: 'whatsapp',
        direction: 'outbound',
        message_type: 'monthly_statement',
        recipient_type: 'tenant',
        tenant_id: tenant.id,
        counterparty_number: tenant.whatsappNumber,
        company_number: '+27 11 555 0100',
        body: `Good day. Your October 2026 statement is ready for you. (LeaseGuard integration test ${integration().runId})`,
        status: 'pending_approval',
        created_by_user_id: requestedBy,
        ...overrides,
      })
      .select('id')
      .single()
      .overrideTypes<{ id: string }, { merge: false }>(),
    'Insert a pending tenant message',
  )
  createdCommunicationIds.push(communication.id)
  const approval = check(
    await db
      .from('message_approvals')
      .insert({
        company_id: world().companies.a.id,
        communication_id: communication.id,
        requested_by_user_id: requestedBy,
      })
      .select('id')
      .single()
      .overrideTypes<{ id: string }, { merge: false }>(),
    'Insert its approval request',
  )
  return { communicationId: communication.id, approvalId: approval.id }
}

async function decisionState(communicationId: string): Promise<StatusRow> {
  return check(
    await serviceRole()
      .from('communications')
      .select('status, approvals:message_approvals!message_approvals_communication_fk(decision)')
      .eq('id', communicationId)
      .single()
      .overrideTypes<StatusRow, { merge: false }>(),
    'Read message status',
  )
}

/**
 * Redis keys of `message-delivery` jobs for one message in this run's queue prefix. The job id is
 * deterministic (`jobIdFor` in backend/src/infrastructure/queues/queue-registry.ts), and BullMQ stores a
 * job as the hash `<prefix>:<queue>:<job id>`; no worker consumes this prefix and teardown deletes it.
 */
function deliveryJobKey(communicationId: string): string {
  const jobId = `message-delivery.${world().companies.a.id.toLowerCase()}.${communicationId.toLowerCase()}`
  return `${integration().queuePrefix}:message-delivery:${jobId}`
}

async function deliveryJobKeys(communicationId: string): Promise<string[]> {
  const { redisUrl, queuePrefix } = integration()
  const keys = await listKeysWithPrefix(redisUrl, queuePrefix)
  return keys.filter((key) => key.startsWith(deliveryJobKey(communicationId)))
}

let fresh: { communicationId: string; approvalId: string }

/**
 * Company A's WhatsApp account, recorded as verified the way the service role does: the outbound gate
 * refuses to approve a message the company has no connected channel for. Removed with the world.
 */
async function connectCompanyWhatsApp(): Promise<void> {
  expectOk(
    await serviceRole()
      .from('whatsapp_accounts')
      .insert({
        company_id: world().companies.a.id,
        business_account_id: `waba-${integration().runId}`,
        // Unique per run: at most one connected account may hold a receiving number.
        phone_number_id: `pn-${integration().runId}`,
        display_name: 'Integration test number',
        display_number: '+27 11 555 0100',
        connection_status: 'connected',
      }),
    'Connect company A to WhatsApp',
  )
}

async function setWhatsAppConnection(status: 'connected' | 'disconnected'): Promise<void> {
  expectOk(
    await serviceRole().from('whatsapp_accounts').update({ connection_status: status }).eq('company_id', world().companies.a.id),
    `Mark company A's WhatsApp account ${status}`,
  )
}

beforeAll(async () => {
  await connectCompanyWhatsApp()
  fresh = await createPendingTenantMessage(world().users.manager.id)
})

afterAll(async () => {
  const db = serviceRole()
  for (const id of createdCommunicationIds) {
    // Approval requests cascade with their communication.
    expectOk(await db.from('communications').delete().eq('id', id), `Delete communication ${id}`)
    const left = check(
      await db.from('message_approvals').select('id').eq('communication_id', id).overrideTypes<{ id: string }[], { merge: false }>(),
      'Re-read approvals',
    )
    expect(left, `approval requests of ${id} removed`).toEqual([])
  }
})

describe('message approvals', () => {
  it('refuses (422) to approve what delivery would refuse, listing every blocker, and leaves the message pending', async () => {
    const tenant = world().companies.a.tenants[0]!
    // A Meta template that is still awaiting approval, for another message type.
    const template = check(
      await serviceRole()
        .from('message_templates')
        .insert({
          company_id: world().companies.a.id,
          name: 'Overdue reminder',
          message_type: 'overdue_payment_reminder',
          audience: 'tenant',
          meta_template_name: `overdue_${integration().runId}`,
          language: 'en_ZA',
          category: 'utility',
          body: 'Good day. Your account is overdue.',
          approval_status: 'submitted',
        })
        .select('id')
        .single()
        .overrideTypes<{ id: string }, { merge: false }>(),
      'Insert a template awaiting Meta approval',
    )
    // Addressed to a number that is no longer the tenant's.
    const stale = await createPendingTenantMessage(world().users.manager.id, {
      counterparty_number: tenant.whatsappNumber.replace(/\d$/, (digit) => String((Number(digit) + 5) % 10)),
      template_id: template.id,
    })

    await setWhatsAppConnection('disconnected')
    try {
      const error = await apiErrorOf(
        unwrap(apiAs('manager', 'a').POST(approvePath, { params: { path: { communicationId: stale.communicationId } }, body: {} })),
      )
      expect(error.status).toBe(422)
      expect(error.messages).toEqual([
          "The tenant's WhatsApp number is no longer the number this message is addressed to; create a new message",
        'The company WhatsApp account is disconnected',
        expect.stringMatching(/^WhatsApp template "overdue_.+" is not approved by Meta$/),
        'The message template is for a different message type',
        expect.stringMatching(/^The approved text does not match WhatsApp template/),
      ])
    } finally {
      await setWhatsAppConnection('connected')
    }
    expect(await decisionState(stale.communicationId)).toEqual({ status: 'pending_approval', approvals: [{ decision: 'pending' }] })
    expect(await deliveryJobKeys(stale.communicationId)).toEqual([])
  })

  const approvePath = '/api/v1/communications/{communicationId}/approve'
  const rejectPath = '/api/v1/communications/{communicationId}/reject'

  it('refuses approval by a read_only member (403) and leaves the message pending', async () => {
    const error = await apiErrorOf(
      unwrap(apiAs('readOnly', 'a').POST(approvePath, { params: { path: { communicationId: fresh.communicationId } }, body: {} })),
    )
    expect(error.status).toBe(403)
    expect(await decisionState(fresh.communicationId)).toEqual({ status: 'pending_approval', approvals: [{ decision: 'pending' }] })
  })

  it('lets the requester approve their own request (200) and queues exactly one delivery job', async () => {
    expect(await deliveryJobKeys(fresh.communicationId)).toEqual([])

    const result = await unwrap(
      apiAs('manager', 'a').POST(approvePath, {
        params: { path: { communicationId: fresh.communicationId } },
        body: { note: 'Integration test approval by the requester' },
      }),
    )
    expect(result.approval).toMatchObject({
      id: fresh.approvalId,
      decision: 'approved',
      requestedByUserId: world().users.manager.id,
      decidedByUserId: world().users.manager.id,
    })
    expect(result.communication).toMatchObject({ id: fresh.communicationId, status: 'approved' })
    expect(await decisionState(fresh.communicationId)).toEqual({ status: 'approved', approvals: [{ decision: 'approved' }] })

    expect(await deliveryJobKeys(fresh.communicationId)).toEqual([deliveryJobKey(fresh.communicationId)])
  })

  it('refuses a second approval (409) without queueing another delivery job', async () => {
    const before = await deliveryJobKeys(fresh.communicationId)
    const again = await apiErrorOf(
      unwrap(apiAs('admin', 'a').POST(approvePath, { params: { path: { communicationId: fresh.communicationId } }, body: {} })),
    )
    expect(again.status).toBe(409)
    expect(await deliveryJobKeys(fresh.communicationId)).toEqual(before)
    expect(await decisionState(fresh.communicationId)).toEqual({ status: 'approved', approvals: [{ decision: 'approved' }] })
  })

  it('refuses to reject an approved message (409) and leaves it approved', async () => {
    const error = await apiErrorOf(
      unwrap(
        apiAs('admin', 'a').POST(rejectPath, {
          params: { path: { communicationId: fresh.communicationId } },
          body: { note: 'Integration test: too late to reject' },
        }),
      ),
    )
    expect(error.status).toBe(409)
    expect(await decisionState(fresh.communicationId)).toEqual({ status: 'approved', approvals: [{ decision: 'approved' }] })
  })
})
