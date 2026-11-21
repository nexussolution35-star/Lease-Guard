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
      {NAV_SECTIONS.map((section) => (
        <div
          key={section.id}
          {...(section.label ? { role: 'group', 'aria-labelledby': `nav-section-${section.id}` } : {})}
          // Captions keep their space on the rail (faded out), so the icons never shift up or down.
        >
          {section.label ? (
            <p
              id={`nav-section-${section.id}`}
              className={cn('px-3 pb-2 text-xs leading-4 whitespace-nowrap text-muted-foreground transition-opacity duration-200 ease-out motion-reduce:transition-none', collapsed && 'opacity-0')}
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
