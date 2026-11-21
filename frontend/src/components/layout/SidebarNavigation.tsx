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
    <nav aria-label="Main" className={cn('flex flex-col gap-6', className)}>
      {NAV_SECTIONS.map((section, index) => (
        <div
          key={section.id}
          {...(section.label ? { role: 'group', 'aria-labelledby': `nav-section-${section.id}` } : {})}
          // The rail has no captions, so a hairline separates its groups.
          className={cn(collapsed && index > 0 && 'border-t border-border pt-6')}
        >
          {section.label ? (
            <p
              id={`nav-section-${section.id}`}
              className={cn('px-2 pb-2 text-xs leading-4 text-muted-foreground', collapsed && 'sr-only')}
            >
              {section.label}
            </p>
          ) : null}
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
