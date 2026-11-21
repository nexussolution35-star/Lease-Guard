import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import { SidebarHeader } from './SidebarHeader'
import { SidebarNavigation } from './SidebarNavigation'

export interface MobileNavigationDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
}

export function MobileNavigationDrawer({ open, onOpenChange, className }: MobileNavigationDrawerProps) {
  const close = () => onOpenChange(false)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className={cn('rail flex w-72 flex-col gap-0 border-r-0 p-0 sm:max-w-72', className)}>
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Main navigation and workspace switcher</SheetDescription>
        </SheetHeader>
        <SidebarHeader />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNavigation onNavigate={close} className="px-2 py-3" />
        </div>
      </SheetContent>
    </Sheet>
  )
}
