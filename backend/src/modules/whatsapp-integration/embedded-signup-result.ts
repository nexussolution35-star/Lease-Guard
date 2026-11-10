import type { EmbeddedSignupExchangeFailure } from '../../infrastructure/whatsapp/embedded-signup-code-exchange'
import type { CompleteOnboardingBody, EmbeddedSignupEvent } from './whatsapp-onboarding.schemas'

/** What the onboarding session records about the popup's result (record_whatsapp_onboarding_result). */
export interface EmbeddedSignupRecord {
  event: EmbeddedSignupEvent
  embeddedSignupVersion?: 'v4' | 'v5'
  businessPortfolioId?: string
  messagingAccountIds: string[]
  phoneNumberId?: string
  isOnBusinessApp?: boolean
  currentStep?: string
  metaErrorCode?: string
  metaErrorMessage?: string
  metaSessionId?: string
}

/**
 * The next step for a session: exchange the code (`code_received`), or end it as `cancelled` / `failed`
 * with a message written for the admin (what happened and how to recover).
 */
export type EmbeddedSignupResult =
  | { status: 'code_received'; code: string; record: EmbeddedSignupRecord }
  | { status: 'cancelled' | 'failed'; record: EmbeddedSignupRecord; errorMessage: string }

const START_AGAIN = 'Click Connect WhatsApp Business to start again.'

/**
 * Reads the Embedded Signup result the browser forwarded. v5 session info lists `messaging_account_ids`;
 * the v4 shape has a single `waba_id` (it now means the messaging account id). A code is exchanged only for
 * a finish that says which account was shared; Meta returns the code only when the customer clicks Finish.
 */
export function interpretEmbeddedSignupResult(body: CompleteOnboardingBody): EmbeddedSignupResult {
  const info = body.sessionInfo ?? {}
  const v5 = info.messaging_account_ids !== undefined
  const messagingAccountIds = [...new Set(v5 ? info.messaging_account_ids : info.waba_id ? [info.waba_id] : [])]
  const record: EmbeddedSignupRecord = {
    event: body.event,
    ...(v5 ? { embeddedSignupVersion: 'v5' as const } : info.waba_id ? { embeddedSignupVersion: 'v4' as const } : {}),
    ...(info.business_id ? { businessPortfolioId: info.business_id } : {}),
    messagingAccountIds,
    ...(info.phone_number_id ? { phoneNumberId: info.phone_number_id } : {}),
    ...(info.is_on_biz_app === undefined ? {} : { isOnBusinessApp: info.is_on_biz_app }),
    ...(info.current_step ? { currentStep: info.current_step } : {}),
    ...(info.error_code ? { metaErrorCode: info.error_code } : {}),
    ...(info.error_message ? { metaErrorMessage: info.error_message } : {}),
    ...(info.session_id ? { metaSessionId: info.session_id } : {}),
  }

  if (body.event === 'CANCEL') {
    const step = info.current_step ? ` at the step "${info.current_step}"` : ''
    return {
      status: 'cancelled',
      record,
      errorMessage: `You closed Meta's signup${step} before it finished, so nothing was connected. ${START_AGAIN}`,
    }
  }
  if (body.event === 'ERROR') {
    const code = info.error_code ? ` (code ${info.error_code})` : ''
    const detail = info.error_message ? `: ${info.error_message}` : ''
    return {
      status: 'failed',
      record,
      errorMessage:
        `Meta reported an error during signup${code}${detail}. Nothing was connected. ${START_AGAIN} ` +
        'If the same error comes back, contact Nexus Solution support and quote the code.',
    }
  }
  if (!body.code) {
    return {
      status: 'failed',
      record,
      errorMessage:
        'Meta finished the signup without an authorisation code. This happens when the signup window is closed instead of ' +
        'clicking Finish on the last screen. Your WhatsApp Business Account may already be shared with LeaseGuard, but ' +
        `LeaseGuard cannot use it yet. ${START_AGAIN} At the end, click Finish.`,
    }
  }
  if (messagingAccountIds.length === 0) {
    return {
      status: 'failed',
      record,
      errorMessage:
        'Meta did not say which WhatsApp Business Account was shared, so LeaseGuard cannot connect it. Nothing was stored. ' +
        `${START_AGAIN} Keep this page open until the signup window closes by itself.`,
    }
  }
  return { status: 'code_received', code: body.code, record }
}

/** The admin's explanation of a failed code exchange. Nothing was stored in every case. */
export function exchangeFailureMessage(reason: EmbeddedSignupExchangeFailure | 'not_stored'): string {
  switch (reason) {
    case 'code_rejected':
      return (
        'Meta did not accept the authorisation code. The code expires about 30 seconds after signup, so a slow ' +
        `connection can cause this. Nothing was stored. ${START_AGAIN}`
      )
    case 'meta_unavailable':
      return `LeaseGuard could not reach Meta to finish connecting. Nothing was stored. Wait a few minutes, then ${START_AGAIN.charAt(0).toLowerCase()}${START_AGAIN.slice(1)}`
    case 'unexpected_response':
      return `Meta's answer did not include an access token. Nothing was stored. ${START_AGAIN} If it happens again, contact Nexus Solution support.`
    case 'not_stored':
      return `LeaseGuard could not store the connection. Nothing was connected. ${START_AGAIN} If it happens again, contact Nexus Solution support.`
  }
}
