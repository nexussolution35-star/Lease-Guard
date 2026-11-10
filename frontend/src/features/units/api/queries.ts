import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Unit } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'

import { getUnitSource } from './selectSource'
import type { UnitListParams } from './source'

export const unitKeys = createEntityKeys('units')

export function useUnitList(params: UnitListParams): UseQueryResult<Page<Unit>> {
  return useCompanyQuery(
    (companyId) => unitKeys.list(companyId, params),
    (companyId) => getUnitSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** Data is null when the record does not exist in the active workspace. */
export function useUnitQuery(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<Unit | null> {
  return useCompanyQuery(
    (companyId) => unitKeys.detail(companyId, id),
    (companyId) => getUnitSource().get(companyId, id),
    options,
  )
}
