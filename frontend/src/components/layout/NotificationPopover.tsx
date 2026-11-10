import { Bell, BellOff, CheckCheck } from 'lucide-react'
import type { ReactNode } from 'react'

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

/** The bell button with its unread badge and the notifications panel. */
export function NotificationPopover({
  open,
  onOpenChange,
  unread,
  onMarkAllRead,
  markAllBusy = false,
  children,
  className,
}: NotificationPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className={cn('relative', className)}
        >
          <Bell aria-hidden="true" />
          {unread > 0 ? (
            <span
              className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white tabular-nums"
              aria-hidden="true"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">
            Notifications
            {unread > 0 ? <span className="ml-1.5 text-muted-foreground">({unread} unread)</span> : null}
          </h2>
          <Button type="button" variant="ghost" size="sm" disabled={unread === 0 || markAllBusy} onClick={onMarkAllRead}>
            <CheckCheck aria-hidden="true" />
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
        icon={BellOff}
        title="You're all caught up"
        description="Notifications for this workspace will appear here."
        className="m-3 border-none"
      />
    )
  }
  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <ul className="flex flex-col gap-0.5 p-1.5">
        {notifications.map((n) => (
          <li key={n.id}>
            <NotificationItem notification={n} onMarkRead={onMarkRead} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  )
}
