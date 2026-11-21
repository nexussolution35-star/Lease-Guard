import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface SidebarFooterProps {
  collapsed?: boolean
  /** When provided, renders the collapse / expand toggle (desktop only). */
  onToggleCollapsed?: () => void
  className?: string
}

export function SidebarFooter({ collapsed = false, onToggleCollapsed, className }: SidebarFooterProps) {
  if (!onToggleCollapsed) return null
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  return (
    <div className={cn('flex border-t border-border p-2', collapsed ? 'justify-center' : 'justify-end', className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapsed}
            aria-label={label}
            aria-expanded={!collapsed}
            className="text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}
