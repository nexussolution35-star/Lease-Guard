import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Unit, UnitListItem } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyOrThrow } from '@/lib/data/useActiveCompanyOrThrow'

import { getUnitSource } from './selectSource'
import type { NewUnit, UnitChanges, UnitListParams } from './source'

export const unitKeys = createEntityKeys('units')

export function useUnitList(params: UnitListParams): UseQueryResult<Page<UnitListItem>> {
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

/**
 * One unit mutation: stores the returned unit in its detail cache, then refreshes every unit list and detail of the
 * company (lists change order and counts, and the property screen lists its units).
 */
function useUnitMutation<TVariables>(run: (companyId: EntityId, variables: TVariables) => Promise<Unit>): UseMutationResult<Unit, Error, TVariables> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (variables: TVariables) => run(companyId(), variables),
    onSuccess: (unit) => queryClient.setQueryData(unitKeys.detail(unit.companyId, unit.id), unit),
    onSettled: () => queryClient.invalidateQueries({ queryKey: unitKeys.all }),
  })
}

/** Creates a unit in the active workspace (company admins and property managers). */
export function useCreateUnit(): UseMutationResult<Unit, Error, NewUnit> {
  return useUnitMutation((companyId, unit: NewUnit) => getUnitSource().create(companyId, unit))
}

/** Changes a unit of the active workspace. */
export function useUpdateUnit(): UseMutationResult<Unit, Error, { id: EntityId; changes: UnitChanges }> {
  return useUnitMutation((companyId, { id, changes }: { id: EntityId; changes: UnitChanges }) => getUnitSource().update(companyId, id, changes))
}
