import { describe, expect, it } from 'vitest'

import { tableDb } from '../common/testing/table-db.test-helpers'
import { checkContactReply, checkOutbound, MessagingReadError, type OutboundCheckOptions, type OutboundVerdict } from './outbound-gate'

/**
 * The outbound gate through its interface: "is this message deliverable, and why not". Rows live in
 * in-memory tables (with another company's rows alongside, which the gate must never see); the gate's
 * real queries run against local Postgres in tests/integration/approvals.test.ts (approve → 422).
 */

const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
const OTHER_COMPANY = '6f1d2c1e-0000-4000-8000-000000000002'
const MESSAGE = '6f1d2c1e-0000-4000-8000-0000000000d1'
const TENANT = '6f1d2c1e-0000-4000-8000-0000000000c1'
const OWNER = '6f1d2c1e-0000-4000-8000-0000000000c2'
const MANAGER = '6f1d2c1e-0000-4000-8000-0000000000a1'
const TEMPLATE = '6f1d2c1e-0000-4000-8000-0000000000f1'
const NUMBER = '+27821234567'
const OWNER_NUMBER = '+27825550000'
const TODAY = '2026-11-09'
const BODY = 'Dear Test Trading, your October statement shows R12 500,00 outstanding. Please contact your property manager.'

type Row = Record<string, unknown>

const communication: Row = {
  id: MESSAGE,
  company_id: COMPANY,
  channel: 'whatsapp',
  direction: 'outbound',
  message_type: 'overdue_payment_reminder',
  recipient_type: 'tenant',
  tenant_id: TENANT,
  owner_user_id: null,
  template_id: null,
  counterparty_number: NUMBER,
  body: BODY,
  attachment_storage_path: null,
  attachment_file_name: null,
  attachment_mime_type: null,
  status: 'approved',
}
const approved: Row = { id: 'apr-1', company_id: COMPANY, communication_id: MESSAGE, decision: 'approved', requested_at: '2026-11-08T10:00:00+02:00', decided_by_user_id: MANAGER }
const tenant: Row = { id: TENANT, company_id: COMPANY, whatsapp_number: NUMBER, whatsapp_verified: true, whatsapp_opted_out: false, status: 'in_arrears' }
const connected: Row = { company_id: COMPANY, connection_status: 'connected' }
const activeArrangement: Row = { id: 'arr-1', company_id: COMPANY, tenant_id: TENANT, status: 'active', agreed_on: '2026-10-01', closed_on: null, suppress_arrears_reminders: true }
const template: Row = {
  id: TEMPLATE,
  company_id: COMPANY,
  meta_template_name: 'overdue_reminder',
  language: 'en_ZA',
  body: 'Dear {{1}}, your October statement shows {{2}} outstanding. Please contact your property manager.',
  approval_status: 'approved',
  supports_document_attachment: false,
  message_type: 'overdue_payment_reminder',
}
const ownerMessage: Row = {
  ...communication,
  message_type: 'owner_weekly_summary',
  recipient_type: 'property_owner',
  tenant_id: null,
  owner_user_id: OWNER,
  counterparty_number: OWNER_NUMBER,
  body: 'Good morning Pieter, your LeaseGuard summary: 2 leases expire within 90 days.',
}
const ownerProfile: Row = { id: OWNER, status: 'active', whatsapp_number: OWNER_NUMBER }
const ownerMembership: Row = { company_id: COMPANY, user_id: OWNER, role: 'property_owner', is_default: true, joined_at: '2026-01-01T00:00:00+00:00' }

interface World {
  communication?: Row
  approvals?: Row[]
  tenant?: Row | null
  arrangements?: Row[]
  account?: Row | null
  templates?: Row[]
  profile?: Row | null
  memberships?: Row[]
  failing?: Record<string, { code: string; message: string }>
}

/** The message, its recipient and its company's channel, plus another company's look-alike rows. */
function check(world: World = {}, options: OutboundCheckOptions = {}): Promise<OutboundVerdict> {
  const db = tableDb(
    {
      communications: [{ ...communication, ...world.communication }],
      message_approvals: world.approvals ?? [approved],
      tenants: [...(world.tenant === null ? [] : [{ ...tenant, ...world.tenant }]), { ...tenant, company_id: OTHER_COMPANY, whatsapp_opted_out: true }],
      payment_arrangements: [...(world.arrangements ?? []), { ...activeArrangement, id: 'arr-other', company_id: OTHER_COMPANY }],
      whatsapp_phone_numbers: [...(world.account === null ? [] : [{ ...connected, ...world.account }]), { company_id: OTHER_COMPANY, connection_status: 'disconnected' }],
      message_templates: world.templates ?? [template, { ...template, company_id: OTHER_COMPANY, approval_status: 'rejected' }],
      profiles: world.profile === null ? [] : [{ ...ownerProfile, ...world.profile }],
      company_users: world.memberships ?? [ownerMembership, { ...ownerMembership, company_id: OTHER_COMPANY, role: 'read_only' }],
    },
    world.failing,
  )
  return checkOutbound(db, { companyId: COMPANY, communicationId: MESSAGE }, TODAY, options)
}

async function blockers(world: World = {}, options: OutboundCheckOptions = {}): Promise<readonly string[]> {
  const verdict = await check(world, options)
  return verdict.deliverable ? [] : verdict.blockers
}

describe('checkOutbound: deliverable messages', () => {
  it('delivers an approved payment reminder to an eligible tenant as plain text, to the approved number', async () => {
    const verdict = await check()
    expect(verdict.deliverable).toBe(true)
    if (!verdict.deliverable) return
    expect(verdict.delivery.to).toBe(NUMBER)
    expect(verdict.delivery.attachment).toBeUndefined()
    expect(verdict.delivery.message()).toEqual({ type: 'text', text: { body: BODY, preview_url: false } })
  })

  it('builds a template message whose parameters reproduce the approved text', async () => {
    const verdict = await check({ communication: { template_id: TEMPLATE } })
    expect(verdict.deliverable && verdict.delivery.message()).toEqual({
      type: 'template',
      template: {
        name: 'overdue_reminder',
        language: { code: 'en_ZA' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Test Trading' }, { type: 'text', text: 'R12 500,00' }] }],
      },
    })
  })

  it('hands over the attachment to upload, and builds the document message from its media id', async () => {
    const verdict = await check({
      communication: {
        message_type: 'monthly_statement',
        body: 'Dear Test Trading, your October statement is attached.',
        attachment_storage_path: `${COMPANY}/${MESSAGE}/oct.pdf`,
        attachment_file_name: 'oct.pdf',
        attachment_mime_type: 'application/pdf',
      },
    })
    expect(verdict.deliverable).toBe(true)
    if (!verdict.deliverable) return
    expect(verdict.delivery.attachment).toEqual({ storagePath: `${COMPANY}/${MESSAGE}/oct.pdf`, fileName: 'oct.pdf', mimeType: 'application/pdf' })
    expect(verdict.delivery.message('media-1')).toMatchObject({ type: 'document', document: { id: 'media-1', filename: 'oct.pdf' } })
    expect(() => verdict.delivery.message()).toThrow(/Upload the attachment/)
  })

  it('delivers an owner summary to an active property owner of this company', async () => {
    expect(await blockers({ communication: ownerMessage })).toEqual([])
  })

  it('judges a pending message as if granted when the approve endpoint asks', async () => {
    const pending = { ...approved, decision: 'pending', decided_by_user_id: null }
    expect(await blockers({ approvals: [pending] }, { asIfApproved: true })).toEqual([])
    expect(await blockers({ approvals: [] }, { asIfApproved: true })).toEqual([])
  })
})

describe('checkOutbound: blockers', () => {
  it('a message that does not exist in this company, or is not an outbound WhatsApp message', async () => {
    expect(await blockers({ communication: { company_id: OTHER_COMPANY } })).toEqual(['The message was not found'])
    expect(await blockers({ communication: { direction: 'inbound' } })).toEqual(['Only outbound WhatsApp messages are delivered'])
  })

  it.each([
    ['no approval request', [], 'Property manager approval is required before sending'],
    ['a pending request', [{ ...approved, decision: 'pending', decided_by_user_id: null }], 'Property manager approval is required before sending'],
    ['a rejection', [{ ...approved, decision: 'rejected' }], 'Message approval was rejected'],
    ['an approval that does not name its approver', [{ ...approved, decided_by_user_id: null }], 'The message approval does not record who approved it'],
  ])('tenant message with %s', async (_case, approvals, reason) => {
    expect(await blockers({ approvals })).toEqual([reason])
  })

  it('judges the governing approval: a newer open request outweighs an older approval', async () => {
    const reopened = { ...approved, id: 'apr-2', decision: 'pending', decided_by_user_id: null, requested_at: '2026-11-09T07:00:00+02:00' }
    expect(await blockers({ approvals: [approved, reopened] })).toEqual(['Property manager approval is required before sending'])
  })

  it('owner messages need approval too, with the same wording', async () => {
    expect(await blockers({ communication: ownerMessage, approvals: [] })).toEqual(['Property manager approval is required before sending'])
    expect(await blockers({ communication: ownerMessage, approvals: [{ ...approved, decided_by_user_id: null }] })).toEqual([
      'The message approval does not record who approved it',
    ])
  })

  it("a tenant whose WhatsApp number changed after the message was written (approval as well as delivery)", async () => {
    const reason = "The tenant's WhatsApp number is no longer the number this message is addressed to; create a new message"
    expect(await blockers({ tenant: { whatsapp_number: '+27839999999' } })).toEqual([reason])
    expect(await blockers({ tenant: { whatsapp_number: '+27839999999' } }, { asIfApproved: true })).toEqual([reason])
  })

  it('a tenant who no longer exists, or a message without one', async () => {
    expect(await blockers({ tenant: null })).toEqual(['The tenant this message is for no longer exists'])
    expect(await blockers({ communication: { tenant_id: null } })).toEqual(['The message has no tenant recipient'])
  })

  it('tenant eligibility: verification, opt-out, status and message type', async () => {
    expect(await blockers({ tenant: { whatsapp_verified: false, whatsapp_opted_out: true } })).toEqual([
      'Tenant WhatsApp number has not been verified',
      'Tenant has opted out of WhatsApp communication',
    ])
    expect(await blockers({ tenant: { status: 'vacated' } })).toEqual(['Tenant has vacated'])
    expect(await blockers({ communication: { message_type: 'owner_weekly_summary' } })).toEqual([
      'Message type "owner_weekly_summary" is not permitted for tenants',
    ])
  })

  it("arrears reminders are paused by the tenant's active arrangement; another company's arrangement does not count", async () => {
    expect(await blockers({ arrangements: [activeArrangement] })).toEqual(['Arrears reminders are paused by an active payment arrangement'])
    // The other company's active arrangement for a tenant with the same id is always present.
    expect(await blockers()).toEqual([])
    expect(await blockers({ arrangements: [{ ...activeArrangement, suppress_arrears_reminders: false }] })).toEqual([])
  })

  it('instalment reminders need an active arrangement', async () => {
    const reminder = { message_type: 'arrangement_installment_reminder', body: 'Dear Test Trading, your next instalment of R10 000,00 is due on 15 Nov 2026.' }
    expect(await blockers({ communication: reminder })).toEqual(['No active payment arrangement exists for this tenant'])
    expect(await blockers({ communication: reminder, arrangements: [activeArrangement] })).toEqual([])
  })

  it('content: banking details for anyone, forbidden topics for tenants', async () => {
    const bank = await blockers({ communication: { body: 'Please pay R12 500,00 into account number 62845019876, branch code 250655.' } })
    expect(bank).toHaveLength(1)
    expect(bank[0]).toMatch(/may not contain banking details/)
    expect(await blockers({ communication: { body: 'Hi, R12 500,00 is outstanding. Your lease expiry is approaching.' } })).toEqual([
      'Tenant messages may not mention: lease expiry',
    ])
  })

  it('a company channel that is not configured or not connected', async () => {
    expect(await blockers({ account: null })).toEqual(['The company has no WhatsApp Business account configured'])
    expect(await blockers({ account: { connection_status: 'disconnected' } })).toEqual(['The company WhatsApp account is disconnected'])
    expect(await blockers({ account: { connection_status: 'pending_verification' } }, { asIfApproved: true })).toEqual([
      'The company WhatsApp account is pending verification',
    ])
  })

  it('a template that is missing, not approved by Meta, or for another message type', async () => {
    expect(await blockers({ communication: { template_id: TEMPLATE }, templates: [] })).toEqual(['The message template no longer exists'])
    expect(await blockers({ communication: { template_id: TEMPLATE }, templates: [{ ...template, approval_status: 'submitted' }] })).toEqual([
      'WhatsApp template "overdue_reminder" is not approved by Meta',
    ])
    expect(await blockers({ communication: { template_id: TEMPLATE }, templates: [{ ...template, message_type: 'follow_up_payment_reminder' }] })).toEqual([
      'The message template is for a different message type',
    ])
  })

  it('a body that cannot be expressed as the template, or an attachment the template cannot carry', async () => {
    expect(await blockers({ communication: { template_id: TEMPLATE, body: 'Something else entirely.' } })).toEqual([
      'The approved text does not match WhatsApp template "overdue_reminder"',
    ])
    expect(
      await blockers({
        communication: { template_id: TEMPLATE, attachment_storage_path: `${COMPANY}/x.pdf`, attachment_file_name: 'x.pdf', attachment_mime_type: 'application/pdf' },
      }),
    ).toEqual(['WhatsApp template "overdue_reminder" does not support a document attachment'])
  })

  it('owner recipients: membership, number and status, with one wording for "not an owner here"', async () => {
    const notOwner = 'User is not a property owner in this company'
    expect(await blockers({ communication: ownerMessage, memberships: [] })).toEqual([notOwner])
    expect(await blockers({ communication: ownerMessage, memberships: [{ ...ownerMembership, role: 'read_only' }] })).toEqual([notOwner])
    expect(await blockers({ communication: ownerMessage, profile: { whatsapp_number: '+27830000000' } })).toEqual([
      "The owner's WhatsApp number is no longer the number this message is addressed to; create a new message",
    ])
    expect(await blockers({ communication: ownerMessage, profile: { whatsapp_number: null, status: 'suspended' } })).toEqual([
      'Owner user is suspended',
      'Owner has no WhatsApp number on record',
    ])
    expect(await blockers({ communication: ownerMessage, profile: null })).toEqual(['The property owner this message is for no longer exists'])
  })

  it('lists every blocker at once', async () => {
    expect(
      await blockers({
        approvals: [],
        tenant: { whatsapp_number: '+27839999999', whatsapp_opted_out: true },
        arrangements: [activeArrangement],
        account: { connection_status: 'disconnected' },
        communication: { template_id: TEMPLATE, body: 'Pay into account number 62845019876, branch code 250655.' },
        templates: [{ ...template, approval_status: 'submitted' }],
      }),
    ).toEqual([
      "The tenant's WhatsApp number is no longer the number this message is addressed to; create a new message",
      'Tenant has opted out of WhatsApp communication',
      'Property manager approval is required before sending',
      'Arrears reminders are paused by an active payment arrangement',
      expect.stringMatching(/may not contain banking details/),
      'The company WhatsApp account is disconnected',
      'WhatsApp template "overdue_reminder" is not approved by Meta',
      'The approved text does not match WhatsApp template "overdue_reminder"',
    ])
  })
})

describe('checkOutbound: failed reads', () => {
  it.each(['communications', 'tenants', 'payment_arrangements', 'whatsapp_phone_numbers'])('throws MessagingReadError when %s cannot be read', async (table) => {
    const failure = check({ failing: { [table]: { code: 'PGRST000', message: 'connection refused' } } })
    await expect(failure).rejects.toBeInstanceOf(MessagingReadError)
    await expect(failure).rejects.toMatchObject({ databaseError: { code: 'PGRST000' } })
  })
})

describe('checkOutbound and checkContactReply: replies to WhatsApp contacts', () => {
  const CONVERSATION = '6f1d2c1e-0000-4000-8000-0000000000e1'
  const CONTACT = '6f1d2c1e-0000-4000-8000-0000000000e2'
  const NUMBER_ID = '6f1d2c1e-0000-4000-8000-0000000000e3'
  const CONTACT_NUMBER = '+27829990001'
  const NOW = new Date('2026-11-10T12:00:00Z')
  const REPLY = 'Yes, parking is available in the basement.'

  const reply: Row = {
    ...communication,
    message_type: 'manual',
    recipient_type: 'contact',
    tenant_id: null,
    contact_id: CONTACT,
    conversation_id: CONVERSATION,
    counterparty_number: CONTACT_NUMBER,
    body: REPLY,
  }
  const conversation: Row = { id: CONVERSATION, company_id: COMPANY, contact_id: CONTACT, number_id: NUMBER_ID, last_inbound_at: '2026-11-10T10:00:00Z' }
  const contact: Row = { id: CONTACT, company_id: COMPANY, wa_id: '27829990001', tenant_id: null }
  const number: Row = { id: NUMBER_ID, company_id: COMPANY, phone_number_id: '1110001', connection_status: 'connected', created_at: '2026-11-02T00:00:00Z' }
  // The company's default (earliest) number is disconnected: a reply goes out from its conversation's number.
  const defaultNumber: Row = { id: 'n-default', company_id: COMPANY, phone_number_id: '1110000', connection_status: 'disconnected', created_at: '2026-11-01T00:00:00Z' }

  interface ReplyWorld {
    communication?: Row
    approvals?: Row[]
    conversation?: Row | null
    contact?: Row
    number?: Row
    tenants?: Row[]
  }

  function db(world: ReplyWorld = {}) {
    return tableDb({
      communications: [{ ...reply, ...world.communication }],
      message_approvals: world.approvals ?? [approved],
      whatsapp_conversations: [
        ...(world.conversation === null ? [] : [{ ...conversation, ...world.conversation }]),
        { ...conversation, company_id: OTHER_COMPANY },
      ],
      whatsapp_contacts: [{ ...contact, ...world.contact }, { ...contact, company_id: OTHER_COMPANY, tenant_id: TENANT }],
      whatsapp_phone_numbers: [defaultNumber, { ...number, ...world.number }, { ...number, company_id: OTHER_COMPANY, connection_status: 'disconnected' }],
      // Another company's tenant with the contact's number never makes this company's contact a tenant.
      tenants: [...(world.tenants ?? []), { ...tenant, company_id: OTHER_COMPANY, whatsapp_number: CONTACT_NUMBER }],
    })
  }
  const verdict = (world: ReplyWorld = {}) => checkOutbound(db(world), { companyId: COMPANY, communicationId: MESSAGE }, TODAY, { now: NOW })
  const replyBlockers = async (world: ReplyWorld = {}) => {
    const result = await verdict(world)
    return result.deliverable ? [] : result.blockers
  }

  it("delivers the AI agent's own approved reply to a contact (ticket 10)", async () => {
    const agentApproval = { ...approved, decided_by_user_id: null, decided_by_agent_run_id: 'run-1' }
    await expect(replyBlockers({ approvals: [agentApproval] })).resolves.toEqual([])
  })

  it('never accepts an agent approval for a tenant message', async () => {
    const agentApproval = { ...approved, decided_by_user_id: null, decided_by_agent_run_id: 'run-1' }
    expect(await blockers({ approvals: [agentApproval] })).toContain(
      'Only a reply to a contact can be approved by the AI agent; a person approves this message',
    )
  })

  it("delivers an approved reply inside the window as free text, from the conversation's number", async () => {
    const result = await verdict()
    expect(result.deliverable).toBe(true)
    if (!result.deliverable) return
    expect(result.delivery.to).toBe(CONTACT_NUMBER)
    expect(result.delivery.phoneNumberId).toBe('1110001')
    expect(result.delivery.message()).toEqual({ type: 'text', text: { body: REPLY, preview_url: false } })
  })

  it('refuses after the 24-hour customer service window has closed', async () => {
    expect(await replyBlockers({ conversation: { last_inbound_at: '2026-11-09T11:59:00Z' } })).toEqual([expect.stringMatching(/24-hour customer service window has closed/)])
  })

  it('never delivers to a contact who is a tenant', async () => {
    expect(await replyBlockers({ contact: { tenant_id: TENANT } })).toEqual([expect.stringMatching(/^This contact is a tenant/)])
  })

  it("never delivers to a tenant whose number was recorded after the contact's last message (contact not yet linked)", async () => {
    const renumbered = [{ ...tenant, whatsapp_number: CONTACT_NUMBER, whatsapp_verified: false }]
    expect(await replyBlockers({ tenants: renumbered })).toEqual([expect.stringMatching(/^This contact is a tenant/)])
    expect(await checkContactReply(db({ tenants: renumbered }), { companyId: COMPANY, conversationId: CONVERSATION, body: REPLY }, NOW)).toEqual({
      found: true,
      blockers: [expect.stringMatching(/^This contact is a tenant/)],
    })
  })

  it('needs an approval that names its approver', async () => {
    expect(await replyBlockers({ approvals: [] })).toEqual(['Property manager approval is required before sending'])
  })

  it("refuses when the conversation's number is not connected, or the contact's number changed", async () => {
    expect(await replyBlockers({ number: { connection_status: 'disconnected' } })).toEqual(['The company WhatsApp account is disconnected'])
    expect(await replyBlockers({ contact: { wa_id: '27829990002' } })).toEqual([
      "The contact's WhatsApp number is no longer the number this message is addressed to; create a new message",
    ])
  })

  it('refuses a reply whose conversation is gone or belongs to another contact, a template, or banking details', async () => {
    expect(await replyBlockers({ conversation: null })).toEqual(['The conversation this reply belongs to no longer exists'])
    expect(await replyBlockers({ conversation: { contact_id: 'someone-else' } })).toEqual(['The reply is not addressed to the contact of its conversation'])
    expect(await replyBlockers({ communication: { template_id: TEMPLATE } })).toContain('A reply to a contact is free text, not a message template')
    expect(await replyBlockers({ communication: { body: 'Please pay into account number 62845019876.' } })).toEqual([
      expect.stringMatching(/may not contain banking details/),
    ])
  })

  it('checks a reply before it is written with the same rules', async () => {
    const draft = (world: ReplyWorld = {}, body = REPLY) => checkContactReply(db(world), { companyId: COMPANY, conversationId: CONVERSATION, body }, NOW)
    expect(await draft()).toEqual({ found: true, blockers: [] })
    expect(await draft({ conversation: null })).toEqual({ found: false })
    expect(await draft({ contact: { tenant_id: TENANT, wa_id: null }, conversation: { last_inbound_at: null }, number: { connection_status: 'pending_verification' } }, 'EFT to account 62845019876')).toEqual({
      found: true,
      blockers: [
        expect.stringMatching(/^This contact is a tenant/),
        expect.stringMatching(/24-hour customer service window has closed/),
        expect.stringMatching(/has not shared this contact's number/),
        expect.stringMatching(/may not contain banking details/),
        'The company WhatsApp account is pending verification',
      ],
    })
  })
})
