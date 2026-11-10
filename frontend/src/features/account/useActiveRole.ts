import type { UserRole } from '@leaseguard/domain'

import { isCompanyAdmin, isCompanyWriter } from './permissions'
import { useWorkspace } from './useWorkspace'

/** The signed-in user's role in the active workspace; null until the workspace is open. */
export function useActiveRole(): UserRole | null {
  return useWorkspace().activeMembership?.role ?? null
}

/** True when the signed-in user is a company admin of the active workspace. */
export function useIsCompanyAdmin(): boolean {
  return isCompanyAdmin(useActiveRole())
}

/** True when the signed-in user may change data in the active workspace (company admin or property manager). */
export function useIsCompanyWriter(): boolean {
  return isCompanyWriter(useActiveRole())
}

/** The signed-in user's id; null until `/me` has loaded. */
export function useCurrentUserId(): string | null {
  return useWorkspace().profile?.id ?? null
}
