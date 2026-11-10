import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId } from '@leaseguard/domain'

import { accountKeys } from '@/features/account/api/queries'
import { rememberWorkspace } from '@/features/account/rememberedWorkspace'
import { useAuth } from '@/features/auth/authContext'
import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'
import { useAppStore } from '@/store/appStore'

import { createApiMyInvitationSource } from './apiSource'
import type { AcceptedInvitation, MyInvitationSource, ReceivedInvitation } from './source'

/** Created on first use. */
export const getMyInvitationSource: () => MyInvitationSource = lazySource(() => createApiMyInvitationSource(getApiClient()))

export const myInvitationKeys = {
  all: ['my-invitations'] as const,
  /** Keyed by the Supabase user so another sign-in never sees these invitations. */
  list: (userId: string) => ['my-invitations', userId] as const,
}

function useSignedInUserId(): string {
  const { status, user } = useAuth()
  return status === 'authenticated' && user ? user.id : ''
}

/** The signed-in user's open invitations (`GET /me/invitations`). Disabled while signed out. */
export function useMyInvitations(options: { enabled?: boolean } = {}): UseQueryResult<ReceivedInvitation[]> {
  const userId = useSignedInUserId()
  return useQuery({
    queryKey: myInvitationKeys.list(userId),
    queryFn: () => getMyInvitationSource().list(),
    enabled: userId !== '' && (options.enabled ?? true),
  })
}

/**
 * Accepts an invitation, then opens the new workspace: `me` is refetched first (so the workspace gate
 * knows the new membership), and only then the company becomes the active and remembered workspace.
 * Resolves after all of that, so the caller can navigate straight to the dashboard.
 */
export function useAcceptInvitation(): UseMutationResult<AcceptedInvitation, Error, EntityId> {
  const queryClient = useQueryClient()
  const userId = useSignedInUserId()
  return useMutation({
    mutationFn: (invitationId) => getMyInvitationSource().accept(invitationId),
    onSuccess: async ({ companyId }) => {
      await queryClient.invalidateQueries({ queryKey: accountKeys.all, refetchType: 'all' })
      rememberWorkspace(userId, companyId)
      useAppStore.getState().setActiveCompany(companyId)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: myInvitationKeys.all }),
  })
}

/** Declines an invitation, then refreshes the list. */
export function useDeclineInvitation(): UseMutationResult<void, Error, EntityId> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (invitationId) => getMyInvitationSource().decline(invitationId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: myInvitationKeys.all }),
  })
}
