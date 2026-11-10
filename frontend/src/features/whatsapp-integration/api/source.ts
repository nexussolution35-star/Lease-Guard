import type { WhatsAppBusinessAccountDto, WhatsAppCapabilitiesDto, WhatsAppPhoneNumberDto } from '@leaseguard/api-client'
import type { EntityId } from '@leaseguard/domain'

/** What this LeaseGuard deployment is configured for (`GET /integrations/whatsapp/capabilities`). Public-safe. */
export type WhatsAppCapabilities = WhatsAppCapabilitiesDto

/** A WhatsApp Business Account of the active company with its numbers (never a credential). */
export type WhatsAppBusinessAccount = WhatsAppBusinessAccountDto
export type WhatsAppPhoneNumber = WhatsAppPhoneNumberDto

export interface WhatsAppIntegrationSource {
  /** Not company-scoped: the same for every company of the deployment. */
  getCapabilities(): Promise<WhatsAppCapabilities>
  /** The company's accounts, oldest first, each with its numbers (oldest first). */
  listBusinessAccounts(companyId: EntityId): Promise<WhatsAppBusinessAccount[]>
}
