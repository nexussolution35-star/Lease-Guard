import { Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react'

import { AppLink, DateDisplay } from '@/components/shared'
import { entityHref } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import type { Notification, NotificationSeverity } from '@leaseguard/domain'

export interface NotificationItemProps {
  notification: Notification
  /** Marks the notification read when it is activated (through the API). */
  onMarkRead: (notification: Notification) => void
  /** Called after the item is activated (e.g. to close the popover). */
  onNavigate?: () => void
  className?: string
}

const SEVERITY: Readonly<Record<NotificationSeverity, { icon: LucideIcon; className: string; label: string }>> = {
  info: { icon: Info, className: 'text-muted-foreground', label: 'Information' },
  warning: { icon: TriangleAlert, className: 'text-foreground', label: 'Warning' },
  critical: { icon: OctagonAlert, className: 'text-destructive', label: 'Critical' },
}

export function NotificationItem({ notification, onMarkRead, onNavigate, className }: NotificationItemProps) {
  const severity = SEVERITY[notification.severity]
  const Icon = severity.icon
  const href = notification.link ? entityHref(notification.link.entityType, notification.link.entityId) : undefined

  const activate = () => {
    onMarkRead(notification)
    onNavigate?.()
  }

  const body = (
    <>
      <Icon className={cn('mt-0.5 size-4 shrink-0', severity.className)} aria-hidden="true" />
      <span className="sr-only">{severity.label}</span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex items-start gap-2">
          <span className={cn('min-w-0 flex-1 text-sm break-words text-foreground', !notification.read && 'font-medium')}>
            {notification.title}
          </span>
          <DateDisplay
            value={notification.createdAt}
            style="relative"
            className="mt-0.5 shrink-0 text-xs text-muted-foreground tabular-nums"
          />
          {notification.read ? null : (
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" role="img" />
          )}
        </span>
        <span className="line-clamp-2 block text-xs text-muted-foreground">{notification.body}</span>
      </span>
    </>
  )

  const itemClass = cn(
    'flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
    className,
  )

  return href ? (
    <AppLink to={href} onClick={activate} className={itemClass}>
      {body}
    </AppLink>
  ) : (
    <button type="button" onClick={activate} className={itemClass}>
      {body}
    </button>
  )
}
