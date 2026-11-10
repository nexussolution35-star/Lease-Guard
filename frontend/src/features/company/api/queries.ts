import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId } from '@leaseguard/domain'

import { accountKeys } from '@/features/account/api/queries'
import { lazySource } from '@/lib/data/dataSource'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'
import { getApiClient } from '@/services/api/client'

import { createApiCompanySource } from './apiSource'
import type { CompanyChanges, CompanyProfile, CompanySource, OnboardingChecklist, WhatsAppAccount, WhatsAppConfiguration } from './source'

/** Created on first use. */
export const getCompanySource: () => CompanySource = lazySource(() => createApiCompanySource(getApiClient()))

export const companyKeys = createEntityKeys('company')
export const onboardingKeys = createEntityKeys('onboarding')

/** The active company's profile, settings and WhatsApp configuration; null when it does not exist. */
export function useCompanyProfile(): UseQueryResult<CompanyProfile | null> {
  return useCompanyQuery(
    (companyId) => companyKeys.detail(companyId, companyId),
    (companyId) => getCompanySource().get(companyId),
  )
}

/** The active company's onboarding checklist. */
export function useOnboardingChecklist(options: { enabled?: boolean } = {}): UseQueryResult<OnboardingChecklist> {
  return useCompanyQuery(
    (companyId) => onboardingKeys.company(companyId),
    (companyId) => getCompanySource().getOnboarding(companyId),
    options,
  )
}

function useActiveCompanyOrThrow(): () => EntityId {
  const companyId = useActiveCompanyId()
  return () => {
    if (companyId === null) throw new Error('No workspace is selected.')
    return companyId
  }
}

/**
 * Saves the company profile and settings, then refreshes the company, the onboarding checklist and
 * `me` (the workspace switcher shows the company name).
 */
export function useUpdateCompany(): UseMutationResult<CompanyProfile, Error, CompanyChanges> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (changes) => getCompanySource().update(companyId(), changes),
    onSuccess: (company) => queryClient.setQueryData(companyKeys.detail(company.id, company.id), company),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: companyKeys.all }),
        queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
        queryClient.invalidateQueries({ queryKey: accountKeys.all }),
      ]),
  })
}

/** Sets the WhatsApp Business identifiers, then refreshes the company and the onboarding checklist. */
export function useConfigureWhatsApp(): UseMutationResult<WhatsAppAccount, Error, WhatsAppConfiguration> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (configuration) => getCompanySource().configureWhatsApp(companyId(), configuration),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: companyKeys.all }),
        queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
      ]),
  })
}
