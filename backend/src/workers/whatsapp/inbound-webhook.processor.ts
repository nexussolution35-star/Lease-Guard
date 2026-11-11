import type { EntityId } from '@leaseguard/domain'
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { UnrecoverableError } from 'bullmq'

import type { WorkerEnv } from '../../config/env'
import { WORKER_ENV } from '../../config/tokens'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { type MetaPhoneNumber, WhatsAppApiError, WhatsAppChannels } from '../../infrastructure/whatsapp/whatsapp-channels'
import { recordProviderStatus } from '../../messaging/communication-lifecycle'
import { isFinalAttempt, type JobAttempt, ProcessorRuntime } from '../jobs/processor-runtime'
import { WorkerQueues } from '../queues/worker-queues'
import { Clock } from '../shared/clock'
import { unwrap, WorkerDatabaseError } from '../shared/db'
import {
  type AccessRemoval,
  type AccessRemovalEvent,
  accountEvents,
  type AccountEventStore,
  type QualityRefreshOutcome,
  type QualityUpdate,
  type TemplateStatusChange,
  type TemplateStatusOutcome,
} from './account-events'
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
  /**
   * Every message this store recorded, or found already recorded (a retry may come after an attempt that recorded it
   * but stopped before its agent run was queued): the messages the company's AI agent runs on.
   */
  readonly forAgent: { companyId: EntityId; communicationId: EntityId }[] = []

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
    const communicationId = data?.[0]?.communication_id
    if ((outcome === 'recorded' || outcome === 'duplicate') && communicationId) {
      this.forAgent.push({ companyId: owner.companyId, communicationId })
    }
    return outcome as MessageRecordOutcome
  }
}

const TEMPLATE_OUTCOMES: readonly TemplateStatusOutcome[] = ['added', 'updated', 'removed', 'stale', 'unknown_template']

const clip = (value: string | undefined, max: number) => (value ? value.slice(0, max) : undefined)

/** Meta's view of a number as the columns hold it; only the fields Meta reported. */
function metaViewColumns(meta: MetaPhoneNumber) {
  const verifiedName = clip(meta.verifiedName, 200)
  const quality = clip(meta.qualityRating, 40)
  const codeVerification = clip(meta.codeVerificationStatus, 40)
  const nameStatus = clip(meta.nameStatus, 60)
  const metaStatus = clip(meta.status, 40)
  return {
    ...(verifiedName ? { verified_name: verifiedName } : {}),
    ...(quality ? { quality_rating: quality } : {}),
    ...(codeVerification ? { code_verification_status: codeVerification } : {}),
    ...(nameStatus ? { name_status: nameStatus } : {}),
    ...(metaStatus ? { meta_status: metaStatus } : {}),
  }
}

/**
 * Account-level events through the service-role functions of 20261110101000, which decide the holders of the
 * account (verified access only) in the same transaction as the change. A quality update reads Meta's view of the
 * holder's numbers in the account again (the webhook itself names only the messaging limit), through the channel
 * module, so the token never leaves it.
 */
export class DatabaseAccountEventStore implements AccountEventStore {
  constructor(
    private readonly db: DbClient,
    private readonly channels: WhatsAppChannels,
  ) {}

  async removeAccess(businessAccountId: string, event: AccessRemovalEvent, occurredAt: Date | null): Promise<AccessRemoval[]> {
    const { data, error } = await this.db.rpc('remove_whatsapp_business_account_access', {
      p_business_account_id: businessAccountId,
      p_event: event,
      // Left out when Meta sent no entry.time (the function defaults it to now). Never `undefined` in the body: a key
      // set to undefined is dropped while the type claims it is sent.
      ...(occurredAt ? { p_occurred_at: occurredAt.toISOString() } : {}),
    })
    if (error) throw new WorkerDatabaseError('Remove access to a WhatsApp Business Account', error)
    return (data ?? []).map((row) => ({
      companyId: row.company_id,
      numbersDisconnected: row.numbers_disconnected,
      tokenRemoved: row.token_removed,
      adminsNotified: row.admins_notified,
    }))
  }

  async applyTemplateStatus(businessAccountId: string, change: TemplateStatusChange, occurredAt: Date | null) {
    const { data, error } = await this.db.rpc('apply_whatsapp_template_status', {
      p_business_account_id: businessAccountId,
      p_meta_template_id: change.metaTemplateId,
      // The generated types mark every argument required; the function accepts null for these.
      p_name: change.name as string,
      p_language: change.language as string,
      p_category: change.category as string,
      p_status: change.status,
      p_reason: change.reason as string,
      ...(occurredAt ? { p_occurred_at: occurredAt.toISOString() } : {}),
    })
    if (error) throw new WorkerDatabaseError("Apply a WhatsApp template's status", error)
    return (data ?? []).map((row) => {
      if (!TEMPLATE_OUTCOMES.includes(row.outcome as TemplateStatusOutcome)) {
        throw new Error(`apply_whatsapp_template_status returned an unexpected outcome: ${String(row.outcome)}`)
      }
      return { companyId: row.company_id, outcome: row.outcome as TemplateStatusOutcome }
    })
  }

  async refreshNumberQuality(businessAccountId: string, update: QualityUpdate, occurredAt: Date | null) {
    const holders = await this.db.rpc('whatsapp_business_account_holders', { p_business_account_id: businessAccountId })
    if (holders.error) throw new WorkerDatabaseError('Find the holders of a WhatsApp Business Account', holders.error)
    const results: { companyId: EntityId; outcome: QualityRefreshOutcome; numbers: number }[] = []
    for (const { company_id: companyId } of holders.data ?? []) {
      const numbers = unwrap(
        await this.db
          .from('whatsapp_phone_numbers')
          .select('id, phone_number_id')
          .eq('company_id', companyId)
          .eq('business_account_id', businessAccountId)
          .neq('connection_status', 'disconnected'),
        'Load the WhatsApp numbers of the account',
        [],
      )
      const meta = await this.metaView(companyId, numbers)
      if (!meta) {
        results.push({ companyId, outcome: 'meta_unavailable', numbers: 0 })
        continue
      }
      let refreshed = 0
      for (const number of numbers) {
        const view = meta.find((m) => m.id === number.phone_number_id)
        const columns = view ? metaViewColumns(view) : {}
        if (Object.keys(columns).length === 0) continue
        unwrap(
          await this.db.from('whatsapp_phone_numbers').update(columns).eq('company_id', companyId).eq('id', number.id),
          "Record Meta's view of the WhatsApp number",
          null,
        )
        refreshed += 1
      }
      const named = update.displayPhoneNumber
        ? numbers.find((n) => meta.some((m) => m.id === n.phone_number_id && m.displayPhoneNumber?.replace(/\D/g, '') === update.displayPhoneNumber))
        : undefined
      if (named && update.messagingLimitTier) {
        const at = (occurredAt ?? new Date()).toISOString()
        unwrap(
          await this.db
            .from('whatsapp_phone_numbers')
            .update({ messaging_limit_tier: update.messagingLimitTier, messaging_limit_updated_at: at })
            .eq('company_id', companyId)
            .eq('id', named.id)
            .or(`messaging_limit_updated_at.is.null,messaging_limit_updated_at.lt.${at}`),
          "Record the WhatsApp number's messaging limit",
          null,
        )
      }
      results.push({ companyId, outcome: 'refreshed', numbers: refreshed })
    }
    return results
  }

  /** The account's numbers as Meta lists them, read with the credential of one of the company's numbers in it. */
  private async metaView(companyId: EntityId, numbers: readonly { id: string }[]): Promise<MetaPhoneNumber[] | null> {
    for (const number of numbers) {
      const management = await this.channels.manageNumber(companyId, number.id)
      if (!management.available) continue
      try {
        return await management.accountPhoneNumbers()
      } catch (error) {
        // Meta unreachable or throttling: the job retries. A refusal (e.g. an invalidated token) is recorded.
        if (error instanceof WhatsAppApiError && !error.retryable) return null
        throw error
      }
    }
    return null
  }
}

/**
 * A delivery status arrived for an outbound message the company has not recorded yet: Meta does not order its
 * callbacks, and a status can overtake the delivery worker's recordSent by moments. The job is retried with backoff
 * (the whole payload again: every message and status is applied once), and on its last attempt the status is
 * recorded as not found.
 */
export class StatusesNotYetRecordedError extends Error {
  constructor(count: number) {
    super(`${count} WhatsApp status update(s) name a message that is not recorded yet; retrying`)
    this.name = 'StatusesNotYetRecordedError'
  }
}

/** Only a status this recent may still be waiting for its send to be recorded. */
const STATUS_WAIT_MS = 15 * 60 * 1000

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
    @Inject(WORKER_ENV) private readonly env: Pick<WorkerEnv, 'WHATSAPP_APP_ID'>,
    private readonly queues: Pick<WorkerQueues, 'enqueueAll'>,
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
    const messages = new DatabaseInboundMessageStore(db)
    try {
      outcomes = await routeWebhookPayload(payload, {
        numbers: this.channels,
        store: messages,
        statuses: { record: (update) => recordProviderStatus(db, update) },
        accounts: accountEvents({ store: new DatabaseAccountEventStore(db, this.channels), appId: this.env.WHATSAPP_APP_ID }),
      })
      // The company's AI agent runs on each message (ticket 10), once per message whatever the retries.
      await this.queues.enqueueAll('whatsapp-agent', messages.forAgent)
      const waiting = isFinalAttempt(attempt) ? [] : outcomes.filter((o) => this.mayStillBeSent(o))
      if (waiting.length > 0) throw new StatusesNotYetRecordedError(waiting.length)
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
        statuses: outcomes.filter((o) => 'statusId' in o).length,
        accountEvents: outcomes.filter((o) => 'businessAccountId' in o).length,
        notHandled: outcomes.filter((o) => o.outcome === 'not_handled').length,
        invalid: outcomes.filter((o) => o.outcome === 'invalid').length,
      },
      'WhatsApp webhook payload routed',
    )
    return { outcome: 'processed', outcomes }
  }

  private mayStillBeSent(outcome: RoutingOutcome): boolean {
    if (!('statusId' in outcome) || outcome.outcome !== 'not_found') return false
    const at = outcome.occurredAt ? Date.parse(outcome.occurredAt) : Number.NaN
    return Number.isNaN(at) || this.clock.now().getTime() - at < STATUS_WAIT_MS
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
