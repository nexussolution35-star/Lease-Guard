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
  const caption = activeMembership ? labelFor(activeMembership.role) : undefined

  return (
    <DropdownMenu>
      <WorkspaceSwitcherTrigger initials={initials} name={name} caption={caption} collapsed={collapsed} className={className} />
      <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'}
        // Expanded, the menu lines up with the switcher; from the icon rail it opens beside it.
        className={collapsed ? 'w-64' : 'w-(--radix-dropdown-menu-trigger-width) min-w-56'}
      >
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Your workspaces</DropdownMenuLabel>
        {sortedMemberships(memberships).map((membership) => {
          const isActive = membership.companyId === activeMembership?.companyId
          return (
            <DropdownMenuItem
              key={membership.companyId}
              // A single choice: exposed as a radio item, with the check kept on the right.
              role="menuitemradio"
              aria-checked={isActive}
              className="gap-2.5"
              onSelect={() => switchWorkspace(membership)}
            >
              <Avatar className="size-6 rounded-sm">
                <AvatarFallback className="rounded-sm text-xs font-semibold">{membership.company.initials}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{workspaceName(membership)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {labelFor(membership.role)}
                  {membership.company.status === 'active' ? null : ` · ${labelFor(membership.company.status)}`}
                </span>
              </span>
              {isActive ? <Check className="size-4 text-foreground" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
