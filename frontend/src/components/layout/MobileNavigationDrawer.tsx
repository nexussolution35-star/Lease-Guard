import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import { SidebarFooter } from './SidebarFooter'
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
      <SheetContent side="left" className={cn('flex w-72 flex-col gap-0 p-0 sm:max-w-72', className)}>
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Main navigation and workspace switcher</SheetDescription>
        </SheetHeader>
        <SidebarHeader className="border-b border-border p-3 pr-12" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNavigation onNavigate={close} className="p-3" />
        </div>
        <SidebarFooter className="border-t border-border p-3" />
      </SheetContent>
    </Sheet>
  )
}
