import type { Company, OnboardingChecklist, OnboardingStep } from '../types/index.js'

/**
 * Steps a company must finish before its onboarding is complete. Inviting a team is recommended but
 * not required: a company may be run by its single company_admin.
 */
export const REQUIRED_ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'companyDetails',
  'whatsappConfigured',
  'whatsappConnected',
  'propertyAdded',
  'leaseVerified',
  'statementUploaded',
]

/** The company profile fields onboarding checks. */
export type CompanyDetailsInput = Pick<Company, 'name' | 'address' | 'contactEmail' | 'contactPhone'>

const filled = (value: string | undefined): boolean => value !== undefined && value.trim() !== ''

/** True when the company's required profile fields (name, address, contact email and phone) are filled in. */
export function hasCompanyDetails(company: CompanyDetailsInput): boolean {
  const { address } = company
  return [company.name, company.contactEmail, company.contactPhone, address.line1, address.suburb, address.city, address.postalCode].every(
    filled,
  )
}

/** Builds the checklist from the step flags; `complete` when every required step is done. */
export function onboardingChecklist(
  companyId: OnboardingChecklist['companyId'],
  steps: { readonly [S in OnboardingStep]: boolean },
): OnboardingChecklist {
  return { companyId, ...steps, complete: REQUIRED_ONBOARDING_STEPS.every((step) => steps[step]) }
}
