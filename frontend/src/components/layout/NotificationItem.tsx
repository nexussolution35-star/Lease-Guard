import { Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react'

import { AppLink, DateDisplay } from '@/components/shared'
import { entityHref } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { markRead } from '@/services/notifications'
import type { Notification, NotificationSeverity } from '@leaseguard/domain'

export interface NotificationItemProps {
  notification: Notification
  /** Called after the item is activated (e.g. to close the popover). */
  onNavigate?: () => void
  className?: string
}

const SEVERITY: Readonly<Record<NotificationSeverity, { icon: LucideIcon; className: string; label: string }>> = {
  info: { icon: Info, className: 'bg-info/10 text-info', label: 'Information' },
  warning: { icon: TriangleAlert, className: 'bg-warning/15 text-foreground', label: 'Warning' },
  critical: { icon: OctagonAlert, className: 'bg-destructive/10 text-destructive', label: 'Critical' },
}

export function NotificationItem({ notification, onNavigate, className }: NotificationItemProps) {
  const severity = SEVERITY[notification.severity]
  const Icon = severity.icon
  const href = notification.link ? entityHref(notification.link.entityType, notification.link.entityId) : undefined

  const activate = () => {
    markRead(notification.id)
    onNavigate?.()
  }

  const body = (
    <>
      <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', severity.className)}>
        <Icon className="size-3.5" aria-hidden="true" />
        <span className="sr-only">{severity.label}</span>
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex items-start gap-2">
          <span className={cn('flex-1 text-sm', notification.read ? 'text-muted-foreground' : 'font-medium text-foreground')}>
            {notification.title}
          </span>
          {notification.read ? null : (
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" role="img" />
          )}
        </span>
        <span className="line-clamp-2 block text-xs text-muted-foreground">{notification.body}</span>
        <DateDisplay value={notification.createdAt} style="relative" className="block text-xs text-muted-foreground" />
      </span>
    </>
  )

  const itemClass = cn(
    'flex w-full gap-3 rounded-md p-2.5 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
    !notification.read && 'bg-primary/5',
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
