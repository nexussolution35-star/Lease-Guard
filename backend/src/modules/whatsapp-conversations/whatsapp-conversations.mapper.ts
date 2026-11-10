import type { WhatsAppConversationContact, WhatsAppConversationSummary } from '@leaseguard/domain'

import type { Tables } from '../../infrastructure/database/database.types'

const PREVIEW_LENGTH = 140

/** The conversation columns and embeds the inbox reads (see CONVERSATION_SELECT). */
export type ConversationRow = Pick<Tables<'whatsapp_conversations'>, 'id' | 'company_id' | 'number_id' | 'last_inbound_at' | 'last_message_at' | 'created_at' | 'updated_at'> & {
  contact:
    | (Pick<Tables<'whatsapp_contacts'>, 'id' | 'profile_name' | 'wa_id' | 'tenant_id'> & {
        tenant: Pick<Tables<'tenants'>, 'trading_name' | 'legal_name'> | null
      })
    | null
  number: Pick<Tables<'whatsapp_phone_numbers'>, 'display_number' | 'phone_number_id'> | null
  messages?: Pick<Tables<'communications'>, 'body'>[]
}

/**
 * The columns and embeds of a conversation. Composite foreign keys keep every embed inside the conversation's
 * own company; the number's credential reference is never selected (members cannot read it).
 */
export const CONVERSATION_SELECT =
  'id, company_id, number_id, last_inbound_at, last_message_at, created_at, updated_at, ' +
  'contact:whatsapp_contacts!whatsapp_conversations_contact_fk(id, profile_name, wa_id, tenant_id, tenant:tenants!whatsapp_contacts_tenant_fk(trading_name, legal_name)), ' +
  'number:whatsapp_phone_numbers!whatsapp_conversations_number_fk(display_number, phone_number_id)'

function toContact(row: ConversationRow): WhatsAppConversationContact {
  const contact = row.contact
  // contact_id is NOT NULL with a same-company foreign key, and members read their company's contacts.
  if (!contact) throw new Error(`Conversation ${row.id} has no readable contact`)
  const tenantName = contact.tenant ? contact.tenant.trading_name || contact.tenant.legal_name : undefined
  return {
    id: contact.id,
    ...(contact.profile_name ? { profileName: contact.profile_name } : {}),
    ...(contact.wa_id ? { phoneNumber: `+${contact.wa_id}` } : {}),
    ...(contact.tenant_id ? { tenantId: contact.tenant_id } : {}),
    ...(tenantName ? { tenantName } : {}),
  }
}

function preview(body: string | undefined): string | undefined {
  if (!body) return undefined
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat
}

/** Database row → domain `WhatsAppConversationSummary`. */
export function toConversationSummary(row: ConversationRow): WhatsAppConversationSummary {
  const lastPreview = preview(row.messages?.[0]?.body)
  return {
    id: row.id,
    companyId: row.company_id,
    numberId: row.number_id,
    companyNumber: row.number?.display_number || row.number?.phone_number_id || '',
    contact: toContact(row),
    ...(row.last_inbound_at ? { lastInboundAt: row.last_inbound_at } : {}),
    lastMessageAt: row.last_message_at,
    ...(lastPreview ? { lastMessagePreview: lastPreview } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
