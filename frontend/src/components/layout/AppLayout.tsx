import { useRouterState } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { ResponsiveNavigation } from './ResponsiveNavigation'
import { Topbar } from './Topbar'
import { useSidebarCollapsed } from './useSidebarCollapsed'

export interface AppLayoutProps {
  children: ReactNode
  className?: string
}

/** Application shell: responsive sidebar, topbar and the routed page content. */
export function AppLayout({ children, className }: AppLayoutProps) {
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // The drawer remembers the path it was opened on, so any navigation (links, search,
  // notifications, back button) closes it without an effect.
  const [drawerOpenedOn, setDrawerOpenedOn] = useState<string | null>(null)
  const mobileOpen = drawerOpenedOn === pathname
  const setMobileOpen = (open: boolean) => setDrawerOpenedOn(open ? pathname : null)

  return (
    <div className={cn('flex min-h-svh bg-background text-foreground', className)}>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
      >
        Skip to content
      </a>
      {/* The navigation and the top bar are left out of print (reports print their work area only). */}
      <div className="contents print:hidden">
        <ResponsiveNavigation
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          mobileOpen={mobileOpen}
          onMobileOpenChange={setMobileOpen}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="contents print:hidden">
          <Topbar onOpenNavigation={() => setMobileOpen(true)} />
        </div>
        {/* With the sidebar retracted the page is centred (owner decision, 21 Nov 2026). */}
        <main
          id="main-content"
          tabIndex={-1}
          data-sidebar={collapsed ? 'collapsed' : 'expanded'}
          className={cn(
            'group/main w-full flex-1 px-4 pt-6 pb-12 transition-[padding] duration-200 ease-out motion-reduce:transition-none focus:outline-none md:px-6 lg:px-8 print:p-0!',
            // Beside the full sidebar the page starts at its edge and stops at 92rem; with the rail it is at most
            // 76rem wide and centred. Both are paddings, so the change animates.
            collapsed
              ? 'md:px-[max(1.5rem,calc((100%_-_76rem)/2))] lg:px-[max(2rem,calc((100%_-_76rem)/2))]'
              : 'lg:pr-[max(2rem,calc(100%_-_94rem))]',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
