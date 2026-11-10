import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  type Communication,
  type EntityId,
  NO_NUMBER_REASON,
  TENANT_REPLY_REASON,
  type WhatsAppHandover,
  WINDOW_CLOSED_REASON,
} from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { QueueProducer } from '../../infrastructure/queues/queue-producer'
import { checkContactReply, MessagingReadError } from '../../messaging/outbound-gate'
import { toCommunication } from '../communications/communications.mapper'
import { memberNames } from './member-names'
import { HANDOVER_COLUMNS, type HandoverRow, toHandover } from './whatsapp-conversations.mapper'

/** What the handover database functions answer. */
interface HandoverOutcome {
  outcome: string
  handover_id: string | null
}

/** Why the database refused a reply it was asked to write (reply_to_whatsapp_contact). */
const REPLY_REFUSALS: Readonly<Record<string, string>> = {
  tenant: TENANT_REPLY_REASON,
  no_number: NO_NUMBER_REASON,
  window_closed: WINDOW_CLOSED_REASON,
  number_not_connected: "This conversation's WhatsApp number is not connected",
}

/**
 * What company staff do in a WhatsApp conversation (ticket 07): take it over (accept its handover, or start one),
 * hand it to a colleague, resolve it, and reply to the contact.
 *
 * Every write is one database function run as the signed-in caller, which checks that the caller is a writer
 * (company_admin, property_manager) of the conversation's company; the routes check the role first for a clear 403.
 * A reply is checked by the outbound gate (`checkContactReply`: never a tenant, inside the 24-hour customer service
 * window, the contact's number known, the conversation's number connected, no banking details), written approved by
 * its author through the communication lifecycle (reply_to_whatsapp_contact re-checks the rules in the same
 * transaction), and handed to the delivery queue, whose worker asks the gate again before it sends.
 */
@Injectable()
export class WhatsAppConversationActionsService {
  constructor(private readonly queues: QueueProducer) {}

  /** The current time; a method so tests can control the clock (the customer service window). */
  protected now(): Date {
    return new Date()
  }

  /** The caller takes the conversation over. 409 when a colleague already accepted it. */
  async accept(db: DbClient, companyId: EntityId, conversationId: EntityId): Promise<WhatsAppHandover> {
    const result = await this.handoverCall(db, 'accept_whatsapp_handover', { p_company_id: companyId, p_conversation_id: conversationId }, 'Accept handover')
    switch (result.outcome) {
      case 'accepted':
      case 'already_accepted':
        return this.load(db, companyId, result.handover_id)
      case 'accepted_by_other':
        throw new ConflictException('A colleague has already taken this conversation over; assign it to yourself to take it from them')
      default:
        throw new NotFoundException('Conversation not found')
    }
  }

  /** Hands the conversation to an active company admin or property manager (open until they accept it). */
  async assign(db: DbClient, companyId: EntityId, conversationId: EntityId, assigneeId: EntityId): Promise<WhatsAppHandover> {
    const result = await this.handoverCall(
      db,
      'assign_whatsapp_handover',
      { p_company_id: companyId, p_conversation_id: conversationId, p_assignee: assigneeId },
      'Assign handover',
    )
    switch (result.outcome) {
      case 'assigned':
        return this.load(db, companyId, result.handover_id)
      case 'invalid_assignee':
        throw new UnprocessableEntityException(['Only an active company admin or property manager of this company can handle conversations'])
      default:
        throw new NotFoundException('Conversation not found')
    }
  }

  /** The conversation needs no person any more. 409 when it has no unresolved handover. */
  async resolve(db: DbClient, companyId: EntityId, conversationId: EntityId, note: string | undefined): Promise<WhatsAppHandover> {
    const result = await this.handoverCall(
      db,
      'resolve_whatsapp_handover',
      { p_company_id: companyId, p_conversation_id: conversationId, ...(note !== undefined ? { p_note: note } : {}) },
      'Resolve handover',
    )
    switch (result.outcome) {
      case 'resolved':
        return this.load(db, companyId, result.handover_id)
      case 'no_handover':
        throw new ConflictException('This conversation has no open handover')
      default:
        throw new NotFoundException('Conversation not found')
    }
  }

  /**
   * A free-form reply to the conversation's contact, approved by the caller who writes it and queued for delivery.
   * 422 with every reason when it may not be sent; 404 for a conversation the company does not have.
   */
  async reply(db: DbClient, companyId: EntityId, conversationId: EntityId, body: string): Promise<Communication> {
    let check
    try {
      check = await checkContactReply(db, { companyId, conversationId, body }, this.now())
    } catch (error) {
      if (error instanceof MessagingReadError) throw httpErrorFromDatabase(error.databaseError, error.operation)
      throw error
    }
    if (!check.found) throw new NotFoundException('Conversation not found')
    if (check.blockers.length > 0) throw new UnprocessableEntityException([...check.blockers])

    const rows = unwrapDatabase(
      await db.rpc('reply_to_whatsapp_contact', { p_company_id: companyId, p_conversation_id: conversationId, p_body: body }),
      'Reply to WhatsApp contact',
    ) as { outcome: string; communication_id: string | null }[]
    const created = rows[0]
    if (!created || created.outcome === 'not_found') throw new NotFoundException('Conversation not found')
    const refusal = REPLY_REFUSALS[created.outcome]
    if (refusal) throw new UnprocessableEntityException([refusal])
    if (created.outcome !== 'created' || !created.communication_id) {
      throw new Error(`reply_to_whatsapp_contact answered ${JSON.stringify(created.outcome)}`)
    }

    // Approved already: if Redis is unreachable this throws 503 and the reply stays approved; approving it again
    // (POST /communications/:id/approve) queues its delivery once Redis is back.
    await this.queues.enqueue('message-delivery', { companyId, communicationId: created.communication_id })
    const row = unwrapDatabase(
      await db.from('communications').select('*').eq('company_id', companyId).eq('id', created.communication_id).single(),
      'Load reply',
    )
    return toCommunication(row)
  }

  private async handoverCall(
    db: DbClient,
    fn: 'accept_whatsapp_handover' | 'assign_whatsapp_handover' | 'resolve_whatsapp_handover',
    args: Record<string, string>,
    operation: string,
  ): Promise<HandoverOutcome> {
    // The generated argument types differ per function; each call passes exactly its function's arguments.
    const rows = unwrapDatabase(await db.rpc(fn, args as never), operation) as unknown as HandoverOutcome[]
    return rows[0] ?? { outcome: 'not_found', handover_id: null }
  }

  /** One handover of the company, with its assignee's name. */
  private async load(db: DbClient, companyId: EntityId, handoverId: string | null): Promise<WhatsAppHandover> {
    if (!handoverId) throw new NotFoundException('Conversation not found')
    const row = unwrapDatabase(
      await db.from('whatsapp_handovers').select(HANDOVER_COLUMNS).eq('company_id', companyId).eq('id', handoverId).single(),
      'Load handover',
    ) as unknown as HandoverRow
    return toHandover(row, await memberNames(db, row.assigned_user_id ? [row.assigned_user_id] : []))
  }
}
