import { ChevronsUpDown } from 'lucide-react'

import { DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface WorkspaceSwitcherTriggerProps {
  initials: string
  name: string
  /** A second line under the name, e.g. the user's role in this workspace. */
  caption?: string | undefined
  collapsed: boolean
  className?: string | undefined
}

/** The sidebar button that opens a workspace menu. Render inside a DropdownMenu. */
export function WorkspaceSwitcherTrigger({ initials, name, caption, collapsed, className }: WorkspaceSwitcherTriggerProps) {
  return (
    <DropdownMenuTrigger
      aria-label={`Workspace: ${name}. Switch workspace`}
      className={cn(
        'flex h-12 w-full items-center gap-2.5 rounded-md border text-left text-sm whitespace-nowrap transition-[padding,border-color,background-color] duration-200 ease-out motion-reduce:transition-none',
        'hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden data-[state=open]:bg-accent/60',
        // Collapsed, 5px padding centres the 28px initials in the rail; the name fades rather than disappearing.
        collapsed ? 'border-transparent px-[5px]' : 'border-border px-2',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-accent text-xs font-semibold text-accent-foreground"
      >
        {initials}
      </span>
      <span aria-hidden={collapsed || undefined} className={cn('flex min-w-0 flex-1 items-center gap-2.5 transition-opacity duration-200 ease-out motion-reduce:transition-none', collapsed && 'opacity-0')}>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium leading-5">{name}</span>
            {caption ? <span className="block truncate text-xs leading-4 text-muted-foreground">{caption}</span> : null}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </span>
    </DropdownMenuTrigger>
  )
}
