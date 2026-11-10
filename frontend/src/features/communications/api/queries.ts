import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Communication } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'

import { getCommunicationSource } from './selectSource'
import type { CommunicationListParams } from './source'

export const communicationKeys = createEntityKeys('communications')

export function useCommunicationList(params: CommunicationListParams): UseQueryResult<Page<Communication>> {
  return useCompanyQuery(
    (companyId) => communicationKeys.list(companyId, params),
    (companyId) => getCommunicationSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** Data is null when the record does not exist in the active workspace. */
export function useCommunicationQuery(id: EntityId): UseQueryResult<Communication | null> {
  return useCompanyQuery(
    (companyId) => communicationKeys.detail(companyId, id),
    (companyId) => getCommunicationSource().get(companyId, id),
  )
}
