import { useMemo } from 'react'

import { useAppStore } from '@/store/appStore'
import { generateId, nowISO } from '@/store/ids'
import type { EntityId, EntityType, Notification, NotificationSeverity, NotificationType } from '@leaseguard/domain'

import { getActiveCompanyId, getCurrentUserId } from '@/services/repository'

/**
 * Notifications are per-user UI state. They are written directly to the store and deliberately
 * do not generate audit rows (reading a notification is not a business action).
 */

function scoped(notifications: Readonly<Record<EntityId, Notification>>, companyId: EntityId, userId: EntityId): Notification[] {
  return Object.values(notifications)
    .filter((n) => n.companyId === companyId && n.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function listForCurrentUser(): Notification[] {
  const { collections, workspace } = useAppStore.getState()
  return scoped(collections.notifications, workspace.activeCompanyId, workspace.currentUserId)
}

export function getUnreadCount(): number {
  return listForCurrentUser().filter((n) => !n.read).length
}

export function markRead(notificationId: EntityId): Notification | undefined {
  const { collections, patch } = useAppStore.getState()
  const existing = collections.notifications[notificationId]
  if (!existing || existing.read) return existing
  const at = nowISO()
  patch('notifications', notificationId, { read: true, readAt: at, updatedAt: at })
  return useAppStore.getState().collections.notifications[notificationId]
}

export function markAllRead(): number {
  const unread = listForCurrentUser().filter((n) => !n.read)
  if (unread.length === 0) return 0
  const at = nowISO()
  useAppStore
    .getState()
    .bulkUpsert('notifications', unread.map((n) => ({ ...n, read: true, readAt: at, updatedAt: at })))
  return unread.length
}

export interface PushNotificationInput {
  /** Defaults to the current user. */
  userId?: EntityId
  type: NotificationType
  severity?: NotificationSeverity
  title: string
  body: string
  link?: { entityType: EntityType; entityId: EntityId }
}

export function pushNotification(input: PushNotificationInput): Notification {
  const at = nowISO()
  const notification: Notification = {
    id: generateId('ntf'),
    companyId: getActiveCompanyId(),
    createdAt: at,
    updatedAt: at,
    userId: input.userId ?? getCurrentUserId(),
    type: input.type,
    severity: input.severity ?? 'info',
    title: input.title,
    body: input.body,
    read: false,
    ...(input.link ? { link: input.link } : {}),
  }
  useAppStore.getState().upsert('notifications', notification)
  return notification
}

export function removeNotification(notificationId: EntityId): void {
  useAppStore.getState().remove('notifications', notificationId)
}

// Hooks --------------------------------------------------------------------

export function useNotifications(): Notification[] {
  const notifications = useAppStore((s) => s.collections.notifications)
  const companyId = useAppStore((s) => s.workspace.activeCompanyId)
  const userId = useAppStore((s) => s.workspace.currentUserId)
  return useMemo(() => scoped(notifications, companyId, userId), [notifications, companyId, userId])
}

export function useUnreadCount(): number {
  const list = useNotifications()
  return useMemo(() => list.filter((n) => !n.read).length, [list])
}
