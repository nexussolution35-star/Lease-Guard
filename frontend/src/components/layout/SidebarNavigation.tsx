import { useRouterState } from '@tanstack/react-router'

import { isNavItemActive, NAV_SECTIONS } from '@/lib/navigation'
import { cn } from '@/lib/utils'

import { SidebarNavigationItem } from './SidebarNavigationItem'

export interface SidebarNavigationProps {
  collapsed?: boolean
  /** Called after a link is followed (the mobile drawer closes itself with this). */
  onNavigate?: () => void
  className?: string
}

export function SidebarNavigation({ collapsed = false, onNavigate, className }: SidebarNavigationProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <nav aria-label="Main" className={cn('flex flex-col gap-4', className)}>
      {NAV_SECTIONS.map((section) => (
        <div key={section.id} role="group" aria-labelledby={`nav-section-${section.id}`}>
          <h2
            id={`nav-section-${section.id}`}
            className={cn(
              'mb-1 px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase',
              collapsed && 'sr-only',
            )}
          >
            {section.label}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <li key={item.id}>
                <SidebarNavigationItem
                  item={item}
                  active={isNavItemActive(item, pathname)}
                  collapsed={collapsed}
                  {...(onNavigate ? { onNavigate } : {})}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
