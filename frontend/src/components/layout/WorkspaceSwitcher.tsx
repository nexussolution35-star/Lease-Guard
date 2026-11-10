import { Check } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import { sortedMemberships, useWorkspace, workspaceName } from '@/features/account'
import { labelFor } from '@/lib/labels'

import { useSwitchWorkspace } from './useSwitchWorkspace'
import { WorkspaceSwitcherTrigger } from './WorkspaceSwitcherTrigger'

export interface WorkspaceSwitcherProps {
  collapsed?: boolean
  className?: string
}

/**
 * The signed-in user's company workspaces from `GET /me`, with their role in each. Switching changes
 * the active company; company-scoped queries refetch because their keys carry its id.
 */
export function WorkspaceSwitcher({ collapsed = false, className }: WorkspaceSwitcherProps) {
  const { memberships, activeMembership } = useWorkspace()
  const switchWorkspace = useSwitchWorkspace()

  const initials = activeMembership?.company.initials ?? '—'
  const name = activeMembership ? workspaceName(activeMembership) : 'No workspace'

  return (
    <DropdownMenu>
      <WorkspaceSwitcherTrigger initials={initials} name={name} collapsed={collapsed} className={className} />
      <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Your workspaces</DropdownMenuLabel>
        {sortedMemberships(memberships).map((membership) => {
          const isActive = membership.companyId === activeMembership?.companyId
          return (
            <DropdownMenuItem key={membership.companyId} className="gap-2.5" onSelect={() => switchWorkspace(membership)}>
              <Avatar className="size-7 rounded-md">
                <AvatarFallback className="rounded-md text-xs font-semibold">{membership.company.initials}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{workspaceName(membership)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {labelFor(membership.role)}
                  {membership.company.status === 'active' ? null : ` · ${labelFor(membership.company.status)}`}
                </span>
              </span>
              {isActive ? <Check className="size-4 text-primary" aria-label="Active workspace" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
