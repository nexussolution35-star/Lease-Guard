import { toast } from 'sonner'

import { useWorkspace, workspaceName, type WorkspaceMembership } from '@/features/account'

/**
 * Opens another of the user's workspaces with a toast for the outcome. Shared by the sidebar switcher
 * and the account menu.
 */
export function useSwitchWorkspace(): (membership: WorkspaceMembership) => void {
  const { activeMembership, switchTo } = useWorkspace()
  return (membership) => {
    if (membership.companyId === activeMembership?.companyId) return
    const label = workspaceName(membership)
    if (switchTo(membership.companyId)) toast.success(`Switched to ${label}`)
    else toast.error('Could not switch workspace', { description: 'You are no longer a member of that company.' })
  }
}
