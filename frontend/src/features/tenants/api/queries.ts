import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Tenant } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'

import { getTenantSource } from './selectSource'
import type { TenantListParams } from './source'

export const tenantKeys = createEntityKeys('tenants')

export function useTenantList(params: TenantListParams): UseQueryResult<Page<Tenant>> {
  return useCompanyQuery(
    (companyId) => tenantKeys.list(companyId, params),
    (companyId) => getTenantSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** Data is null when the record does not exist in the active workspace. */
export function useTenantQuery(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<Tenant | null> {
  return useCompanyQuery(
    (companyId) => tenantKeys.detail(companyId, id),
    (companyId) => getTenantSource().get(companyId, id),
    options,
  )
}
