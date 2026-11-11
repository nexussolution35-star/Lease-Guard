import { COMPANY_ID_HEADER, compactQuery, unwrap, type ApiClient } from '@leaseguard/api-client'

import type { AuditSource } from './source'

/** The audit log from the LeaseGuard API (`GET /api/v1/audit-logs`), newest entries first. */
export function createApiAuditSource(api: ApiClient): AuditSource {
  return {
    list(companyId, params) {
      return unwrap(
        api.GET('/api/v1/audit-logs', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              sort: 'occurredAt',
              direction: 'desc',
              action: params.action,
              entityType: params.entityType,
              actorUserId: params.actorUserId,
              from: params.from,
              to: params.to,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
    },
  }
}
