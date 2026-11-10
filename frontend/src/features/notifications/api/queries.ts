import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, Notification } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'
import { getApiClient } from '@/services/api/client'

import { createApiNotificationSource } from './apiSource'
import type { NotificationListParams, NotificationSource } from './source'

export const notificationKeys = createEntityKeys('notifications')

/** How often the unread badge refreshes while the app is open. */
export const UNREAD_REFRESH_MS = 60_000

/** The newest notifications shown in the notification centre. */
export const NOTIFICATION_CENTRE_PARAMS: NotificationListParams = { page: 1, pageSize: 20, sort: 'createdAt', direction: 'desc' }

const UNREAD_COUNT_PARAMS: NotificationListParams = { page: 1, pageSize: 1, unreadOnly: true }

let source: NotificationSource | null = null

/** Created on first use. */
function getNotificationSource(): NotificationSource {
  source ??= createApiNotificationSource(getApiClient())
  return source
}

/** A page of the signed-in user's notifications in the active workspace. */
export function useNotificationList(params: NotificationListParams, options: { enabled?: boolean } = {}): UseQueryResult<Page<Notification>> {
  return useCompanyQuery(
    (companyId) => notificationKeys.list(companyId, params),
    (companyId) => getNotificationSource().list(companyId, params),
    { keepPrevious: true, ...options },
  )
}

/** Unread notifications in the active workspace: the total of an unread-only page of one. */
export function useUnreadNotificationCount(): UseQueryResult<number> {
  return useCompanyQuery(
    (companyId) => notificationKeys.list(companyId, UNREAD_COUNT_PARAMS),
    async (companyId) => (await getNotificationSource().list(companyId, UNREAD_COUNT_PARAMS)).total,
    { refetchInterval: UNREAD_REFRESH_MS },
  )
}

function useActiveCompanyOrThrow(): () => EntityId {
  const companyId = useActiveCompanyId()
  return () => {
    if (companyId === null) throw new Error('No workspace is selected.')
    return companyId
  }
}

/** Mark one notification read, then refresh the workspace's notification queries. */
export function useMarkNotificationRead(): UseMutationResult<Notification | null, Error, EntityId> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (id: EntityId) => getNotificationSource().markRead(companyId(), id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  })
}

/** Mark every notification in the active workspace read, then refresh. Resolves to the number changed. */
export function useMarkAllNotificationsRead(): UseMutationResult<number, Error, void> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: () => getNotificationSource().markAllRead(companyId()),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  })
}
