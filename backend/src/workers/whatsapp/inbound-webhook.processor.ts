import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { UnrecoverableError } from 'bullmq'

import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { WhatsAppChannels } from '../../infrastructure/whatsapp/whatsapp-channels'
import { isFinalAttempt, type JobAttempt, ProcessorRuntime } from '../jobs/processor-runtime'
import { Clock } from '../shared/clock'
import { unwrap, WorkerDatabaseError } from '../shared/db'
import {
  type InboundMessage,
  type InboundMessageStore,
  type MessageRecordOutcome,
  type ReceivingNumber,
  routeWebhookPayload,
  type RoutingOutcome,
} from './inbound-routing'

const RECORD_OUTCOMES: readonly MessageRecordOutcome[] = ['recorded', 'duplicate', 'unknown_number']

/**
 * Records one message through record_whatsapp_inbound_message (20261110100900), which re-checks in the same
 * transaction that the number is still the company's connected number, deduplicates by Meta's message id per
 * company, finds or creates the contact, links a same-company tenant and threads the conversation.
 */
export class DatabaseInboundMessageStore implements InboundMessageStore {
  constructor(private readonly db: DbClient) {}

  async record(owner: ReceivingNumber, message: InboundMessage): Promise<MessageRecordOutcome> {
    const { data, error } = await this.db.rpc('record_whatsapp_inbound_message', {
      p_company_id: owner.companyId,
      p_number_id: owner.numberId,
      p_provider_message_id: message.providerMessageId,
      // The generated types mark every argument required; the function accepts null for each of these.
      p_user_id: message.userId as string,
      p_wa_id: message.waId as string,
      p_profile_name: message.profileName as string,
      p_body: message.body,
      p_sent_at: message.sentAt?.toISOString() as string,
    })
    // 22023: the function refused the input (no sender identity, bad id). Retrying cannot change that.
    if (error?.code === '22023') return 'invalid'
    if (error) throw new WorkerDatabaseError('Record an inbound WhatsApp message', error)
    const outcome = data?.[0]?.outcome
    if (!RECORD_OUTCOMES.includes(outcome as MessageRecordOutcome)) {
      throw new Error(`record_whatsapp_inbound_message returned an unexpected outcome: ${String(outcome)}`)
    }
    return outcome as MessageRecordOutcome
  }
}

export type WebhookProcessingResult =
  | { outcome: 'processed'; outcomes: RoutingOutcome[] }
  | { outcome: 'already_processed' }

/**
 * Queue `whatsapp-webhook`: one signed Meta payload (the API checked the signature). The payload is stored once
 * in whatsapp_webhook_events (unique by its SHA-256) before anything else, then routed message by message by the
 * receiving number (inbound-routing.ts), and the outcome of every change is recorded on the event. A retried job
 * routes again safely: the database records each message once per company. Never logs message text or numbers.
 */
@Injectable()
export class WhatsAppWebhookProcessor implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppWebhookProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
    private readonly channels: WhatsAppChannels,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.runtime.start('whatsapp-webhook', (payload, attempt) => this.process(payload, attempt), { concurrency: 4 })
  }

  async process(job: JobPayloads['whatsapp-webhook'], attempt: JobAttempt): Promise<WebhookProcessingResult> {
    let payload: unknown
    try {
      payload = JSON.parse(job.body)
    } catch {
      // The API only queues JSON; a body that is not cannot become valid by retrying.
      throw new UnrecoverableError('The queued webhook payload is not JSON')
    }
    const db = this.clients.get()

    unwrap(
      await db
        .from('whatsapp_webhook_events')
        .upsert(
          { payload_sha256: job.payloadSha256, payload: payload as never, received_at: job.receivedAt },
          { onConflict: 'payload_sha256', ignoreDuplicates: true },
        ),
      'Store the WhatsApp webhook payload',
      null,
    )
    const stored = await db.from('whatsapp_webhook_events').select('id, processing_status').eq('payload_sha256', job.payloadSha256).maybeSingle()
    if (stored.error) throw new WorkerDatabaseError('Load the WhatsApp webhook event', stored.error)
    const event = stored.data
    if (!event) throw new Error('The stored WhatsApp webhook event could not be read back')
    if (event.processing_status === 'processed') {
      this.logger.log({ eventId: event.id }, 'WhatsApp webhook payload already processed')
      return { outcome: 'already_processed' }
    }

    let outcomes: RoutingOutcome[]
    try {
      outcomes = await routeWebhookPayload(payload, { numbers: this.channels, store: new DatabaseInboundMessageStore(db) })
    } catch (error) {
      if (isFinalAttempt(attempt) || error instanceof UnrecoverableError) {
        await this.finish(db, event.id, 'failed', [], error instanceof Error ? error.message : String(error))
      }
      throw error
    }

    await this.finish(db, event.id, 'processed', outcomes, null)
    this.logger.log(
      {
        eventId: event.id,
        recorded: outcomes.filter((o) => o.outcome === 'recorded').length,
        duplicates: outcomes.filter((o) => o.outcome === 'duplicate').length,
        unknownNumbers: outcomes.filter((o) => o.outcome === 'unknown_number').length,
        notHandled: outcomes.filter((o) => o.outcome === 'not_handled' || o.outcome === 'statuses_not_handled').length,
        invalid: outcomes.filter((o) => o.outcome === 'invalid').length,
      },
      'WhatsApp webhook payload routed',
    )
    return { outcome: 'processed', outcomes }
  }

  private async finish(db: DbClient, eventId: string, status: 'processed' | 'failed', outcomes: RoutingOutcome[], error: string | null): Promise<void> {
    unwrap(
      await db
        .from('whatsapp_webhook_events')
        .update({
          processing_status: status,
          processed_at: this.clock.now().toISOString(),
          outcomes: outcomes as never,
          error_message: error === null ? null : error.slice(0, 2000),
        })
        .eq('id', eventId),
      'Record the WhatsApp webhook outcome',
      null,
    )
  }
}
