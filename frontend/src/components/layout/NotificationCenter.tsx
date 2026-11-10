import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { ErrorState, LoadingState } from '@/components/shared'
import {
  NOTIFICATION_CENTRE_PARAMS,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationList,
  useUnreadNotificationCount,
} from '@/features/notifications/api'

import { NotificationList, NotificationPopover } from './NotificationPopover'

export interface NotificationCenterProps {
  className?: string
}

/**
 * The signed-in user's notifications in the active workspace. The unread badge refreshes
 * periodically; the list loads when the panel opens.
 */
export function NotificationCenter({ className }: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const unread = useUnreadNotificationCount()
  const list = useNotificationList(NOTIFICATION_CENTRE_PARAMS, { enabled: open })
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  const fail = (title: string) => (error: Error) => toast.error(title, { description: error.message })

  let body: ReactNode
  if (list.data) {
    body = (
      <NotificationList
        notifications={list.data.items}
        onMarkRead={(n) => {
          if (!n.read) markRead.mutate(n.id, { onError: fail('Could not mark the notification read') })
        }}
        onNavigate={() => setOpen(false)}
      />
    )
  } else if (list.isError) {
    body = <ErrorState title="Notifications could not be loaded" error={list.error} onRetry={() => void list.refetch()} className="m-3" />
  } else {
    body = <LoadingState label="Loading notifications…" rows={3} className="p-3" />
  }

  return (
    <NotificationPopover
      open={open}
      onOpenChange={setOpen}
      unread={unread.data ?? 0}
      markAllBusy={markAllRead.isPending}
      onMarkAllRead={() => markAllRead.mutate(undefined, { onError: fail('Could not mark notifications read') })}
      className={className}
    >
      {body}
    </NotificationPopover>
  )
}
