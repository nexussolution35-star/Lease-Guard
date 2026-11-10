/**
 * The outbound gate: "is this message deliverable, and if not, why not?" One deep module for every
 * caller that must give the same answer:
 *
 * - the approve endpoint asks as if its approval were granted and refuses (422) with every blocker,
 *   so a person can never approve a message that delivery would then refuse;
 * - the delivery worker asks immediately before claiming a message, and fails it with the blockers;
 * - the reply endpoint asks `checkContactReply` before a member's reply to a WhatsApp contact is written, with
 *   the same contact rules `checkOutbound` applies before it is sent (ticket 07);
 * - next: a per-business AI agent can ask before it requests approval for a draft.
 *
 * Interface: `checkOutbound(db, message, today, options)` returns either the delivery (what the
 * deliverer needs next: recipient, attachment to upload, the WhatsApp message) or every blocker as a
 * reason a property manager can read. Implementation: one set of reads (message, approvals, recipient,
 * arrangements, template, channel readiness), the @leaseguard/domain eligibility and content rules, and
 * a trial build of the WhatsApp message. It reads through the caller's client: the API's (RLS, the
 * signed-in user) or the worker's (service role), so every read filters by company explicitly.
 *
 * Not the gate's job: the message lifecycle (which statuses may be approved, claimed or retried) and
 * opening the channel with its credential, which only the worker can do (`WhatsAppChannels.forCompany`).
 */

import {
  approvalBlocker,
  canReplyToContact,
  canSendOwnerMessage,
  canSendTenantMessage,
  checkOutboundMessage,
  type EntityId,
  type ISODate,
} from '@leaseguard/domain'

import type { Tables } from '../infrastructure/database/database.types'
import type { DbClient } from '../infrastructure/database/rls-client.factory'
import { accountUnavailability, channelReadiness } from '../infrastructure/whatsapp/channel-readiness'
import { ChannelLookupError, type WhatsAppMessage } from '../infrastructure/whatsapp/whatsapp-channels'
import { currentApproval } from './governing-approval'
import { MessagingReadError, readOrThrow } from './read-error'
import { loadReminderArrangements } from './reminder-arrangements'
import { type ApprovedTemplate, buildWhatsAppMessage, MessageBuildError } from './whatsapp-message.builder'

export { MessagingReadError } from './read-error'

/** The communication to check. */
export interface OutboundMessage {
  readonly companyId: EntityId
  readonly communicationId: EntityId
}

export interface OutboundCheckOptions {
  /**
   * Judge the message as if its approval were granted by the caller: the approve endpoint asks before
   * it records the decision. Without it the recorded approval must be approved and name its approver.
   */
  readonly asIfApproved?: boolean
  /** The moment to judge WhatsApp's 24-hour customer service window at (replies to contacts); default now. */
  readonly now?: Date
}

/** A document stored with the message, to upload through the company's channel before sending. */
export interface OutboundAttachment {
  readonly storagePath: string
  readonly fileName: string
  readonly mimeType: string
}

/** What the deliverer needs next. */
export interface OutboundDelivery {
  /** The recipient's WhatsApp number (E.164); the gate has checked it is still the recipient's. */
  readonly to: string
  /**
   * The company's number to send from (Meta phone number id): a reply goes out from the number its conversation
   * came in on. Absent: the company's default number.
   */
  readonly phoneNumberId?: string
  readonly attachment?: OutboundAttachment
  /**
   * The WhatsApp message. Pass the media id of the uploaded attachment when there is one. Cannot fail
   * for a deliverable message: the gate built it already with the same text and template.
   */
  message(attachmentMediaId?: string): WhatsAppMessage
}

export type OutboundVerdict =
  | { readonly deliverable: true; readonly delivery: OutboundDelivery }
  | { readonly deliverable: false; readonly blockers: readonly string[] }

type CommunicationRow = Tables<'communications'>
type ApprovalRow = Pick<Tables<'message_approvals'>, 'id' | 'decision' | 'requested_at' | 'decided_by_user_id'>

/** The approval the gate judges: the recorded governing one, or the caller's own decision to grant it. */
type GoverningApproval = { decision: ApprovalRow['decision']; approverRecorded: boolean } | undefined

/** Blockers, or the approved template (undefined when the message uses none). */
type TemplateCheck = { blockers: string[]; template?: ApprovedTemplate; found: boolean }

/**
 * Whether the message can be delivered now, and if not, every reason why. Throws MessagingReadError
 * when a read fails (retrying may succeed); never throws for a message that must not be sent.
 */
export async function checkOutbound(
  db: DbClient,
  { companyId, communicationId }: OutboundMessage,
  today: ISODate,
  options: OutboundCheckOptions = {},
): Promise<OutboundVerdict> {
  const [communicationResult, approvalsResult] = await Promise.all([
    db.from('communications').select('*').eq('company_id', companyId).eq('id', communicationId).maybeSingle(),
    db.from('message_approvals').select('id, decision, requested_at, decided_by_user_id').eq('company_id', companyId).eq('communication_id', communicationId),
  ])
  const communication = readOrThrow(communicationResult, 'Load message', null)
  if (!communication) return blocked(['The message was not found'])
  if (communication.direction !== 'outbound' || communication.channel !== 'whatsapp') {
    return blocked(['Only outbound WhatsApp messages are delivered'])
  }

  const recorded = currentApproval(readOrThrow(approvalsResult, 'Load message approvals', []))
  const approval: GoverningApproval = options.asIfApproved
    ? { decision: 'approved', approverRecorded: true }
    : recorded && { decision: recorded.decision, approverRecorded: recorded.decided_by_user_id !== null }

  const thread = communication.recipient_type === 'contact' ? await loadReplyThread(db, companyId, communication.conversation_id) : undefined
  const [recipient, channel, template] = await Promise.all([
    thread !== undefined ? contactRecipientBlockers(communication, thread, options.now ?? new Date()) : recipientBlockers(db, communication, approval, today),
    thread !== undefined ? numberBlockers(thread) : channelBlockers(db, companyId),
    templateCheck(db, communication),
  ])
  const attachment = attachmentOf(communication)
  const build = (mediaId: string | undefined): WhatsAppMessage =>
    buildWhatsAppMessage(communication.body, template.template, attachment && { mediaId: mediaId ?? '', fileName: attachment.fileName })

  const blockers: string[] = [
    // Every outbound message needs an approval that names its approver; tenant approval is judged
    // with the tenant's eligibility below (canSendTenantMessage owns that hard constraint).
    ...(communication.recipient_type !== 'tenant' ? optional(approvalBlocker(approval)) : []),
    ...(approval?.decision === 'approved' && !approval.approverRecorded ? ['The message approval does not record who approved it'] : []),
    ...recipient,
    ...checkOutboundMessage(communication.body, communication.recipient_type).errors,
    ...channel,
    ...template.blockers,
    // A trial build: the approved text must be expressible as the WhatsApp message (template parameters).
    ...(template.found ? buildBlockers(() => build(undefined)) : []),
  ]
  const to = communication.counterparty_number
  if (to === null) blockers.push('The message has no recipient WhatsApp number')
  if (blockers.length > 0 || to === null) return blocked(blockers)

  return {
    deliverable: true,
    delivery: {
      to,
      ...(thread?.number ? { phoneNumberId: thread.number.phone_number_id } : {}),
      ...(attachment ? { attachment } : {}),
      message: (attachmentMediaId) => {
        if (attachment && !attachmentMediaId) throw new Error('Upload the attachment before building the message')
        return build(attachmentMediaId)
      },
    },
  }
}

function blocked(blockers: string[]): OutboundVerdict {
  return { deliverable: false, blockers }
}

function optional(reason: string | undefined): string[] {
  return reason ? [reason] : []
}

/** The recipient still exists, still has the number the message is addressed to, and may receive it. */
async function recipientBlockers(db: DbClient, communication: CommunicationRow, approval: GoverningApproval, today: ISODate): Promise<string[]> {
  const companyId = communication.company_id
  if (communication.recipient_type === 'tenant') {
    const tenantId = communication.tenant_id
    if (!tenantId) return ['The message has no tenant recipient']
    const [tenantResult, arrangements] = await Promise.all([
      db
        .from('tenants')
        .select('id, whatsapp_number, whatsapp_verified, whatsapp_opted_out, status')
        .eq('company_id', companyId)
        .eq('id', tenantId)
        .maybeSingle(),
      loadReminderArrangements(db, companyId, { tenantId }),
    ])
    const tenant = readOrThrow(tenantResult, 'Load message tenant', null)
    if (!tenant) return ['The tenant this message is for no longer exists']
    const eligibility = canSendTenantMessage(
      { id: tenant.id, whatsappVerified: tenant.whatsapp_verified, whatsappOptedOut: tenant.whatsapp_opted_out, status: tenant.status },
      communication.message_type,
      { ...(approval ? { approval: { decision: approval.decision } } : {}), arrangements, today },
    )
    return [
      ...(tenant.whatsapp_number !== communication.counterparty_number ? [numberChanged('tenant')] : []),
      ...eligibility.reasons,
    ]
  }

  const ownerId = communication.owner_user_id
  if (!ownerId) return ['The message has no property owner recipient']
  // Profiles are global; the membership rows prove the owner belongs to this company.
  const [profileResult, membershipResult] = await Promise.all([
    db.from('profiles').select('status, whatsapp_number').eq('id', ownerId).maybeSingle(),
    db.from('company_users').select('company_id, role, is_default, joined_at').eq('company_id', companyId).eq('user_id', ownerId),
  ])
  const profile = readOrThrow(profileResult, 'Load message owner', null)
  const memberships = readOrThrow(membershipResult, 'Load owner membership', [])
  if (!profile) return ['The property owner this message is for no longer exists']
  const eligibility = canSendOwnerMessage(
    {
      status: profile.status,
      ...(profile.whatsapp_number ? { whatsappNumber: profile.whatsapp_number } : {}),
      memberships: memberships.map((m) => ({ companyId: m.company_id, role: m.role, isDefault: m.is_default, joinedAt: m.joined_at })),
    },
    communication.message_type,
    companyId,
  )
  // A missing number is reported by the owner rules; a different one means the recipient changed.
  const changed = profile.whatsapp_number !== null && profile.whatsapp_number !== communication.counterparty_number
  return [...(changed ? [numberChanged('owner')] : []), ...eligibility.reasons]
}

function numberChanged(recipient: 'tenant' | 'owner' | 'contact'): string {
  return `The ${recipient}'s WhatsApp number is no longer the number this message is addressed to; create a new message`
}

// ------------------------------------------------------------------ replies to WhatsApp contacts

/** A conversation a reply belongs to: its contact and the company's number it came in on (null when unreadable). */
interface ReplyThread {
  readonly conversation: Pick<Tables<'whatsapp_conversations'>, 'id' | 'contact_id' | 'number_id' | 'last_inbound_at'>
  readonly contact: Pick<Tables<'whatsapp_contacts'>, 'id' | 'wa_id' | 'tenant_id'> | null
  readonly number: Pick<Tables<'whatsapp_phone_numbers'>, 'id' | 'phone_number_id' | 'connection_status'> | null
  /**
   * A tenant of the company whose WhatsApp number is the contact's number (verified or not), or null. The contact's
   * own tenant link is only set at its next inbound message, so a tenant added or renumbered since then is found here.
   */
  readonly numberTenantId: EntityId | null
}

/** The conversation, its contact and its receiving number; null when the company has no such conversation. */
async function loadReplyThread(db: DbClient, companyId: EntityId, conversationId: EntityId | null): Promise<ReplyThread | null> {
  if (!conversationId) return null
  const conversationResult = await db
    .from('whatsapp_conversations')
    .select('id, contact_id, number_id, last_inbound_at')
    .eq('company_id', companyId)
    .eq('id', conversationId)
    .maybeSingle()
  const conversation = readOrThrow(conversationResult, 'Load conversation', null)
  if (!conversation) return null
  const [contactResult, numberResult] = await Promise.all([
    db.from('whatsapp_contacts').select('id, wa_id, tenant_id').eq('company_id', companyId).eq('id', conversation.contact_id).maybeSingle(),
    db.from('whatsapp_phone_numbers').select('id, phone_number_id, connection_status').eq('company_id', companyId).eq('id', conversation.number_id).maybeSingle(),
  ])
  const contact = readOrThrow(contactResult, 'Load conversation contact', null)
  return {
    conversation,
    contact,
    number: readOrThrow(numberResult, 'Load conversation number', null),
    numberTenantId: contact?.wa_id ? await tenantWithNumber(db, companyId, `+${contact.wa_id}`) : null,
  }
}

/** A tenant of the company with this WhatsApp number (as inbound routing links them), or null. */
async function tenantWithNumber(db: DbClient, companyId: EntityId, whatsappNumber: string): Promise<EntityId | null> {
  const result = await db.from('tenants').select('id').eq('company_id', companyId).eq('whatsapp_number', whatsappNumber)
  const tenants = readOrThrow(result, 'Load tenants with the contact number', [])
  return tenants[0]?.id ?? null
}

/** @leaseguard/domain's canReplyToContact for the thread: not a tenant, inside the window, a known number. */
function replyRuleBlockers(thread: ReplyThread, now: Date): string[] {
  const contact = thread.contact
  if (!contact) return ['The contact of this conversation no longer exists']
  const tenantId = contact.tenant_id ?? thread.numberTenantId
  return canReplyToContact(
    { ...(contact.wa_id ? { phoneNumber: `+${contact.wa_id}` } : {}), ...(tenantId ? { tenantId } : {}) },
    thread.conversation.last_inbound_at ?? undefined,
    now,
  ).reasons
}

/** The reply's conversation still exists, is its contact's, and the contact may receive a free-form reply now. */
function contactRecipientBlockers(communication: CommunicationRow, thread: ReplyThread | null, now: Date): string[] {
  if (!thread) return ['The conversation this reply belongs to no longer exists']
  if (thread.conversation.contact_id !== communication.contact_id) return ['The reply is not addressed to the contact of its conversation']
  const contactNumber = thread.contact?.wa_id ? `+${thread.contact.wa_id}` : null
  return [
    ...(contactNumber !== null && contactNumber !== communication.counterparty_number ? [numberChanged('contact')] : []),
    ...replyRuleBlockers(thread, now),
    ...(communication.template_id ? ['A reply to a contact is free text, not a message template'] : []),
  ]
}

/** The conversation's receiving number is connected (a reply goes out from it, not from the default number). */
function numberBlockers(thread: ReplyThread | null): string[] {
  if (!thread) return []
  if (!thread.number) return ['The WhatsApp number of this conversation no longer exists']
  const unavailable = accountUnavailability(thread.number)
  return unavailable ? [unavailable.message] : []
}

/** A reply a member is about to write to the contact of a conversation. */
export interface ContactReplyDraft {
  readonly companyId: EntityId
  readonly conversationId: EntityId
  readonly body: string
}

export type ContactReplyCheck = { readonly found: false } | { readonly found: true; readonly blockers: readonly string[] }

/**
 * Whether a member may write this reply now, and if not, every reason: the rules `checkOutbound` applies to the
 * reply before it is sent (not a tenant, inside the 24-hour customer service window, a known contact number, the
 * conversation's number connected) and the content rules (no banking details). `found: false` when the company
 * has no such conversation. Throws MessagingReadError when a read fails.
 */
export async function checkContactReply(db: DbClient, draft: ContactReplyDraft, now: Date): Promise<ContactReplyCheck> {
  const thread = await loadReplyThread(db, draft.companyId, draft.conversationId)
  if (!thread) return { found: false }
  return {
    found: true,
    blockers: [...replyRuleBlockers(thread, now), ...checkOutboundMessage(draft.body, 'contact').errors, ...numberBlockers(thread)],
  }
}

/** The company's channel is configured and connected (credentials are checked when the worker opens it). */
async function channelBlockers(db: DbClient, companyId: EntityId): Promise<string[]> {
  try {
    const readiness = await channelReadiness(db, companyId)
    return 'ready' in readiness ? [] : [readiness.message]
  } catch (error) {
    if (error instanceof ChannelLookupError) throw new MessagingReadError('Check the WhatsApp channel', { code: error.code, message: error.message })
    throw error
  }
}

/** The message's template still exists, is approved by Meta and is for this message type. */
async function templateCheck(db: DbClient, communication: CommunicationRow): Promise<TemplateCheck> {
  if (!communication.template_id) return { blockers: [], found: true }
  const result = await db
    .from('message_templates')
    .select('meta_template_name, language, body, approval_status, supports_document_attachment, message_type')
    .eq('company_id', communication.company_id)
    .eq('id', communication.template_id)
    .maybeSingle()
  const row = readOrThrow(result, 'Load message template', null)
  if (!row) return { blockers: ['The message template no longer exists'], found: false }
  const blockers: string[] = []
  if (row.approval_status !== 'approved') blockers.push(`WhatsApp template "${row.meta_template_name}" is not approved by Meta`)
  if (row.message_type !== communication.message_type) blockers.push('The message template is for a different message type')
  return {
    blockers,
    found: true,
    template: {
      metaTemplateName: row.meta_template_name,
      language: row.language,
      body: row.body,
      supportsDocumentAttachment: row.supports_document_attachment,
    },
  }
}

function attachmentOf(communication: CommunicationRow): OutboundAttachment | undefined {
  const { attachment_storage_path: storagePath, attachment_file_name: fileName, attachment_mime_type: mimeType } = communication
  // The database stores the three together or not at all (communications_attachment_check).
  return storagePath && fileName && mimeType ? { storagePath, fileName, mimeType } : undefined
}

function buildBlockers(build: () => WhatsAppMessage): string[] {
  try {
    build()
    return []
  } catch (error) {
    if (error instanceof MessageBuildError) return [error.message]
    throw error
  }
}
