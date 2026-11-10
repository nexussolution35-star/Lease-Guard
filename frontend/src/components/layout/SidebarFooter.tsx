import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SidebarFooterProps {
  collapsed?: boolean
  /** When provided, renders the collapse / expand toggle (desktop only). */
  onToggleCollapsed?: () => void
  className?: string
}

export function SidebarFooter({ collapsed = false, onToggleCollapsed, className }: SidebarFooterProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {onToggleCollapsed ? (
        <Button
          type="button"
          variant="ghost"
          size={collapsed ? 'icon-sm' : 'sm'}
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className={cn('text-muted-foreground', collapsed ? 'mx-auto' : 'justify-start')}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          {collapsed ? null : 'Collapse'}
        </Button>
      ) : null}
    </div>
  )
}
