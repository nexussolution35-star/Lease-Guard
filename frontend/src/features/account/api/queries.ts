import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'

import { useAuth } from '@/features/auth/authContext'
import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiAccountSource } from './apiSource'
import type { CurrentUserProfile, ProfileChanges } from './source'

/** Created on first use. */
const getAccountSource = lazySource(() => createApiAccountSource(getApiClient()))

export const accountKeys = {
  all: ['me'] as const,
  /** Keyed by the Supabase user so a different sign-in never reads the previous user's profile. */
  currentUser: (userId: string) => ['me', userId] as const,
}

function useSignedInUserId(): string {
  const { status, user } = useAuth()
  return status === 'authenticated' && user ? user.id : ''
}

/**
 * The signed-in user's profile and memberships (`GET /api/v1/me`). Disabled until Supabase reports a
 * session. Data is null when the user has no LeaseGuard profile.
 */
export function useCurrentUserProfile(): UseQueryResult<CurrentUserProfile | null> {
  const userId = useSignedInUserId()
  return useQuery({
    queryKey: accountKeys.currentUser(userId),
    queryFn: () => getAccountSource().getCurrentUser(),
    enabled: userId !== '',
  })
}

/** Updates the signed-in user's own profile (`PATCH /api/v1/me`), then refreshes `me`. */
export function useUpdateProfile(): UseMutationResult<CurrentUserProfile, Error, ProfileChanges> {
  const queryClient = useQueryClient()
  const userId = useSignedInUserId()
  return useMutation({
    mutationFn: (changes) => getAccountSource().updateCurrentUser(changes),
    onSuccess: async (profile) => {
      if (userId !== '') queryClient.setQueryData(accountKeys.currentUser(userId), profile)
      await queryClient.invalidateQueries({ queryKey: accountKeys.all })
    },
  })
}
