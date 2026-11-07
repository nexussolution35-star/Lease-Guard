import { FlaskConical, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface SidebarFooterProps {
  collapsed?: boolean
  /** When provided, renders the collapse / expand toggle (desktop only). */
  onToggleCollapsed?: () => void
  className?: string
}

const DEMO_LABEL = 'Demo workspace — simulated data'

export function SidebarFooter({ collapsed = false, onToggleCollapsed, className }: SidebarFooterProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="note"
              tabIndex={0}
              aria-label={DEMO_LABEL}
              className="mx-auto flex size-8 items-center justify-center rounded-md text-muted-foreground"
            >
              <FlaskConical className="size-4" aria-hidden="true" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">{DEMO_LABEL}</TooltipContent>
        </Tooltip>
      ) : (
        <p
          role="note"
          className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground"
        >
          <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
          {DEMO_LABEL}
        </p>
      )}
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
