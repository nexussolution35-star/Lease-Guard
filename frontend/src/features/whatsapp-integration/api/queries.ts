import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'

import { getWhatsAppIntegrationSource } from './selectSource'
import type { WhatsAppBusinessAccount, WhatsAppCapabilities } from './source'

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
