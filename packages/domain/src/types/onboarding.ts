import type { EntityId } from './common.js'

/** The steps a company completes to start monitoring and communicating with LeaseGuard. */
export const ONBOARDING_STEPS = [
  'companyDetails',
  'whatsappConfigured',
  'whatsappConnected',
  'teamInvited',
  'propertyAdded',
  'leaseVerified',
  'statementUploaded',
] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/**
 * Onboarding progress of one company: one flag per step (true = done) and whether every required step
 * is done (`REQUIRED_ONBOARDING_STEPS`).
 */
export type OnboardingChecklist = { readonly [S in OnboardingStep]: boolean } & {
  companyId: EntityId
  complete: boolean
}
