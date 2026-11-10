import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId } from '@leaseguard/domain'

import { onboardingKeys } from '@/features/company/api/queries'

import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'

import type { FacebookSdk } from '../embedded-signup/embeddedSignup'
import { loadFacebookSdk } from '../embedded-signup/facebookSdk'

import { getWhatsAppIntegrationSource } from './selectSource'
import type {
  WhatsAppBusinessAccount,
  WhatsAppCapabilities,
  WhatsAppOnboardingCompletion,
  WhatsAppOnboardingResult,
  WhatsAppOnboardingSession,
} from './source'

export const whatsAppAccountKeys = createEntityKeys('whatsapp-business-account')
/** Deployment-wide, so not keyed by company. */
export const whatsAppCapabilityKeys = { all: ['whatsapp-capabilities'] as const }

/** What this LeaseGuard deployment is configured for (the same for every company). */
export function useWhatsAppCapabilities(): UseQueryResult<WhatsAppCapabilities> {
  return useQuery({ queryKey: whatsAppCapabilityKeys.all, queryFn: () => getWhatsAppIntegrationSource().getCapabilities() })
}

/** The active company's WhatsApp Business Accounts with their numbers. */
export function useWhatsAppBusinessAccounts(): UseQueryResult<WhatsAppBusinessAccount[]> {
  return useCompanyQuery(
    (companyId) => whatsAppAccountKeys.lists(companyId),
    (companyId) => getWhatsAppIntegrationSource().listBusinessAccounts(companyId),
  )
}

/** The active company id for a mutation; mutations only run from screens inside an open workspace. */
function useActiveCompanyOrThrow(): () => EntityId {
  const companyId = useActiveCompanyId()
  return () => {
    if (companyId === null) throw new Error('No workspace is selected.')
    return companyId
  }
}

/** A session ready for Meta's popup: the SDK is loaded, so the popup can open straight from a click. */
export interface PreparedWhatsAppSignup {
  companyId: EntityId
  session: WhatsAppOnboardingSession
  sdk: FacebookSdk
}

/**
 * Starts an Embedded Signup session and loads the Facebook SDK. Opening the popup is a separate click
 * (browsers block popups that do not follow a click directly).
 */
export function usePrepareWhatsAppSignup(): UseMutationResult<PreparedWhatsAppSignup, Error, void> {
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: async () => {
      const id = companyId()
      const session = await getWhatsAppIntegrationSource().startOnboarding(id)
      const sdk = await loadFacebookSdk(session.appId, session.graphApiVersion)
      return { companyId: id, session, sdk }
    },
  })
}

/** Sends the popup's result to the API (which exchanges the code at once), then refreshes the numbers. */
export function useCompleteWhatsAppSignup(): UseMutationResult<
  WhatsAppOnboardingResult,
  Error,
  { companyId: EntityId; sessionId: EntityId; completion: WhatsAppOnboardingCompletion }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, sessionId, completion }) => getWhatsAppIntegrationSource().completeOnboarding(companyId, sessionId, completion),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: whatsAppAccountKeys.all }),
        queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
      ]),
  })
}
