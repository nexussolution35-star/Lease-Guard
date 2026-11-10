import { ShieldCheck } from 'lucide-react'

import { AppLink } from '@/components/shared'
import { cn } from '@/lib/utils'

import { WorkspaceSwitcher } from './WorkspaceSwitcher'

export interface SidebarHeaderProps {
  collapsed?: boolean
  className?: string
}

export function SidebarHeader({ collapsed = false, className }: SidebarHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <AppLink
        to="/"
        aria-label="LeaseGuard dashboard"
        className={cn(
          'flex items-center gap-2 rounded-md px-1.5 py-1 font-semibold tracking-tight focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </span>
        {collapsed ? null : <span>LeaseGuard</span>}
      </AppLink>
      {/* The signed-in user's company workspaces from `GET /me`. */}
      <WorkspaceSwitcher collapsed={collapsed} />
    </div>
  )
}
