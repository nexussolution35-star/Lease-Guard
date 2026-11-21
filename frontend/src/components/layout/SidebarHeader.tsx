import { AppLink, BrandMark } from '@/components/shared'
import { cn } from '@/lib/utils'

import { WorkspaceSwitcher } from './WorkspaceSwitcher'

export interface SidebarHeaderProps {
  collapsed?: boolean
  className?: string
}

export function SidebarHeader({ collapsed = false, className }: SidebarHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-2 px-2 pb-2', className)}>
      <AppLink
        to="/"
        aria-label="LeaseGuard dashboard"
        className={cn(
          // Same height as the top bar, so the brand row and the trail share one line.
          'flex h-14 items-center rounded-md px-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          collapsed && 'justify-center px-0',
        )}
      >
        <BrandMark markOnly={collapsed} />
      </AppLink>
      {/* The signed-in user's company workspaces from `GET /me`. */}
      <WorkspaceSwitcher collapsed={collapsed} />
    </div>
  )
}
