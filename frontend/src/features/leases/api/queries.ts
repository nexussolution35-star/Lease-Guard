import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Lease, LeaseDocument, LeaseListItem } from '@leaseguard/domain'

import { onboardingKeys } from '@/features/company/api/queries'
import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyOrThrow } from '@/lib/data/useActiveCompanyOrThrow'

import { getLeaseSource } from './selectSource'
import type { LeaseChanges, LeaseDocumentUpload, LeaseListParams, NewLease } from './source'

export const leaseKeys = createEntityKeys('leases')
export const leaseDocumentKeys = createEntityKeys('lease-documents')

export function useLeaseList(params: LeaseListParams): UseQueryResult<Page<LeaseListItem>> {
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

/** The documents recorded on one lease of the active workspace, newest first. */
export function useLeaseDocuments(leaseId: EntityId): UseQueryResult<LeaseDocument[]> {
  return useCompanyQuery(
    (companyId) => leaseDocumentKeys.list(companyId, { leaseId }),
    (companyId) => getLeaseSource().listDocuments(companyId, leaseId),
  )
}

/**
 * Uploads a PDF and records it on a lease (company admins and property managers), then refreshes that lease's documents.
 */
export function useUploadLeaseDocument(leaseId: EntityId): UseMutationResult<LeaseDocument, Error, LeaseDocumentUpload> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (upload: LeaseDocumentUpload) => getLeaseSource().uploadDocument(companyId(), leaseId, upload),
    onSettled: () => queryClient.invalidateQueries({ queryKey: leaseDocumentKeys.all }),
  })
}

/** A five-minute link to a lease document's PDF (nothing to refresh afterwards). */
export function useLeaseDocumentLink(leaseId: EntityId): UseMutationResult<string, Error, EntityId> {
  const companyId = useActiveCompanyOrThrow()
  return useMutation({ mutationFn: (documentId: EntityId) => getLeaseSource().documentDownloadUrl(companyId(), leaseId, documentId) })
}

/**
 * Verifies a lease's terms (company admins and property managers). Stores the returned lease in its detail cache, then
 * refreshes every lease list and detail (verification and status change) and the onboarding checklist ("lease verified").
 */
export function useVerifyLease(): UseMutationResult<Lease, Error, EntityId> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (id: EntityId) => getLeaseSource().verify(companyId(), id),
    onSuccess: (lease) => queryClient.setQueryData(leaseKeys.detail(lease.companyId, lease.id), lease),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: leaseKeys.all }),
        queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
      ]),
  })
}

/**
 * One lease create or edit: stores the returned lease in its detail cache, then refreshes every lease list and detail,
 * the tenant and unit lists (they show each one's current lease) and the onboarding checklist.
 */
function useLeaseWrite<TVariables>(run: (companyId: EntityId, variables: TVariables) => Promise<Lease>): UseMutationResult<Lease, Error, TVariables> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (variables: TVariables) => run(companyId(), variables),
    onSuccess: (lease) => queryClient.setQueryData(leaseKeys.detail(lease.companyId, lease.id), lease),
    onSettled: () =>
      Promise.all(
        [leaseKeys.all, createEntityKeys('tenants').all, createEntityKeys('units').all, onboardingKeys.all].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  })
}

/** Creates a lease in the active workspace (company admins and property managers); it starts unverified. */
export function useCreateLease(): UseMutationResult<Lease, Error, NewLease> {
  return useLeaseWrite((companyId, lease: NewLease) => getLeaseSource().create(companyId, lease))
}

/** Changes a lease; a term change returns a verified lease to pending verification. */
export function useUpdateLease(): UseMutationResult<Lease, Error, { id: EntityId; changes: LeaseChanges }> {
  return useLeaseWrite((companyId, { id, changes }: { id: EntityId; changes: LeaseChanges }) => getLeaseSource().update(companyId, id, changes))
}
