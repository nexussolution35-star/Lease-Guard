import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, UserRole } from '@leaseguard/domain'

import { onboardingKeys } from '@/features/company/api/queries'
import { lazySource } from '@/lib/data/dataSource'
import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'
import { getApiClient } from '@/services/api/client'

import { createApiUserSource } from './apiSource'
import type { CompanyInvitation, CompanyMember, InvitationListParams, MemberListParams, NewInvitation, UserSource } from './source'

/** Created on first use. */
export const getUserSource: () => UserSource = lazySource(() => createApiUserSource(getApiClient()))

export const memberKeys = createEntityKeys('members')
export const companyInvitationKeys = createEntityKeys('company-invitations')

/** A page of the active workspace's members. */
export function useMemberList(params: MemberListParams, options: { enabled?: boolean } = {}): UseQueryResult<Page<CompanyMember>> {
  return useCompanyQuery(
    (companyId) => memberKeys.list(companyId, params),
    (companyId) => getUserSource().listMembers(companyId, params),
    { keepPrevious: true, ...options },
  )
}

/**
 * How many active company admins the workspace has (one row is fetched; the total counts them), or undefined while
 * unknown. Lets Settings → Users explain the last-admin rule before anyone tries; the database enforces it.
 */
export function useActiveAdminCount(options: { enabled?: boolean } = {}): number | undefined {
  return useMemberList({ page: 1, pageSize: 1, role: 'company_admin', status: 'active' }, options).data?.total
}

/** A page of the active workspace's invitations (company admins only; disable it for other roles). */
export function useCompanyInvitationList(params: InvitationListParams, options: { enabled?: boolean } = {}): UseQueryResult<Page<CompanyInvitation>> {
  return useCompanyQuery(
    (companyId) => companyInvitationKeys.list(companyId, params),
    (companyId) => getUserSource().listInvitations(companyId, params),
    { keepPrevious: true, ...options },
  )
}

/** The active company id for a mutation; mutations only run from screens inside an open workspace. */
function useActiveCompanyOrThrow(): () => EntityId {
  const companyId = useActiveCompanyId()
  return () => {
    if (companyId === null) throw new Error('No workspace is selected.')
    return companyId
  }
}

/** Changes another member's role, then refreshes the member list. */
export function useUpdateMemberRole(): UseMutationResult<CompanyMember, Error, { userId: EntityId; role: UserRole }> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: ({ userId, role }) => getUserSource().updateMemberRole(companyId(), userId, role),
    onSettled: () => queryClient.invalidateQueries({ queryKey: memberKeys.all }),
  })
}

/** Removes another member from the active company, then refreshes the member list and onboarding. */
export function useRemoveMember(): UseMutationResult<void, Error, EntityId> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (userId) => getUserSource().removeMember(companyId(), userId),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: memberKeys.all }),
        queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
      ]),
  })
}

function useInvitationMutation<TVariables>(
  run: (source: UserSource, companyId: EntityId, variables: TVariables) => Promise<CompanyInvitation>,
): UseMutationResult<CompanyInvitation, Error, TVariables> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (variables: TVariables) => run(getUserSource(), companyId(), variables),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: companyInvitationKeys.all }),
        queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
      ]),
  })
}

/** Invites someone to the active company; the worker sends the email shortly after. */
export function useCreateInvitation(): UseMutationResult<CompanyInvitation, Error, NewInvitation> {
  return useInvitationMutation((source, companyId, invitation: NewInvitation) => source.createInvitation(companyId, invitation))
}

/** Withdraws a pending or sent invitation. */
export function useRevokeInvitation(): UseMutationResult<CompanyInvitation, Error, EntityId> {
  return useInvitationMutation((source, companyId, invitationId: EntityId) => source.revokeInvitation(companyId, invitationId))
}

/** Queues a pending, sent or failed invitation to be sent again. */
export function useResendInvitation(): UseMutationResult<CompanyInvitation, Error, EntityId> {
  return useInvitationMutation((source, companyId, invitationId: EntityId) => source.resendInvitation(companyId, invitationId))
}
