import type { EntityId, WhatsAppTestMessageStatus } from '@leaseguard/domain'

import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { WhatsAppApiError, type WhatsAppChannels } from '../../infrastructure/whatsapp/whatsapp-channels'

/** A test message and the facts the send re-checks (they may have changed since the admin asked). */
export interface TestMessageToSend {
  status: WhatsAppTestMessageStatus
  toNumber: string
  templateName: string
  templateLanguage: string
  /** Meta phone number id of the number it is sent from. */
  phoneNumberId: string
  numberConnected: boolean
  /** Meta still holds the template, approved, in the number's account. */
  templateApproved: boolean
  /** The recipient is now a tenant of the company: tenants never receive a test message. */
  recipientIsTenant: boolean
}

/** The test message's record; every call names the job's company. */
export interface TestMessageStore {
  load(companyId: EntityId, testMessageId: EntityId): Promise<TestMessageToSend | null>
  /** queued -> sending; true for exactly one caller. */
  claim(companyId: EntityId, testMessageId: EntityId): Promise<boolean>
  /** sending -> queued, before a retry (Meta refused, so nothing was sent). */
  release(companyId: EntityId, testMessageId: EntityId): Promise<void>
  recordSent(companyId: EntityId, testMessageId: EntityId, providerMessageId: string): Promise<void>
  /** queued or sending -> failed. */
  recordFailed(companyId: EntityId, testMessageId: EntityId, reason: string, mayHaveBeenSent: boolean): Promise<void>
}

export type TestMessageOutcome =
  | { outcome: 'sent'; providerMessageId: string }
  | { outcome: 'skipped' }
  | { outcome: 'failed'; reason: string }

/**
 * Sends one test message: the admin's approved Meta template, without parameters, from the chosen connected number.
 * At most one send (the queued -> sending claim); a refusal Meta may lift (throttling) is retried by the job after the
 * claim is handed back; an unknown outcome is never retried. Being sent does not complete the setup step: only Meta's
 * delivered or read status does (record_whatsapp_test_message_status, from the webhook).
 *
 * Every run that ends without a retry leaves the record final (failed or sent): a transient failure (database, vault)
 * is thrown for the job to retry, but on the final attempt it is recorded as failed, so the setup step never waits on
 * Meta for a message Meta never received.
 */
export async function sendTestMessage(
  deps: { store: TestMessageStore; channels: Pick<WhatsAppChannels, 'forCompany'> },
  { companyId, testMessageId }: JobPayloads['whatsapp-test-message'],
  { finalAttempt }: { finalAttempt: boolean },
): Promise<TestMessageOutcome> {
  const { store, channels } = deps
  const fail = async (reason: string, mayHaveBeenSent = false): Promise<TestMessageOutcome> => {
    await store.recordFailed(companyId, testMessageId, reason, mayHaveBeenSent)
    return { outcome: 'failed', reason }
  }
  /** A transient failure before anything was sent: retried, or recorded as failed on the final attempt. */
  const failedBeforeSend = async (error: unknown): Promise<TestMessageOutcome> => {
    if (!finalAttempt) throw error
    try {
      return await fail(`The test message could not be sent (${errorMessage(error)}). Nothing was sent; try again.`)
    } catch {
      throw error
    }
  }

  let message: TestMessageToSend | null
  let channel: Awaited<ReturnType<WhatsAppChannels['forCompany']>>
  try {
    message = await store.load(companyId, testMessageId)
    if (!message || message.status !== 'queued') return { outcome: 'skipped' }

    if (!message.numberConnected) return await fail('The number is no longer connected, so the test message was not sent.')
    if (!message.templateApproved) return await fail(`Template "${message.templateName}" is no longer approved by Meta, so the test message was not sent.`)
    if (message.recipientIsTenant) return await fail('The number belongs to a tenant. Tenants only receive approved statement and payment messages.')

    channel = await channels.forCompany(companyId, { phoneNumberId: message.phoneNumberId })
    if (!channel.available) return await fail(channel.message)

    if (!(await store.claim(companyId, testMessageId))) return { outcome: 'skipped' }
  } catch (error) {
    return failedBeforeSend(error)
  }

  let providerMessageId: string
  try {
    ;({ messageId: providerMessageId } = await channel.send(message.toNumber, {
      type: 'template',
      template: { name: message.templateName, language: { code: message.templateLanguage }, components: [] },
    }))
  } catch (error) {
    if (error instanceof WhatsAppApiError && !error.outcomeUnknown) {
      if (error.retryable && !finalAttempt) {
        try {
          await store.release(companyId, testMessageId)
        } catch {
          // Still 'sending', the retry would skip it: Meta refused, so nothing was sent and the record ends here.
          return fail(error.message)
        }
        throw error
      }
      return fail(error.message)
    }
    return fail(`WhatsApp did not confirm the send (${errorMessage(error)}); it may have been sent. Check the phone before sending another.`, true)
  }
  try {
    await store.recordSent(companyId, testMessageId, providerMessageId)
  } catch (error) {
    // Still 'sending', the retry would skip it: record it final (sent, but untracked) so the step does not wait forever.
    return fail(`WhatsApp accepted the test message, but it could not be recorded (${errorMessage(error)}). Check the phone; send another to complete the step.`, true)
  }
  return { outcome: 'sent', providerMessageId }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
