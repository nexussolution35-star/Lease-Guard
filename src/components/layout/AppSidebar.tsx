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
        'sticky top-0 h-svh shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-64',
        className,
      )}
    >
      <SidebarHeader collapsed={collapsed} className="border-b border-border p-3" />
      <ScrollArea className="min-h-0 flex-1">
        <SidebarNavigation collapsed={collapsed} className="p-3" />
      </ScrollArea>
      <SidebarFooter
        collapsed={collapsed}
        className="border-t border-border p-3"
        {...(onToggleCollapsed ? { onToggleCollapsed } : {})}
      />
    </aside>
  )
}
