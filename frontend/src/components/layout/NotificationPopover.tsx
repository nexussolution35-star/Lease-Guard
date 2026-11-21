import { Bell } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { EmptyState } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { Notification } from '@leaseguard/domain'

import { NotificationItem } from './NotificationItem'

export interface NotificationPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  unread: number
  onMarkAllRead: () => void
  /** Disables "Mark all read" in addition to when nothing is unread (e.g. while a request runs). */
  markAllBusy?: boolean
  /** The panel body: a NotificationList, or a loading / error state. */
  children: ReactNode
  className?: string | undefined
}

/** The bell button with its unread dot and the notifications panel. */
export function NotificationPopover({
  open,
  onOpenChange,
  unread,
  onMarkAllRead,
  markAllBusy = false,
  children,
  className,
}: NotificationPopoverProps) {
  const headingId = useId()
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className={cn('relative', className)}
        >
          <Bell aria-hidden="true" />
          {unread > 0 ? (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" aria-hidden="true" />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={headingId} className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border py-1.5 pr-1.5 pl-3">
          <h2 id={headingId} className="flex items-baseline gap-2 text-sm font-medium">
            Notifications
            {unread > 0 ? <span className="text-xs font-normal text-muted-foreground tabular-nums">{unread} unread</span> : null}
          </h2>
          <Button type="button" variant="ghost" size="sm" disabled={unread === 0 || markAllBusy} onClick={onMarkAllRead}>
            Mark all read
          </Button>
        </div>
        {children}
      </PopoverContent>
    </Popover>
  )
}

export interface NotificationListProps {
  notifications: readonly Notification[]
  onMarkRead: (notification: Notification) => void
  /** Called after an item is activated (closes the popover). */
  onNavigate: () => void
}

export function NotificationList({ notifications, onMarkRead, onNavigate }: NotificationListProps) {
  if (notifications.length === 0) {
    return (
      <EmptyState
        title="You’re all caught up"
        description="Notifications for this workspace will appear here."
        className="items-center px-3 text-center"
      />
    )
  }
  // Fits the room left below the bell (less the 3rem header row) and does not scroll the page at its ends.
  return (
    <div className="max-h-[min(60dvh,calc(var(--radix-popover-content-available-height,100dvh)-3rem))] overflow-y-auto overscroll-contain">
      <ul className="divide-y divide-border">
        {notifications.map((n) => (
          <li key={n.id}>
            <NotificationItem notification={n} onMarkRead={onMarkRead} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  )
}
