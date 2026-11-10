import type {
  CompanyDto,
  ConfigureWhatsAppDto,
  OnboardingChecklistDto,
  UpdateCompanyDto,
  WhatsAppPhoneNumberDto,
} from '@leaseguard/api-client'
import type { EntityId } from '@leaseguard/domain'

/** The company profile, monitoring settings and WhatsApp configuration (`GET /companies/{id}`). */
export type CompanyProfile = CompanyDto

/**
 * The company profile and settings a company admin may change. Status, initials, the tenant-message
 * approval switch, timezone and country are managed by Nexus and never sent.
 */
export type CompanyChanges = UpdateCompanyDto

/** The Meta identifiers and display fields a company admin sets (`PUT /companies/{id}/whatsapp`). */
export type WhatsAppConfiguration = ConfigureWhatsAppDto

/** A number as the API returns it after configuring (never the credential reference). */
export type WhatsAppAccount = WhatsAppPhoneNumberDto

/** One flag per onboarding step and whether every required step is done. */
export type OnboardingChecklist = OnboardingChecklistDto

/** The active company's own record (company-scoped; the path must name the active company). */
export interface CompanySource {
  /** Null when the company does not exist for the caller (API 404). */
  get(companyId: EntityId): Promise<CompanyProfile | null>
  update(companyId: EntityId, changes: CompanyChanges): Promise<CompanyProfile>
  configureWhatsApp(companyId: EntityId, configuration: WhatsAppConfiguration): Promise<WhatsAppAccount>
  getOnboarding(companyId: EntityId): Promise<OnboardingChecklist>
}
