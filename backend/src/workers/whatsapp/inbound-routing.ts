import type { EntityId } from '@leaseguard/domain'
import { z } from 'zod'

/**
 * Routing one Meta webhook payload (ticket 05, ADR 0002): every change names the receiving number
 * (`value.metadata.phone_number_id`); that number alone decides the company. The sender only identifies the
 * contact within that company, by Meta's business-scoped user id (`from_user_id` / `contacts[].user_id`) or the
 * WhatsApp number (`from` / `contacts[].wa_id`), either of which Meta may omit. No step ever loads another
 * company's data: each message is handed to the store with the one company its receiving number belongs to.
 *
 * Status updates (`value.statuses`) and account, quality and template events are recorded as not handled yet
 * (ticket 06); the raw payload is kept, so nothing is lost.
 */

/** A connected receiving number and the company that owns it. */
export interface ReceivingNumber {
  companyId: EntityId
  numberId: EntityId
}

/** The routing side of WhatsAppChannels: the owner of a connected phone_number_id, or null. */
export interface ReceivingNumbers {
  forReceivingNumber(phoneNumberId: string): Promise<ReceivingNumber | null>
}

/** One inbound message, as the store records it. Never logged: it holds personal data. */
export interface InboundMessage {
  providerMessageId: string
  /** Meta's business-scoped user id (BSUID). */
  userId: string | null
  /** The sender's WhatsApp number: digits with country code, no '+'. */
  waId: string | null
  profileName: string | null
  body: string
  sentAt: Date | null
}

/** What the database did with one message: `unknown_number` when the number was disconnected meanwhile. */
export type MessageRecordOutcome = 'recorded' | 'duplicate' | 'unknown_number' | 'invalid'

export interface InboundMessageStore {
  record(owner: ReceivingNumber, message: InboundMessage): Promise<MessageRecordOutcome>
}

/**
 * One line of the processing record kept on the webhook event: ids and outcomes only, never message text or
 * the sender's number.
 */
export type RoutingOutcome =
  | { field: 'messages'; phoneNumberId: string; outcome: 'unknown_number'; messages: number; statuses: number }
  | { field: 'messages'; phoneNumberId: string; companyId: EntityId; messageId: string; outcome: MessageRecordOutcome }
  | { field: 'messages'; phoneNumberId: string; companyId: EntityId; outcome: 'statuses_not_handled'; statuses: number }
  | { field: string; outcome: 'not_handled' }
  | { field: string; outcome: 'invalid'; reason: string }

const metaId = z.string().trim().min(1).max(64)

const changeSchema = z.object({ field: z.string().min(1).max(100), value: z.unknown() })
const payloadSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({ changes: z.array(z.unknown()).default([]) })).default([]),
})

const messagesValueSchema = z.object({
  metadata: z.object({ phone_number_id: metaId }),
  contacts: z.array(z.unknown()).default([]),
  messages: z.array(z.unknown()).default([]),
  statuses: z.array(z.unknown()).default([]),
})

const contactSchema = z.object({
  wa_id: z.string().optional(),
  user_id: z.string().optional(),
  profile: z.object({ name: z.string().optional() }).optional(),
})

const messageSchema = z.object({
  id: z.string().trim().min(1).max(256),
  from: z.string().optional(),
  from_user_id: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  type: z.string().optional(),
})

const WA_ID = /^[1-9][0-9]{6,14}$/
const MAX_USER_ID = 128

const waIdOf = (value: string | undefined): string | null => {
  const digits = value?.replace(/^\+/, '').trim()
  return digits && WA_ID.test(digits) ? digits : null
}
const userIdOf = (value: string | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length <= MAX_USER_ID ? trimmed : null
}

/** The readable text of a message for the inbox; media is not downloaded in this version. */
export function inboundMessageText(message: Record<string, unknown>): string {
  const type = typeof message.type === 'string' ? message.type : 'unknown'
  const part = (key: string): Record<string, unknown> => {
    const value = message[key]
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  }
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)
  const labelled = (label: string, detail: string | null) => (detail ? `[${label}] ${detail}` : `[${label}]`)

  switch (type) {
    case 'text':
      return text(part('text').body) ?? '(Empty message)'
    case 'image':
      return labelled('Image', text(part('image').caption))
    case 'video':
      return labelled('Video', text(part('video').caption))
    case 'document':
      return labelled('Document', text(part('document').caption) ?? text(part('document').filename))
    case 'audio':
      return labelled(part('audio').voice === true ? 'Voice note' : 'Audio', null)
    case 'sticker':
      return labelled('Sticker', null)
    case 'location': {
      const location = part('location')
      return labelled('Location', [text(location.name), text(location.address)].filter(Boolean).join(', ') || null)
    }
    case 'contacts':
      return labelled('Contact card', null)
    case 'button':
      return text(part('button').text) ?? labelled('Button', null)
    case 'interactive': {
      const interactive = part('interactive')
      const reply = (key: string) => {
        const value = interactive[key]
        return typeof value === 'object' && value !== null ? text((value as Record<string, unknown>).title) : null
      }
      return reply('button_reply') ?? reply('list_reply') ?? labelled('Interactive reply', null)
    }
    case 'reaction':
      return labelled('Reaction', text(part('reaction').emoji))
    case 'order':
      return labelled('Order', null)
    case 'system':
      return labelled('System', text(part('system').body))
    default:
      return labelled('Unsupported message', null)
  }
}

/** The contact entry Meta sent for this message's sender, if any. */
function contactFor(contacts: readonly z.infer<typeof contactSchema>[], from: string | undefined, fromUserId: string | undefined) {
  return (
    contacts.find((c) => (fromUserId && c.user_id === fromUserId) || (from && c.wa_id === from)) ??
    (contacts.length === 1 && !from && !fromUserId ? contacts[0] : undefined)
  )
}

export function toInboundMessage(raw: unknown, contacts: readonly z.infer<typeof contactSchema>[]): InboundMessage | { invalid: string; messageId?: string } {
  const parsed = messageSchema.safeParse(raw)
  if (!parsed.success) return { invalid: 'message without a valid id' }
  const m = parsed.data
  const contact = contactFor(contacts, m.from, m.from_user_id)
  const userId = userIdOf(m.from_user_id ?? contact?.user_id)
  const waId = waIdOf(m.from ?? contact?.wa_id)
  if (!userId && !waId) return { invalid: 'sender has neither a business-scoped user id nor a WhatsApp number', messageId: m.id }
  const seconds = Number(m.timestamp)
  return {
    providerMessageId: m.id,
    userId,
    waId,
    profileName: contact?.profile?.name?.trim().slice(0, 200) || null,
    body: inboundMessageText(raw as Record<string, unknown>),
    sentAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null,
  }
}

/** Routes every change of one payload; returns one outcome per message or change. */
export async function routeWebhookPayload(
  payload: unknown,
  deps: { numbers: ReceivingNumbers; store: InboundMessageStore },
): Promise<RoutingOutcome[]> {
  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) return [{ field: 'payload', outcome: 'invalid', reason: 'not a WhatsApp Business Account payload' }]
  if (parsed.data.object !== 'whatsapp_business_account') return [{ field: 'payload', outcome: 'not_handled' }]

  const owners = new Map<string, ReceivingNumber | null>()
  const ownerOf = async (phoneNumberId: string) => {
    if (!owners.has(phoneNumberId)) owners.set(phoneNumberId, await deps.numbers.forReceivingNumber(phoneNumberId))
    return owners.get(phoneNumberId) ?? null
  }

  const outcomes: RoutingOutcome[] = []
  for (const entry of parsed.data.entry) {
    for (const rawChange of entry.changes) {
      const change = changeSchema.safeParse(rawChange)
      if (!change.success) {
        outcomes.push({ field: 'unknown', outcome: 'invalid', reason: 'change without a field' })
        continue
      }
      if (change.data.field !== 'messages') {
        outcomes.push({ field: change.data.field, outcome: 'not_handled' })
        continue
      }
      const value = messagesValueSchema.safeParse(change.data.value)
      if (!value.success) {
        outcomes.push({ field: 'messages', outcome: 'invalid', reason: 'messages change without a receiving number' })
        continue
      }
      const { metadata, messages, statuses } = value.data
      const phoneNumberId = metadata.phone_number_id
      const owner = await ownerOf(phoneNumberId)
      if (!owner) {
        // Not a connected number of any company: recorded on the event, nothing else (ADR 0002).
        outcomes.push({ field: 'messages', phoneNumberId, outcome: 'unknown_number', messages: messages.length, statuses: statuses.length })
        continue
      }
      const contacts = value.data.contacts.flatMap((c) => {
        const contact = contactSchema.safeParse(c)
        return contact.success ? [contact.data] : []
      })
      for (const raw of messages) {
        const message = toInboundMessage(raw, contacts)
        if ('invalid' in message) {
          outcomes.push({ field: 'messages', outcome: 'invalid', reason: message.invalid })
          continue
        }
        const outcome = await deps.store.record(owner, message)
        outcomes.push({ field: 'messages', phoneNumberId, companyId: owner.companyId, messageId: message.providerMessageId, outcome })
      }
      if (statuses.length > 0) {
        outcomes.push({ field: 'messages', phoneNumberId, companyId: owner.companyId, outcome: 'statuses_not_handled', statuses: statuses.length })
      }
    }
  }
  return outcomes
}
