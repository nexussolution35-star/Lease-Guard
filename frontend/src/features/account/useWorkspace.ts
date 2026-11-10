import type { EntityId } from '@leaseguard/domain'
import { useCallback } from 'react'

import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'
import { useAppStore } from '@/store/appStore'

import { useCurrentUserProfile } from './api/queries'
import type { CurrentUserProfile, WorkspaceMembership } from './api/source'
import { rememberWorkspace } from './rememberedWorkspace'
import { membershipIn } from './workspace'

export interface WorkspaceState {
  /** Undefined until `/me` has loaded (the workspace gate renders nothing else before that). */
  profile: CurrentUserProfile | undefined
  memberships: readonly WorkspaceMembership[]
  activeMembership: WorkspaceMembership | undefined
  /** Open another of the user's workspaces; false when the user is not a member there. */
  switchTo: (companyId: EntityId) => boolean
}

/**
 * The signed-in user, their memberships and the active workspace. Switching changes the
 * store's active company; every company-scoped query key carries that id, so screens refetch for the
 * new company and never show the previous company's cache.
 */
export function useWorkspace(): WorkspaceState {
  const profile = useCurrentUserProfile().data ?? undefined
  const activeCompanyId = useActiveCompanyId()
  const memberships = profile?.memberships ?? []

  const switchTo = useCallback(
    (companyId: EntityId) => {
      if (!profile || !membershipIn(profile.memberships, companyId)) return false
      useAppStore.getState().setActiveCompany(companyId)
      rememberWorkspace(profile.id, companyId)
      return true
    },
    [profile],
  )

  return { profile, memberships, activeMembership: membershipIn(memberships, activeCompanyId), switchTo }
}
