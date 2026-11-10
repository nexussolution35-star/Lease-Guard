import type {
  CompleteWhatsAppOnboardingDto,
  WhatsAppBusinessAccountDto,
  WhatsAppCapabilitiesDto,
  WhatsAppOnboardingResultDto,
  WhatsAppOnboardingSessionDto,
  WhatsAppPhoneNumberDto,
} from '@leaseguard/api-client'
import type { EntityId } from '@leaseguard/domain'

/** What this LeaseGuard deployment is configured for (`GET /integrations/whatsapp/capabilities`). Public-safe. */
export type WhatsAppCapabilities = WhatsAppCapabilitiesDto

/** A WhatsApp Business Account of the active company with its numbers (never a credential). */
export type WhatsAppBusinessAccount = WhatsAppBusinessAccountDto
export type WhatsAppPhoneNumber = WhatsAppPhoneNumberDto

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
}
