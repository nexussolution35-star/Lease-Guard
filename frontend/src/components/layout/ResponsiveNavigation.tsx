import { AppSidebar } from './AppSidebar'
import { MobileNavigationDrawer } from './MobileNavigationDrawer'

export interface ResponsiveNavigationProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
}

/** Sidebar on `md` and up; a slide-in drawer below `md`. */
export function ResponsiveNavigation({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onMobileOpenChange,
}: ResponsiveNavigationProps) {
  return (
    <>
      <AppSidebar collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} className="hidden md:flex" />
      <MobileNavigationDrawer open={mobileOpen} onOpenChange={onMobileOpenChange} />
    </>
  )
}
