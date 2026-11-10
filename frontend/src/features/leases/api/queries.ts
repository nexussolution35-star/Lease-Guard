import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Lease } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'

import { getLeaseSource } from './selectSource'
import type { LeaseListParams } from './source'

export const leaseKeys = createEntityKeys('leases')

export function useLeaseList(params: LeaseListParams): UseQueryResult<Page<Lease>> {
  return useCompanyQuery(
    (companyId) => leaseKeys.list(companyId, params),
    (companyId) => getLeaseSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** Data is null when the record does not exist in the active workspace. */
export function useLeaseQuery(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<Lease | null> {
  return useCompanyQuery(
    (companyId) => leaseKeys.detail(companyId, id),
    (companyId) => getLeaseSource().get(companyId, id),
    options,
  )
}
