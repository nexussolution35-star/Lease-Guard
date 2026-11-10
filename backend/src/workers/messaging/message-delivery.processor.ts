import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import type { EntityId } from '@leaseguard/domain'
import { UnrecoverableError } from 'bullmq'

import type { Tables } from '../../infrastructure/database/database.types'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { WhatsAppApiError, type WhatsAppChannel, WhatsAppChannels, type WhatsAppMessage } from '../../infrastructure/whatsapp/whatsapp-channels'
import {
  claim,
  type CommunicationRef,
  type DeliveryFailure,
  deliveryState,
  recordFailed,
  recordSent,
  release,
  type SendClaim,
} from '../../messaging/communication-lifecycle'
import { checkOutbound } from '../../messaging/outbound-gate'
import { isFinalAttempt, type JobAttempt, ProcessorRuntime } from '../jobs/processor-runtime'
import { Clock } from '../shared/clock'
import { unwrap } from '../shared/db'
import { MonitoringOutputs } from '../shared/monitoring-outputs'
import { StatementFiles, StorageDownloadError } from '../shared/statement-files'

type CommunicationRow = Tables<'communications'>

export type DeliveryOutcome =
  | { outcome: 'already_sent'; externalMessageId: string | null }
  | { outcome: 'sent'; externalMessageId: string }

/** The message must not or cannot be sent; it is marked failed with this reason and never retried. */
class PermanentDeliveryError extends Error {}

/**
 * The outbound gate found blockers. Not retryable: BullMQ fails the job immediately instead of retrying
 * a message that must not be sent.
 */
export class UndeliverableMessageError extends UnrecoverableError {
  readonly reasons: readonly string[]

  constructor(reasons: readonly string[]) {
    super(`Message must not be delivered: ${reasons.join('; ')}`)
    this.name = 'UndeliverableMessageError'
    this.reasons = reasons
  }
}

interface PreparedDelivery {
  channel: WhatsAppChannel
  to: string
  message: WhatsAppMessage
}

/**
 * Sends one approved communication through the company's WhatsApp Business account.
 *
 * Every status change goes through the communication lifecycle module (messaging/communication-lifecycle);
 * this processor decides WHEN to claim, release and record, never how.
 *
 * - Idempotent: a message with an external id (or already sent) is skipped; after a successful send the
 *   job never retries, even if saving the result fails, so a tenant is never messaged twice.
 * - At most one send per message: immediately before calling WhatsApp the run claims the message
 *   (`approved` → `queued`, which only one run can win, and which records that the message may now be
 *   sent). A run that finds the message possibly sent (an earlier run died, stalled or lost its lock
 *   after its claim) never sends; it records the failure as possibly sent for a person to check. Only
 *   the run holding the claim (its SendClaim) can hand it back (`queued` → `approved`, before a retry)
 *   or record that nothing was sent; a run that fails before its own claim passes no claim, so it can
 *   never clear another run's possibly-sent fact.
 * - A send whose outcome is unknown (network error or timeout after the request went out, HTTP 5xx,
 *   a success without a message id) is never retried: Meta may have accepted it. The failure is recorded
 *   as possibly sent, which the approve endpoint reads (`mayRetryDelivery`) before running a job again.
 * - Immediately before claiming, every send passes the outbound gate (`checkOutbound`, shared with the
 *   approve endpoint): an approved approval that names its approver, the recipient's unchanged number,
 *   the @leaseguard/domain eligibility and content rules, a connected channel, an approved matching
 *   template and a buildable message. Any blocker fails the message with every reason.
 * - The message goes out through the company's own channel (WhatsAppChannels.forCompany); a channel the
 *   gate passed can still be unavailable here (no usable access token), which fails the message too.
 * - Transient failures before the send (storage, media upload, database) and refusals of the send itself
 *   (HTTP 408/429, Graph throttling codes) are retried; permanent ones (other 4xx, gating failures,
 *   configuration problems) mark the message failed with the reason and notify the manager.
 */
@Injectable()
export class MessageDeliveryProcessor implements OnModuleInit {
  private readonly logger = new Logger(MessageDeliveryProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
    private readonly channels: WhatsAppChannels,
    private readonly files: StatementFiles,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.runtime.start('message-delivery', (payload, attempt) => this.deliver(payload, attempt), { concurrency: 4 })
  }

  async deliver({ companyId, communicationId }: JobPayloads['message-delivery'], attempt: JobAttempt): Promise<DeliveryOutcome> {
    const db = this.clients.get()
    const communicationResult = await db.from('communications').select('*').eq('company_id', companyId).eq('id', communicationId).maybeSingle()
    const communication = unwrap(communicationResult, 'Load communication', null)
    if (!communication) throw new UnrecoverableError(`Communication ${communicationId} does not exist in company ${companyId}`)
    const state = deliveryState(communication)
    if (state === 'already_sent') {
      this.logger.log({ companyId, communicationId, status: communication.status }, 'Message already sent; skipping')
      return { outcome: 'already_sent', externalMessageId: communication.external_message_id }
    }
    if (communication.direction !== 'outbound' || communication.channel !== 'whatsapp') {
      throw new UnrecoverableError(`Communication ${communicationId} is not an outbound WhatsApp message`)
    }
    if (state === 'possibly_sent') {
      // An earlier run claimed the message and never recorded the result: it may have been sent. A
      // message already failed or stopped with this fact keeps its state (the lifecycle answers false).
      throw await this.fail(db, refOf(communication), communication, possiblySent('an earlier delivery attempt started sending it and did not record the result'))
    }
    if (state !== 'sendable') {
      // Not approved (draft, pending approval, rejected, failed): nothing is sent and the record is left as is.
      throw new UnrecoverableError(`Communication ${communicationId} is ${communication.status}, not approved for sending`)
    }

    let prepared: PreparedDelivery
    try {
      prepared = await this.prepare(db, communication)
    } catch (error) {
      // No claim held: if another run claimed the message meanwhile, this failure cannot touch it.
      throw await this.failedBeforeSend(db, refOf(communication), communication, error, attempt)
    }

    // A database failure here is retried like any other before the send: nothing was sent.
    const held = await claim(db, refOf(communication))
    if (!held) {
      // Another run claimed it first (or its status changed since it was loaded); that run owns the send.
      throw new UnrecoverableError(`Communication ${communication.id} was claimed by another delivery attempt; not sending it again`)
    }
    let messageId: string
    try {
      ;({ messageId } = await prepared.channel.send(prepared.to, prepared.message))
    } catch (error) {
      if (!(error instanceof WhatsAppApiError) || error.outcomeUnknown) {
        // Meta may have accepted the message; another send could message the recipient twice.
        throw await this.fail(db, held, communication, possiblySent(`WhatsApp did not confirm the send (${errorMessage(error)})`))
      }
      // WhatsApp refused the message, so nothing was sent; this run holds the claim, so it may say so.
      if (error.retryable && !isFinalAttempt(attempt)) await this.releaseClaim(db, held)
      throw await this.failedBeforeSend(db, held, communication, error, attempt)
    }

    await this.recordSent(db, communication, messageId)
    this.logger.log({ companyId, communicationId, messageType: communication.message_type }, 'WhatsApp message sent')
    return { outcome: 'sent', externalMessageId: messageId }
  }

  /**
   * A failure after which nothing was sent by this run. Returns the error to throw: the original one
   * when BullMQ should retry, else an UnrecoverableError after the message has been marked failed.
   * `subject` is this run's SendClaim when it holds one, else the message's ref.
   */
  private async failedBeforeSend(
    db: DbClient,
    subject: CommunicationRef | SendClaim,
    communication: CommunicationRow,
    error: unknown,
    attempt: JobAttempt,
  ): Promise<unknown> {
    const permanent =
      error instanceof PermanentDeliveryError ||
      error instanceof UndeliverableMessageError ||
      ((error instanceof WhatsAppApiError || error instanceof StorageDownloadError) && !error.retryable)
    if (!permanent && !isFinalAttempt(attempt)) return error
    const reason = errorMessage(error)
    return this.fail(db, subject, communication, {
      reason: permanent ? reason : `Delivery failed after ${attempt.attempt} attempts: ${reason}`,
      mayHaveBeenSent: false,
    })
  }

  /**
   * Hands the claim back after WhatsApp refused the message, so the retry can send it. If this fails the
   * message stays `queued`, and the retry treats it as possibly sent: no duplicate.
   */
  private async releaseClaim(db: DbClient, held: SendClaim): Promise<void> {
    try {
      await release(db, held)
    } catch (error) {
      this.logger.warn(
        { companyId: held.companyId, communicationId: held.communicationId, err: errorMessage(error) },
        'Could not release the send claim; the retry will treat the message as possibly sent',
      )
    }
  }

  /** The gate's verdict, the channel and the uploaded attachment. Throws UndeliverableMessageError / PermanentDeliveryError. */
  private async prepare(db: DbClient, communication: CommunicationRow): Promise<PreparedDelivery> {
    const companyId = communication.company_id
    // A failed read (MessagingReadError) is retried like any database failure: nothing was sent.
    const verdict = await checkOutbound(db, { companyId, communicationId: communication.id }, this.clock.today())
    if (!verdict.deliverable) throw new UndeliverableMessageError(verdict.blockers)
    const { delivery } = verdict

    // A transient lookup failure (ChannelLookupError) is retried like any database failure.
    const channel = await this.channels.forCompany(companyId)
    if (!channel.available) throw new PermanentDeliveryError(channel.message)

    let mediaId: string | undefined
    if (delivery.attachment) {
      const file = await this.files.download(companyId, delivery.attachment.storagePath)
      ;({ mediaId } = await channel.uploadMedia(file, delivery.attachment.fileName, delivery.attachment.mimeType))
    }
    return { channel, to: delivery.to, message: delivery.message(mediaId) }
  }

  /**
   * Records the sent message. Retried a few times in-process; if it still cannot be saved the job fails
   * WITHOUT retry (a retry would message the recipient again) and the WhatsApp id is logged for repair.
   * The message stays possibly sent (the claim recorded that), so nothing will send it again.
   */
  private async recordSent(db: DbClient, communication: CommunicationRow, messageId: string): Promise<void> {
    let problem = ''
    for (let tryNumber = 1; tryNumber <= 3; tryNumber++) {
      try {
        const outcome = await recordSent(db, refOf(communication), messageId)
        if (outcome === 'recorded' || outcome === 'already_recorded') return
        // Not a transient failure: the record no longer matches this send. Retrying cannot fix it.
        problem = `the lifecycle answered ${outcome}`
        break
      } catch (error) {
        problem = errorMessage(error)
        await new Promise((resolve) => setTimeout(resolve, 250 * tryNumber))
      }
    }
    this.logger.error(
      { companyId: communication.company_id, communicationId: communication.id, externalMessageId: messageId, err: problem },
      'Message SENT but its status could not be saved; not retrying to avoid a duplicate send',
    )
    throw new UnrecoverableError(`Message sent as ${messageId} but its status could not be saved: ${problem}`)
  }

  /**
   * Records the failure (and whether the message may have been sent) and tells the responsible property
   * manager. Returns the error that ends the job without retry. A message that is no longer approved or
   * queued (a person stopped it, or it was sent meanwhile), or is queued under another run's claim,
   * keeps its state and nobody is notified.
   */
  private async fail(
    db: DbClient,
    subject: CommunicationRef | SendClaim,
    communication: CommunicationRow,
    failure: DeliveryFailure,
  ): Promise<UnrecoverableError> {
    const companyId = communication.company_id
    // A database failure here is retried by BullMQ; the retry finds the message as this run left it.
    const recorded = await recordFailed(db, subject, failure)
    if (!recorded) {
      this.logger.warn({ companyId, communicationId: communication.id, reason: failure.reason }, 'Delivery failed, but the message had already moved on')
      return new UnrecoverableError(failure.reason)
    }

    const recipient = await this.responsibleUser(db, communication)
    if (recipient) {
      await new MonitoringOutputs(db, companyId).notify([
        {
          dedupeKey: `message_failed:${communication.id}:${recipient}`,
          userId: recipient,
          type: 'message_failed',
          severity: 'warning',
          title: 'WhatsApp message could not be sent',
          body: `The ${communication.message_type.replaceAll('_', ' ')} message to ${communication.counterparty_number} was not sent: ${failure.reason.slice(0, 2000)}`,
          link: { entityType: 'communication', entityId: communication.id },
        },
      ])
    }
    this.logger.warn(
      { companyId, communicationId: communication.id, reason: failure.reason, mayHaveBeenSent: failure.mayHaveBeenSent },
      'Message delivery failed permanently',
    )
    return new UnrecoverableError(failure.reason)
  }

  /** The property manager of the message's property, else the user who created the message. */
  private async responsibleUser(db: DbClient, communication: CommunicationRow): Promise<EntityId | undefined> {
    if (communication.property_id) {
      const propertyResult = await db
        .from('properties')
        .select('manager_user_id')
        .eq('company_id', communication.company_id)
        .eq('id', communication.property_id)
        .maybeSingle()
      const property = unwrap(propertyResult, 'Load message property', null)
      if (property) return property.manager_user_id
    }
    return communication.created_by_user_id ?? undefined
  }
}

function refOf(communication: CommunicationRow): CommunicationRef {
  return { companyId: communication.company_id, communicationId: communication.id }
}

/** A failure after which WhatsApp may have accepted the message: a person checks before any resend. */
function possiblySent(detail: string): DeliveryFailure {
  return {
    reason: `Message may have been sent: ${detail}; check the WhatsApp conversation before sending it again`,
    mayHaveBeenSent: true,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
