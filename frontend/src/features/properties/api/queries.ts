import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Property } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'

import { getPropertySource } from './selectSource'
import type { PropertyListParams } from './source'

export const propertyKeys = createEntityKeys('properties')

/** A page of the active workspace's properties. Keeps the previous page visible while the next loads. */
export function usePropertyList(params: PropertyListParams): UseQueryResult<Page<Property>> {
  return useCompanyQuery(
    (companyId) => propertyKeys.list(companyId, params),
    (companyId) => getPropertySource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** One property of the active workspace; data is null when it does not exist there. */
export function usePropertyQuery(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<Property | null> {
  return useCompanyQuery(
    (companyId) => propertyKeys.detail(companyId, id),
    (companyId) => getPropertySource().get(companyId, id),
    options,
  )
}
