import { useRouterState } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
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
    <TooltipProvider delayDuration={200}>
      <div className={cn('flex min-h-svh bg-background text-foreground', className)}>
        <a
          href="#main-content"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <ResponsiveNavigation
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          mobileOpen={mobileOpen}
          onMobileOpenChange={setMobileOpen}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenNavigation={() => setMobileOpen(true)} />
          <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 focus:outline-none md:px-6 md:py-8">
            {children}
          </main>
        </div>
      </div>
      <Toaster position="top-right" richColors closeButton />
    </TooltipProvider>
  )
}
