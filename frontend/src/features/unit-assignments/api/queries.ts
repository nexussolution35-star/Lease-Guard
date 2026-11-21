import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, UnitTenantAssignmentListItem } from '@leaseguard/domain'

import { tenantKeys } from '@/features/tenants/api/queries'
import { unitKeys } from '@/features/units/api/queries'
import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyOrThrow } from '@/lib/data/useActiveCompanyOrThrow'

import { getUnitAssignmentSource } from './selectSource'
import type { UnitAssignmentListParams } from './source'

export const unitAssignmentKeys = createEntityKeys('unit-assignments')

export function useUnitAssignmentList(
  params: UnitAssignmentListParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<Page<UnitTenantAssignmentListItem>> {
  return useCompanyQuery(
    (companyId) => unitAssignmentKeys.list(companyId, params),
    (companyId) => getUnitAssignmentSource().list(companyId, params),
    { keepPrevious: true, ...options },
  )
}

/**
 * One assignment mutation. Assigning and unassigning change the unit (occupancy, current tenant) and the tenant list
 * (its units), so the assignments, units and tenants of the company are all refreshed.
 */
function useAssignmentMutation<TVariables>(
  run: (companyId: EntityId, variables: TVariables) => Promise<UnitTenantAssignmentListItem>,
): UseMutationResult<UnitTenantAssignmentListItem, Error, TVariables> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (variables: TVariables) => run(companyId(), variables),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: unitAssignmentKeys.all }),
        queryClient.invalidateQueries({ queryKey: unitKeys.all }),
        queryClient.invalidateQueries({ queryKey: tenantKeys.all }),
      ]),
  })
}

/** Assigns a tenant to a unit without a lease (company admins and property managers). */
export function useAssignTenantToUnit(): UseMutationResult<UnitTenantAssignmentListItem, Error, { tenantId: EntityId; unitId: EntityId }> {
  return useAssignmentMutation((companyId, assignment: { tenantId: EntityId; unitId: EntityId }) => getUnitAssignmentSource().assign(companyId, assignment))
}

/** Ends a current assignment; the unit returns to vacant unless a lease keeps it occupied. */
export function useEndUnitAssignment(): UseMutationResult<UnitTenantAssignmentListItem, Error, EntityId> {
  return useAssignmentMutation((companyId, assignmentId: EntityId) => getUnitAssignmentSource().end(companyId, assignmentId))
}
