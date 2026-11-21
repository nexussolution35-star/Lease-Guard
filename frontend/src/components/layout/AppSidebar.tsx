import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

import { SidebarFooter } from './SidebarFooter'
import { SidebarHeader } from './SidebarHeader'
import { SidebarNavigation } from './SidebarNavigation'

export interface AppSidebarProps {
  collapsed?: boolean
  onToggleCollapsed?: () => void
  className?: string
}

/** Desktop sidebar: full width or an icon-only rail when collapsed. */
export function AppSidebar({ collapsed = false, onToggleCollapsed, className }: AppSidebarProps) {
  return (
    <aside
      aria-label="Sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        // The width slides; everything inside keeps its place and labels fade, so nothing jumps (owner, 21 Nov 2026).
        'rail sticky top-0 h-svh shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none',
        collapsed ? 'w-14' : 'w-60',
        className,
      )}
    >
      <SidebarHeader collapsed={collapsed} />
      <ScrollArea className="min-h-0 flex-1">
        <SidebarNavigation collapsed={collapsed} className="px-2 py-3" />
      </ScrollArea>
      <SidebarFooter
        collapsed={collapsed}
        {...(onToggleCollapsed ? { onToggleCollapsed } : {})}
      />
    </aside>
  )
}
