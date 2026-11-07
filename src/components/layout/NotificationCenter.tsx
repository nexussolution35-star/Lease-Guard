import { Bell, BellOff, CheckCheck } from 'lucide-react'
import { useState } from 'react'

import { EmptyState } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { markAllRead, useNotifications, useUnreadCount } from '@/services/notifications'

import { NotificationItem } from './NotificationItem'

export interface NotificationCenterProps {
  className?: string
}

export function NotificationCenter({ className }: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const notifications = useNotifications()
  const unread = useUnreadCount()

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={unread === 0}
            onClick={() => markAllRead()}
          >
            <CheckCheck aria-hidden="true" />
            Mark all read
          </Button>
        </div>
        {notifications.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="You're all caught up"
            description="Notifications for this workspace will appear here."
            className="m-3 border-none"
          />
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <ul className="flex flex-col gap-0.5 p-1.5">
              {notifications.map((n) => (
                <li key={n.id}>
                  <NotificationItem notification={n} onNavigate={() => setOpen(false)} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
