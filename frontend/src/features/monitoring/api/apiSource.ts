import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { MonitoringEvent } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { MonitoringEventSource } from './source'

/**
 * Monitoring events from the LeaseGuard API (`GET /api/v1/monitoring/events`,
 * `GET /api/v1/monitoring/events/{eventId}`).
 */
export function createApiMonitoringEventSource(api: ApiClient): MonitoringEventSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/monitoring/events', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              status: params.status,
              priority: params.priority,
              type: params.type,
              propertyId: params.propertyId,
              leaseId: params.leaseId,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies MonitoringEvent[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const event: MonitoringEvent = await unwrap(
          api.GET('/api/v1/monitoring/events/{eventId}', {
            params: { path: { eventId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return event
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },
  }
}
