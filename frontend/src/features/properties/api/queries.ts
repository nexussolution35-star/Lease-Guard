import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Property } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { onboardingKeys } from '@/features/company/api/queries'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyOrThrow } from '@/lib/data/useActiveCompanyOrThrow'

import { getPropertySource } from './selectSource'
import type { NewProperty, PropertyChanges, PropertyListParams } from './source'

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

/**
 * One property mutation: stores the returned property in its detail cache, then refreshes every property list and
 * detail of the company (lists change order and counts) and the onboarding checklist ("property added").
 */
function usePropertyMutation<TVariables>(
  run: (companyId: EntityId, variables: TVariables) => Promise<Property>,
): UseMutationResult<Property, Error, TVariables> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (variables: TVariables) => run(companyId(), variables),
    onSuccess: (property) => queryClient.setQueryData(propertyKeys.detail(property.companyId, property.id), property),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: propertyKeys.all }),
        queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
      ]),
  })
}

/** Creates a property in the active workspace (company admins and property managers). */
export function useCreateProperty(): UseMutationResult<Property, Error, NewProperty> {
  return usePropertyMutation((companyId, property: NewProperty) => getPropertySource().create(companyId, property))
}

/** Changes a property of the active workspace. */
export function useUpdateProperty(): UseMutationResult<Property, Error, { id: EntityId; changes: PropertyChanges }> {
  return usePropertyMutation((companyId, { id, changes }: { id: EntityId; changes: PropertyChanges }) => getPropertySource().update(companyId, id, changes))
}

/** Archives a property; refused while it has a lease that has not ended. */
export function useArchiveProperty(): UseMutationResult<Property, Error, EntityId> {
  return usePropertyMutation((companyId, id: EntityId) => getPropertySource().archive(companyId, id))
}

/** Makes an archived property active again. */
export function useRestoreProperty(): UseMutationResult<Property, Error, EntityId> {
  return usePropertyMutation((companyId, id: EntityId) => getPropertySource().restore(companyId, id))
}
