import type {
  CompleteWhatsAppOnboardingDto,
  WhatsAppBusinessAccountDto,
  WhatsAppCapabilitiesDto,
  WhatsAppDisconnectResultDto,
  WhatsAppMessageTemplateDto,
  WhatsAppOnboardingResultDto,
  WhatsAppOnboardingSessionDto,
  WhatsAppPhoneNumberDto,
  WhatsAppVerificationRequestDto,
  WhatsAppVerificationStepDto,
} from '@leaseguard/api-client'
import type { EntityId } from '@leaseguard/domain'

/** What this LeaseGuard deployment is configured for (`GET /integrations/whatsapp/capabilities`). Public-safe. */
export type WhatsAppCapabilities = WhatsAppCapabilitiesDto

/** A WhatsApp Business Account of the active company with its numbers (never a credential). */
export type WhatsAppBusinessAccount = WhatsAppBusinessAccountDto
export type WhatsAppPhoneNumber = WhatsAppPhoneNumberDto
/** One verification step of a number (token scopes, account, webhook, registration, templates). */
export type WhatsAppVerificationStepResult = WhatsAppVerificationStepDto
/** A message template Meta holds for one of the company's accounts, as last synced. */
export type WhatsAppMessageTemplate = WhatsAppMessageTemplateDto
/** A verification (or registration) the worker will run. */
export type WhatsAppVerificationRequest = WhatsAppVerificationRequestDto
export type WhatsAppDisconnectResult = WhatsAppDisconnectResultDto

/** A new Embedded Signup session: what the Facebook SDK needs, and the single-use state. */
export type WhatsAppOnboardingSession = WhatsAppOnboardingSessionDto
/** The popup's result forwarded to the API: Meta's event and data, and the code when there is one. */
export type WhatsAppOnboardingCompletion = CompleteWhatsAppOnboardingDto
/** The outcome, written for the admin. Never a token. */
export type WhatsAppOnboardingResult = WhatsAppOnboardingResultDto

export interface WhatsAppIntegrationSource {
  /** Not company-scoped: the same for every company of the deployment. */
  getCapabilities(): Promise<WhatsAppCapabilities>
  /** The company's accounts, oldest first, each with its numbers (oldest first). */
  listBusinessAccounts(companyId: EntityId): Promise<WhatsAppBusinessAccount[]>
  /** Company admins: starts an Embedded Signup session for the company. */
  startOnboarding(companyId: EntityId): Promise<WhatsAppOnboardingSession>
  /** The admin who started the session: records the popup's result; the API exchanges the code at once. */
  completeOnboarding(companyId: EntityId, sessionId: EntityId, completion: WhatsAppOnboardingCompletion): Promise<WhatsAppOnboardingResult>
  /** Every member: the templates Meta holds for the company's accounts. */
  listMessageTemplates(companyId: EntityId): Promise<WhatsAppMessageTemplate[]>
  /** Company admins: verify a number with Meta again. */
  verifyNumber(companyId: EntityId, numberId: EntityId): Promise<WhatsAppVerificationRequest>
  /** Company admins: register a number with a 6-digit PIN (used once, never stored). */
  registerNumber(companyId: EntityId, numberId: EntityId, pin: string): Promise<WhatsAppVerificationRequest>
  /** Company admins: disconnect a number; its stored token is removed. */
  disconnectNumber(companyId: EntityId, numberId: EntityId): Promise<WhatsAppDisconnectResult>
}
