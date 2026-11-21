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
        'flex w-full items-center gap-2.5 rounded-md text-left text-sm transition-colors',
        'hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:bg-accent/60',
        collapsed ? 'h-10 justify-center' : 'h-12 border border-border px-2',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-accent text-xs font-semibold text-accent-foreground"
      >
        {initials}
      </span>
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium leading-5">{name}</span>
            {caption ? <span className="block truncate text-xs leading-4 text-muted-foreground">{caption}</span> : null}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </>
      )}
    </DropdownMenuTrigger>
  )
}
