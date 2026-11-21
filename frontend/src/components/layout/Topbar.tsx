import { Menu } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { AccountMenu } from './AccountMenu'
import { Breadcrumbs } from './Breadcrumbs'
import { NotificationCenter } from './NotificationCenter'

export interface TopbarProps {
  /** Opens the mobile navigation drawer. */
  onOpenNavigation: () => void
  className?: string
}

export function Topbar({ onOpenNavigation, className }: TopbarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background px-4 md:px-6 lg:px-8',
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="-ml-1.5 md:hidden"
        onClick={onOpenNavigation}
        aria-label="Open navigation"
      >
        <Menu aria-hidden="true" />
      </Button>
      {/* The trail is absent on top-level screens; the spacer keeps the actions on the right. */}
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <NotificationCenter />
        <AccountMenu />
      </div>
    </header>
  )
}
