import { AppLink } from '@/components/shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { NavItem } from '@/lib/navigation'
import { cn } from '@/lib/utils'

export interface SidebarNavigationItemProps {
  item: NavItem
  active: boolean
  /** Icon-only rail; the label moves into a tooltip. */
  collapsed?: boolean
  badgeCount?: number
  onNavigate?: () => void
  className?: string
}

export function SidebarNavigationItem({
  item,
  active,
  collapsed = false,
  badgeCount,
  onNavigate,
  className,
}: SidebarNavigationItemProps) {
  const Icon = item.icon
  const hasBadge = badgeCount !== undefined && badgeCount > 0
  const badgeText = hasBadge ? (badgeCount > 99 ? '99+' : String(badgeCount)) : undefined

  const link = (
    <AppLink
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? (hasBadge ? `${item.label} (${badgeCount})` : item.label) : undefined}
      data-active={active ? 'true' : undefined}
      className={cn(
        'group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        active && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
        collapsed && 'justify-center px-0',
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
      {hasBadge && !collapsed ? (
        <span
          className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary"
          aria-label={`${badgeCount} ${item.label.toLowerCase()} needing attention`}
        >
          {badgeText}
        </span>
      ) : null}
      {hasBadge && collapsed ? (
        <span className="absolute top-1 right-1.5 size-2 rounded-full bg-primary" aria-hidden="true" />
      ) : null}
    </AppLink>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {hasBadge ? ` (${badgeText})` : ''}
      </TooltipContent>
    </Tooltip>
  )
}
