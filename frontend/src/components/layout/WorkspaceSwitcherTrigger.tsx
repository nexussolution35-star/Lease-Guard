import { ChevronsUpDown } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface WorkspaceSwitcherTriggerProps {
  initials: string
  name: string
  collapsed: boolean
  className?: string | undefined
}

/** The sidebar button that opens a workspace menu . Render inside a DropdownMenu. */
export function WorkspaceSwitcherTrigger({ initials, name, collapsed, className }: WorkspaceSwitcherTriggerProps) {
  return (
    <DropdownMenuTrigger
      aria-label={`Workspace: ${name}. Switch workspace`}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border border-border bg-background p-1.5 text-left text-sm transition-colors',
        'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        collapsed && 'justify-center border-transparent bg-transparent p-1',
        className,
      )}
    >
      <Avatar className="size-7 rounded-md">
        <AvatarFallback className="rounded-md bg-primary text-xs font-semibold text-primary-foreground">
          {initials}
        </AvatarFallback>
      </Avatar>
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">Workspace</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </>
      )}
    </DropdownMenuTrigger>
  )
}
