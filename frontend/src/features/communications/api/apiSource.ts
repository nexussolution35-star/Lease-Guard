import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Communication, CommunicationAnalytics } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { ApprovalDecisionResult, CommunicationSource, PendingApproval } from './source'

/**
 * Communications from the LeaseGuard API (`GET /api/v1/communications`,
 * `GET /api/v1/communications/{communicationId}`) and the approval queue (`GET /api/v1/communications/approvals`,
 * `POST …/{communicationId}/approve`, `POST …/{communicationId}/reject`) and the analytics
 * (`GET /api/v1/communications/analytics`).
 */
export function createApiCommunicationSource(api: ApiClient): CommunicationSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/communications', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              status: params.status,
              messageType: params.messageType,
              recipientType: params.recipientType,
              channel: params.channel,
              tenantId: params.tenantId,
              propertyId: params.propertyId,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies Communication[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const communication: Communication = await unwrap(
          api.GET('/api/v1/communications/{communicationId}', {
            params: { path: { communicationId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return communication
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },

    async listPendingApprovals(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/communications/approvals', {
          params: { query: compactQuery({ page: params.page, pageSize: params.pageSize }) },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies PendingApproval[] }
    },

    async approve(companyId, communicationId, note) {
      const result: ApprovalDecisionResult = await unwrap(
        api.POST('/api/v1/communications/{communicationId}/approve', {
          params: { path: { communicationId } },
          body: note ? { note } : {},
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return result
    },

    async reject(companyId, communicationId, reason) {
      const result: ApprovalDecisionResult = await unwrap(
        api.POST('/api/v1/communications/{communicationId}/reject', {
          params: { path: { communicationId } },
          body: { note: reason },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return result
    },

    async analytics(companyId, params) {
      const figures: CommunicationAnalytics = await unwrap(
        api.GET('/api/v1/communications/analytics', {
          params: { query: compactQuery({ from: params.from, to: params.to }) },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return figures
    },
  }
}
