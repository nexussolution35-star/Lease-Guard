import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { MonitoringEventListItem } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { MonitoringEventSource } from './source'

/**
 * Monitoring events from the LeaseGuard API (`GET /api/v1/monitoring/events`,
 * `GET /api/v1/monitoring/events/{eventId}`, `PATCH /api/v1/monitoring/events/{eventId}/status`).
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
              open: params.open,
              priority: params.priority,
              type: params.type,
              propertyId: params.propertyId,
              unitId: params.unitId,
              tenantId: params.tenantId,
              leaseId: params.leaseId,
              arrangementId: params.arrangementId,
              assignee: params.assignee,
              due: params.due,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies MonitoringEventListItem[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const event: MonitoringEventListItem = await unwrap(
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

    async updateStatus(companyId, id, change) {
      const event: MonitoringEventListItem = await unwrap(
        api.PATCH('/api/v1/monitoring/events/{eventId}/status', {
          params: { path: { eventId: id } },
          body: change,
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return event
    },
  }
}
