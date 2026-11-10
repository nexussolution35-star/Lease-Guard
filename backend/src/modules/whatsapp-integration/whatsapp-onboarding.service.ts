import { ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { EntityId } from '@leaseguard/domain'

import { httpErrorFromDatabase } from '../../common/http/database-errors'
import { API_ENV } from '../../config/tokens'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { EmbeddedSignupExchangeError } from '../../infrastructure/whatsapp/embedded-signup-code-exchange'
import { exchangeFailureMessage, interpretEmbeddedSignupResult, type EmbeddedSignupRecord } from './embedded-signup-result'
import type { CompleteOnboardingBody } from './whatsapp-onboarding.schemas'

/** Starts verifying a number Embedded Signup just stored (WhatsAppNumbersService); never throws. */
export interface SignupVerification {
  verifyAfterSignup(db: DbClient, companyId: EntityId, phoneNumberId: string): Promise<boolean>
}

/** Injection token of the SignupVerification. */
export const SIGNUP_VERIFICATION = Symbol('SIGNUP_VERIFICATION')

/** Exchanges an Embedded Signup code for the business token (EmbeddedSignupCodeExchange; a fake in tests). */
export interface CodeExchanger {
  exchange(code: string): Promise<{ accessToken: string }>
}

/** Injection token of the CodeExchanger; null while the Meta app id or secret is not configured. */
export const EMBEDDED_SIGNUP_CODE_EXCHANGE = Symbol('EMBEDDED_SIGNUP_CODE_EXCHANGE')

/** The API settings this service reads (backend/src/config/env.ts). */
export interface OnboardingSettings {
  WHATSAPP_APP_ID?: string | undefined
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?: string | undefined
  WHATSAPP_APP_SECRET?: string | undefined
  WHATSAPP_GRAPH_API_VERSION: string
}

/** What the browser needs to open Meta's Embedded Signup for a new session. Public values only. */
export interface OnboardingSessionStart {
  sessionId: EntityId
  /** Single-use; sent back with the result. Only its hash is stored. */
  state: string
  expiresAt: string
  appId: string
  configId: string
  /** Graph API version for FB.init. */
  graphApiVersion: string
  /** FB.login `extras`: Embedded Signup v5. */
  extras: { version: 'v5' }
}

/** The outcome of an Embedded Signup, written for the admin. Never a token or code. */
export interface OnboardingResult {
  sessionId: EntityId
  status: 'exchanged' | 'cancelled' | 'failed'
  message: string
  /** Meta ids of the WhatsApp Business Accounts now recorded for the company. */
  businessAccountIds: string[]
  /** Meta ids of the numbers now pending verification. */
  phoneNumberIds: string[]
}

type RecordOutcome = 'recorded' | 'not_found' | 'expired' | 'already_used'

const STATE_ERRORS: Record<Exclude<RecordOutcome, 'recorded'>, () => Error> = {
  not_found: () => new NotFoundException('The WhatsApp signup session was not found'),
  already_used: () => new ConflictException('This WhatsApp signup was already completed. Click Connect WhatsApp Business to start again.'),
  // Also a session superseded by a newer signup of the same admin (start_whatsapp_onboarding expires it).
  expired: () =>
    new ConflictException(
      'This WhatsApp signup expired, or a newer one was started, before it was completed. Click Connect WhatsApp Business to start again.',
    ),
}

/**
 * Meta Embedded Signup for the active company (company admins). The caller's own database client runs
 * the onboarding functions (migration 20261110100600), which check that the caller is the admin who started
 * the session; the API never holds the service-role key. The code is exchanged synchronously, within its
 * ~30 second lifetime, and the token goes straight to Vault: it is never logged, returned or kept.
 */
@Injectable()
export class WhatsAppOnboardingService {
  private readonly logger = new Logger(WhatsAppOnboardingService.name)

  constructor(
    @Inject(API_ENV) private readonly settings: OnboardingSettings,
    @Inject(EMBEDDED_SIGNUP_CODE_EXCHANGE) private readonly exchanger: CodeExchanger | null,
    @Inject(SIGNUP_VERIFICATION) private readonly verification: SignupVerification,
  ) {}

  async start(db: DbClient, companyId: EntityId): Promise<OnboardingSessionStart> {
    const { appId, configId } = this.configured()
    const { data, error } = await db.rpc('start_whatsapp_onboarding', { p_company_id: companyId })
    if (error) throw httpErrorFromDatabase(error, 'Start a WhatsApp signup')
    const row = data?.[0]
    if (!row) throw new ServiceUnavailableException('The WhatsApp signup could not be started')
    return {
      sessionId: row.session_id,
      state: row.state,
      expiresAt: row.expires_at,
      appId,
      configId,
      graphApiVersion: this.settings.WHATSAPP_GRAPH_API_VERSION,
      extras: { version: 'v5' },
    }
  }

  async complete(db: DbClient, companyId: EntityId, sessionId: EntityId, body: CompleteOnboardingBody): Promise<OnboardingResult> {
    const exchanger = this.configuredExchanger()
    const result = interpretEmbeddedSignupResult(body)
    const outcome = await this.record(db, companyId, sessionId, body.state, result.status, result.record, result.status === 'code_received' ? undefined : result.errorMessage)
    if (outcome !== 'recorded') throw STATE_ERRORS[outcome]()

    if (result.status !== 'code_received') {
      this.logger.log(`WhatsApp signup ${sessionId} of company ${companyId}: ${result.status} (${body.event})`)
      return { sessionId, status: result.status, message: result.errorMessage, businessAccountIds: [], phoneNumberIds: [] }
    }

    let accessToken: string
    try {
      ;({ accessToken } = await exchanger.exchange(result.code))
    } catch (error) {
      const reason = error instanceof EmbeddedSignupExchangeError ? error.reason : 'meta_unavailable'
      this.logger.warn(`WhatsApp signup ${sessionId}: code exchange failed (${error instanceof Error ? error.message : 'unknown error'})`)
      return this.fail(db, companyId, sessionId, exchangeFailureMessage(reason))
    }

    const stored = await db.rpc('store_whatsapp_onboarding_token', { p_company_id: companyId, p_session_id: sessionId, p_access_token: accessToken })
    if (stored.error) {
      this.logger.error(`WhatsApp signup ${sessionId}: storing the business token failed (${stored.error.code})`)
      return this.fail(db, companyId, sessionId, exchangeFailureMessage('not_stored'))
    }
    const rows = stored.data ?? []
    const phoneNumberIds = rows.flatMap((row) => (row.phone_number_id ? [row.phone_number_id] : []))
    this.logger.log(`WhatsApp signup ${sessionId} of company ${companyId}: token stored, ${rows.length} account(s), ${phoneNumberIds.length} number(s)`)
    // Verification runs in the worker; the signup has succeeded whether or not it could be queued now.
    const queued = await Promise.all(phoneNumberIds.map((id) => this.verification.verifyAfterSignup(db, companyId, id)))
    return {
      sessionId,
      status: 'exchanged',
      message:
        phoneNumberIds.length === 0
          ? 'Your WhatsApp Business Account is shared with LeaseGuard, but Meta did not share a phone number. Add a number to the account in WhatsApp Manager, then connect again.'
          : queued.every(Boolean)
            ? 'WhatsApp Business is connected to LeaseGuard. The number is pending verification: LeaseGuard is checking it with Meta now, and it can send and receive messages once every check passes.'
            : 'WhatsApp Business is connected to LeaseGuard. The number is pending verification, but LeaseGuard could not start checking it with Meta yet: click Verify again on the number.',
      businessAccountIds: rows.map((row) => row.business_account_id),
      phoneNumberIds,
    }
  }

  private async record(
    db: DbClient,
    companyId: EntityId,
    sessionId: EntityId,
    state: string,
    status: 'code_received' | 'cancelled' | 'failed',
    record: EmbeddedSignupRecord,
    errorMessage: string | undefined,
  ): Promise<RecordOutcome> {
    const { data, error } = await db.rpc('record_whatsapp_onboarding_result', {
      p_company_id: companyId,
      p_session_id: sessionId,
      p_state: state,
      p_status: status,
      p_event: record.event,
      p_messaging_account_ids: record.messagingAccountIds,
      ...(record.embeddedSignupVersion ? { p_embedded_signup_version: record.embeddedSignupVersion } : {}),
      ...(record.businessPortfolioId ? { p_business_portfolio_id: record.businessPortfolioId } : {}),
      ...(record.phoneNumberId ? { p_phone_number_id: record.phoneNumberId } : {}),
      ...(record.isOnBusinessApp === undefined ? {} : { p_is_on_business_app: record.isOnBusinessApp }),
      ...(record.currentStep ? { p_current_step: record.currentStep } : {}),
      ...(record.metaErrorCode ? { p_meta_error_code: record.metaErrorCode } : {}),
      ...(record.metaErrorMessage ? { p_meta_error_message: record.metaErrorMessage } : {}),
      ...(record.metaSessionId ? { p_meta_session_id: record.metaSessionId } : {}),
      ...(errorMessage ? { p_error_message: errorMessage } : {}),
    })
    if (error) throw httpErrorFromDatabase(error, 'Record a WhatsApp signup result')
    return data as RecordOutcome
  }

  private async fail(db: DbClient, companyId: EntityId, sessionId: EntityId, message: string): Promise<OnboardingResult> {
    const { error } = await db.rpc('fail_whatsapp_onboarding_exchange', { p_company_id: companyId, p_session_id: sessionId, p_error_message: message })
    if (error) throw httpErrorFromDatabase(error, 'Record a failed WhatsApp signup')
    return { sessionId, status: 'failed', message, businessAccountIds: [], phoneNumberIds: [] }
  }

  private configured(): { appId: string; configId: string } {
    const { WHATSAPP_APP_ID: appId, WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: configId } = this.settings
    if (!appId || !configId || !this.settings.WHATSAPP_APP_SECRET || !this.exchanger) throw notConfigured()
    return { appId, configId }
  }

  private configuredExchanger(): CodeExchanger {
    this.configured()
    if (!this.exchanger) throw notConfigured()
    return this.exchanger
  }
}

function notConfigured(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    'Embedded Signup is not configured for this LeaseGuard installation (WHATSAPP_APP_ID, WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID and WHATSAPP_APP_SECRET on the API)',
  )
}
