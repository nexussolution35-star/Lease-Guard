import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Notification } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { NotificationSource } from './source'

/**
 * Notifications from the LeaseGuard API (`GET /api/v1/notifications`,
 * `POST /api/v1/notifications/{notificationId}/read`, `POST /api/v1/notifications/read-all`).
 */
export function createApiNotificationSource(api: ApiClient): NotificationSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/notifications', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              unreadOnly: params.unreadOnly,
              type: params.type,
              severity: params.severity,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies Notification[] }
    },

    async markRead(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const notification: Notification = await unwrap(
          api.POST('/api/v1/notifications/{notificationId}/read', {
            params: { path: { notificationId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return notification
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },

    async markAllRead(companyId) {
      const result = await unwrap(api.POST('/api/v1/notifications/read-all', { headers: { [COMPANY_ID_HEADER]: companyId } }))
      return result.updated
    },
  }
}
