import { AppLink } from '@/components/shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { NavItem } from '@/lib/navigation'
import { cn } from '@/lib/utils'

export interface SidebarNavigationItemProps {
  item: NavItem
  active: boolean
  /** Icon-only rail; the label moves into a tooltip. */
  collapsed?: boolean
  onNavigate?: () => void
  className?: string
}

export function SidebarNavigationItem({ item, active, collapsed = false, onNavigate, className }: SidebarNavigationItemProps) {
  const Icon = item.icon

  const link = (
    <AppLink
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      data-active={active ? 'true' : undefined}
      className={cn(
        // 40px rows in the mobile drawer (touch), 32px in the desktop sidebar.
        'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-foreground/85 transition-colors max-md:h-10',
        'hover:bg-accent/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        '[&>svg]:text-muted-foreground',
        // Active: one surface step up, with a hairline highlight on its top edge.
        active &&
          'bg-accent font-medium text-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.08)] hover:bg-accent [&>svg]:text-foreground',
        collapsed && 'justify-center px-0',
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </AppLink>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{item.label}</TooltipContent>
    </Tooltip>
  )
}
