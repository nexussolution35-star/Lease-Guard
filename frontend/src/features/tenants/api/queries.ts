import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Tenant, TenantListItem } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyOrThrow } from '@/lib/data/useActiveCompanyOrThrow'

import { getTenantSource } from './selectSource'
import type { NewTenant, TenantChanges, TenantListParams } from './source'

export const tenantKeys = createEntityKeys('tenants')

export function useTenantList(params: TenantListParams): UseQueryResult<Page<TenantListItem>> {
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

/**
 * One tenant mutation: stores the returned tenant in its detail cache, then refreshes every tenant list and detail of
 * the company (lists change order and counts).
 */
function useTenantMutation<TVariables>(
  run: (companyId: EntityId, variables: TVariables) => Promise<Tenant>,
): UseMutationResult<Tenant, Error, TVariables> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (variables: TVariables) => run(companyId(), variables),
    onSuccess: (tenant) => queryClient.setQueryData(tenantKeys.detail(tenant.companyId, tenant.id), tenant),
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantKeys.all }),
  })
}

/** Creates a tenant in the active workspace (company admins and property managers). */
export function useCreateTenant(): UseMutationResult<Tenant, Error, NewTenant> {
  return useTenantMutation((companyId, tenant: NewTenant) => getTenantSource().create(companyId, tenant))
}

/**
 * Validates the tenant's WhatsApp number as checked with the tenant (company writers). Rejects with 409 when the number
 * changed in the meantime.
 */
export function useValidateTenantWhatsApp(): UseMutationResult<Tenant, Error, { id: EntityId; whatsappNumber: string }> {
  return useTenantMutation((companyId, { id, whatsappNumber }: { id: EntityId; whatsappNumber: string }) =>
    getTenantSource().validateWhatsApp(companyId, id, whatsappNumber),
  )
}

/** Changes a tenant of the active workspace; a different WhatsApp number comes back unvalidated. */
export function useUpdateTenant(): UseMutationResult<Tenant, Error, { id: EntityId; changes: TenantChanges }> {
  return useTenantMutation((companyId, { id, changes }: { id: EntityId; changes: TenantChanges }) => getTenantSource().update(companyId, id, changes))
}
