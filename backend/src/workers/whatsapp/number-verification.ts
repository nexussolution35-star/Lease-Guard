import {
  WHATSAPP_VERIFICATION_STEPS,
  type EntityId,
  type WhatsAppConnectionStatus,
  type WhatsAppVerificationStep,
  type WhatsAppVerificationStepStatus,
} from '@leaseguard/domain'

import {
  type MetaMessageTemplate,
  type MetaPhoneNumber,
  type NumberManagement,
  WhatsAppApiError,
  type WhatsAppChannels,
} from '../../infrastructure/whatsapp/whatsapp-channels'

/**
 * Verifies one business number with Meta before LeaseGuard connects it. The steps, in order:
 *
 * 1. token_scopes: Meta's debug_token says the business token is valid and its granular scopes cover the
 *    number's WhatsApp Business Account for whatsapp_business_management and whatsapp_business_messaging;
 * 2. phone_number: Meta lists the number in that account; Meta's view of it is recorded;
 * 3. webhook_subscription: LeaseGuard's app is subscribed to the account's webhooks;
 * 4. registration: not required for a WhatsApp Business app number (coexistence) or a number Meta already
 *    reports on the Cloud API; otherwise registered with the admin's PIN, or waiting for one (action needed);
 * 5. message_templates: the account's templates are synced.
 *
 * Every outcome is recorded as it happens (the integration page shows progress) and the database decides the
 * number's status from the recorded steps (finish_whatsapp_number_verification): connected only when every step
 * passed. The first failed step stops the run; the steps after it stay "not checked".
 *
 * Retries: transient failures (Meta unreachable, throttling, database) are thrown so BullMQ retries the job with
 * backoff, except on its final attempt, when the step is recorded failed. Registration is never retried
 * automatically: the PIN is taken (and deleted) before Meta is called, Meta allows 10 attempts per 72 hours, and
 * its rate-limit error (133016) records a lock that the API enforces. Re-running the whole job is safe: Meta's
 * subscription is idempotent, a registered number is recognised, and the template sync replaces the catalogue.
 */

/** Meta: too many registration attempts; registration is locked for 72 hours. */
export const REGISTRATION_RATE_LIMIT_CODE = 133016
export const REGISTRATION_LOCK_HOURS = 72

const REQUIRED_SCOPES = ['whatsapp_business_management', 'whatsapp_business_messaging'] as const

/** One step's outcome, written for the company admin. Never a token, PIN or secret. */
export interface StepRecord {
  step: WhatsAppVerificationStep
  status: WhatsAppVerificationStepStatus
  message: string
  recovery?: string
  metaErrorCode?: string
}

/** What the run needs to know about the number before calling Meta. */
export interface NumberToVerify {
  connectionStatus: WhatsAppConnectionStatus
  /** Meta's registration lock (error 133016), if one is recorded. */
  registrationBlockedUntil: Date | null
  /** Embedded Signup reported a WhatsApp Business app number (coexistence): Meta registers it itself. */
  onBusinessApp: boolean
  /**
   * A Nexus operator connected the number with the number import (operator_imported_at): its token comes from the
   * installation's test-number settings, so the admin recovers through Nexus Solution, not Embedded Signup.
   */
  importedByOperator: boolean
}

/** Where verification reads and records (the database, with the service role; a fake in tests). */
export interface VerificationStore {
  load(companyId: EntityId, numberId: EntityId): Promise<NumberToVerify | null>
  recordSteps(companyId: EntityId, numberId: EntityId, steps: readonly StepRecord[]): Promise<void>
  recordMetaView(companyId: EntityId, numberId: EntityId, number: MetaPhoneNumber): Promise<void>
  blockRegistration(companyId: EntityId, numberId: EntityId, until: Date): Promise<void>
  syncTemplates(companyId: EntityId, businessAccountId: string, templates: readonly MetaMessageTemplate[]): Promise<number>
  finish(companyId: EntityId, numberId: EntityId): Promise<WhatsAppConnectionStatus>
}

/** Takes the number's registration PIN if the admin entered one (single use). */
export interface PinSource {
  take(companyId: EntityId, numberId: EntityId): Promise<string | null>
}

export interface VerificationDeps {
  channels: WhatsAppChannels
  store: VerificationStore
  pins: PinSource
  now: () => Date
}

export type VerificationOutcome =
  | { outcome: 'skipped'; reason: 'not_found' | 'disconnected' }
  | { outcome: 'verified'; status: WhatsAppConnectionStatus; steps: StepRecord[] }

/** The run cannot finish now; BullMQ retries the job with backoff. */
export class TransientVerificationError extends Error {
  constructor(step: WhatsAppVerificationStep, cause: unknown) {
    super(`Verification step ${step} failed transiently: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'TransientVerificationError'
  }
}

const RECONNECT = 'Click Connect WhatsApp Business and complete Meta’s signup again for this number.'
const IMPORT_AGAIN =
  'Ask Nexus Solution to import the number again with a current access token for this WhatsApp Business Account (pnpm whatsapp:import-test-number); the import verifies it again.'
const IMPORT_WITH_RIGHT_IDS =
  'Check the number in WhatsApp Manager, then ask Nexus Solution to import it again with the right phone number id and WhatsApp Business Account id.'
const VERIFY_AGAIN = 'Click Verify again in a few minutes. If it keeps failing, contact Nexus Solution support.'

function transient(error: unknown): boolean {
  if (error instanceof WhatsAppApiError) return error.retryable
  // Database and vault errors (WorkerDatabaseError, ChannelLookupError) are transient.
  return true
}

function metaRefusal(error: unknown): { message: string; metaErrorCode?: string } {
  if (error instanceof WhatsAppApiError && error.graphCode !== undefined) {
    return { message: `Meta refused the request (error ${error.graphCode}).`, metaErrorCode: String(error.graphCode) }
  }
  return { message: 'Meta returned an unexpected answer.' }
}

const DATE_TIME = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' })

function covers(scopes: readonly { scope: string; targetIds?: string[] }[], scope: string, accountId: string): boolean {
  return scopes.some((s) => s.scope === scope && (s.targetIds === undefined || s.targetIds.includes(accountId)))
}

export async function verifyNumber(
  { companyId, numberId }: { companyId: EntityId; numberId: EntityId },
  { finalAttempt }: { finalAttempt: boolean },
  deps: VerificationDeps,
): Promise<VerificationOutcome> {
  const { store } = deps
  const number = await store.load(companyId, numberId)
  if (!number) return { outcome: 'skipped', reason: 'not_found' }
  if (number.connectionStatus === 'disconnected') return { outcome: 'skipped', reason: 'disconnected' }

  // How the admin gets a new token: Meta's signup, or Nexus Solution's number import.
  const reconnect = number.importedByOperator ? IMPORT_AGAIN : RECONNECT
  const steps: StepRecord[] = []
  const record = async (result: StepRecord): Promise<void> => {
    steps.push(result)
    await store.recordSteps(companyId, numberId, [result])
  }
  const finish = async (): Promise<VerificationOutcome> => {
    const remaining = WHATSAPP_VERIFICATION_STEPS.filter((step) => !steps.some((s) => s.step === step))
    if (remaining.length > 0) {
      await store.recordSteps(
        companyId,
        numberId,
        remaining.map((step) => ({ step, status: 'pending', message: 'Not checked: an earlier step did not pass.' })),
      )
    }
    return { outcome: 'verified', status: await store.finish(companyId, numberId), steps }
  }
  /** A step's call failed: retry the job when transient (unless final), else record the failure and stop. */
  const failed = async (step: WhatsAppVerificationStep, error: unknown, permanent: Omit<StepRecord, 'step' | 'status'>): Promise<VerificationOutcome> => {
    if (transient(error)) {
      if (!finalAttempt) throw new TransientVerificationError(step, error)
      await record({ step, status: 'failed', message: 'LeaseGuard could not reach Meta to check this.', recovery: VERIFY_AGAIN })
    } else {
      await record({ step, status: 'failed', ...permanent })
    }
    return finish()
  }

  await store.recordSteps(
    companyId,
    numberId,
    WHATSAPP_VERIFICATION_STEPS.map((step) => ({ step, status: 'pending', message: 'Checking with Meta…' })),
  )

  let management: NumberManagement
  try {
    const lookup = await deps.channels.manageNumber(companyId, numberId)
    if (!lookup.available) {
      await record({ step: 'token_scopes', status: 'failed', message: lookup.message, recovery: reconnect })
      return finish()
    }
    management = lookup
  } catch (error) {
    if (!finalAttempt) throw new TransientVerificationError('token_scopes', error)
    await record({ step: 'token_scopes', status: 'failed', message: 'LeaseGuard could not load the stored token.', recovery: VERIFY_AGAIN })
    return finish()
  }
  const accountId = management.businessAccountId

  // 1. Token scopes
  try {
    const inspection = await management.inspectToken()
    if (inspection === null) {
      await record({
        step: 'token_scopes',
        status: 'failed',
        message: 'LeaseGuard cannot check the token: the worker has no Meta app id and secret (WHATSAPP_APP_ID, WHATSAPP_APP_SECRET).',
        recovery: 'Ask Nexus Solution to configure the Meta app on the LeaseGuard worker, then click Verify again.',
      })
      return finish()
    }
    if (!inspection.isValid) {
      await record({ step: 'token_scopes', status: 'failed', message: 'Meta reports that the business token is no longer valid (it was revoked or expired).', recovery: reconnect })
      return finish()
    }
    const missing = REQUIRED_SCOPES.filter((scope) => !covers(inspection.granularScopes, scope, accountId))
    if (missing.length > 0) {
      await record({
        step: 'token_scopes',
        status: 'failed',
        message: `The business token does not cover WhatsApp Business Account ${accountId} for ${missing.join(' and ')}.`,
        recovery: number.importedByOperator ? IMPORT_AGAIN : `${RECONNECT} In Meta’s window, share this WhatsApp Business Account with LeaseGuard.`,
      })
      return finish()
    }
    await record({ step: 'token_scopes', status: 'passed', message: `The business token is valid and covers WhatsApp Business Account ${accountId}.` })
  } catch (error) {
    return failed('token_scopes', error, { ...metaRefusal(error), recovery: reconnect })
  }

  // 2. The number in its account
  let meta: MetaPhoneNumber
  try {
    const found = (await management.accountPhoneNumbers()).find((n) => n.id === management.phoneNumberId)
    if (!found) {
      await record({
        step: 'phone_number',
        status: 'failed',
        message: `Meta does not list number id ${management.phoneNumberId} in WhatsApp Business Account ${accountId}.`,
        recovery: number.importedByOperator ? IMPORT_WITH_RIGHT_IDS : 'Check the number in WhatsApp Manager, then connect it again with Connect WhatsApp Business.',
      })
      return finish()
    }
    meta = found
    await store.recordMetaView(companyId, numberId, meta)
    await record({ step: 'phone_number', status: 'passed', message: `Meta lists ${meta.displayPhoneNumber ?? `number id ${meta.id}`} in this account.` })
  } catch (error) {
    return failed('phone_number', error, { ...metaRefusal(error), recovery: VERIFY_AGAIN })
  }

  // 3. Webhook subscription
  try {
    await management.subscribeApp()
    await record({ step: 'webhook_subscription', status: 'passed', message: 'LeaseGuard receives this account’s messages and delivery updates.' })
  } catch (error) {
    return failed('webhook_subscription', error, {
      ...metaRefusal(error),
      recovery: 'Check that LeaseGuard still has access to the account in Meta Business Settings, then click Verify again.',
    })
  }

  // 4. Registration (never retried automatically)
  if (number.onBusinessApp) {
    await record({ step: 'registration', status: 'not_required', message: 'A WhatsApp Business app number: Meta registered it during signup.' })
  } else if (meta.platformType === 'CLOUD_API' || meta.status === 'CONNECTED') {
    await record({ step: 'registration', status: 'passed', message: 'Meta reports the number is registered for the WhatsApp Cloud API.' })
  } else {
    const blocked = number.registrationBlockedUntil && number.registrationBlockedUntil > deps.now() ? number.registrationBlockedUntil : null
    const pin = blocked ? null : await deps.pins.take(companyId, numberId)
    if (blocked) {
      await record({
        step: 'registration',
        status: 'failed',
        message: `Meta has locked registration of this number after too many attempts, until ${DATE_TIME.format(blocked)}.`,
        recovery: 'Wait until then and enter the PIN once more. Do not retry before: each attempt extends Meta’s lock.',
        metaErrorCode: String(REGISTRATION_RATE_LIMIT_CODE),
      })
      return finish()
    }
    if (pin === null) {
      await record({
        step: 'registration',
        status: 'action_needed',
        message: 'The number must be registered for the WhatsApp Cloud API.',
        recovery:
          'Click Register number and enter a 6-digit PIN. If the number already has two-step verification, enter that PIN; otherwise the PIN you choose becomes it. LeaseGuard never stores the PIN.',
      })
    } else {
      try {
        await management.register(pin)
        await record({ step: 'registration', status: 'passed', message: 'The number is registered for the WhatsApp Cloud API.' })
      } catch (error) {
        if (error instanceof WhatsAppApiError && error.graphCode === REGISTRATION_RATE_LIMIT_CODE) {
          const until = new Date(deps.now().getTime() + REGISTRATION_LOCK_HOURS * 3600_000)
          await store.blockRegistration(companyId, numberId, until)
          await record({
            step: 'registration',
            status: 'failed',
            message: `Meta allows 10 registration attempts per 72 hours and has locked this number until ${DATE_TIME.format(until)}.`,
            recovery: 'Wait until then and enter the PIN once more. Do not retry before: each attempt extends Meta’s lock.',
            metaErrorCode: String(REGISTRATION_RATE_LIMIT_CODE),
          })
          return finish()
        }
        const unreachable = !(error instanceof WhatsAppApiError) || error.retryable || error.outcomeUnknown
        await record({
          step: 'registration',
          status: 'failed',
          ...(unreachable
            ? { message: 'LeaseGuard could not complete the registration with Meta.' }
            : {
                ...metaRefusal(error),
                message: `Meta refused the registration${error.graphCode === undefined ? '' : ` (error ${error.graphCode})`}. The PIN may not match the number’s two-step verification PIN.`,
              }),
          recovery: 'Click Verify again to check whether it registered; if not, click Register number and enter the PIN again.',
        })
        return finish()
      }
    }
  }

  // 5. Message templates
  try {
    const templates = await management.templates()
    const count = await store.syncTemplates(companyId, accountId, templates)
    const approved = templates.filter((t) => t.status.toUpperCase() === 'APPROVED').length
    await record({ step: 'message_templates', status: 'passed', message: `${count} message template(s) synced from Meta, ${approved} approved.` })
  } catch (error) {
    return failed('message_templates', error, { ...metaRefusal(error), recovery: VERIFY_AGAIN })
  }

  return finish()
}
