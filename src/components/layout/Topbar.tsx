import { Menu } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { Breadcrumbs } from './Breadcrumbs'
import { GlobalSearch } from './GlobalSearch'
import { NotificationCenter } from './NotificationCenter'
import { UserProfileMenu } from './UserProfileMenu'

export interface TopbarProps {
  /** Opens the mobile navigation drawer. */
  onOpenNavigation: () => void
  className?: string
}

export function Topbar({ onOpenNavigation, className }: TopbarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:gap-3 md:px-6',
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-ml-2 md:hidden"
        onClick={onOpenNavigation}
        aria-label="Open navigation"
      >
        <Menu aria-hidden="true" />
      </Button>
      <Breadcrumbs className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <GlobalSearch />
        <NotificationCenter />
        <UserProfileMenu />
      </div>
    </header>
  )
}
