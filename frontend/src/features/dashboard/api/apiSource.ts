import { COMPANY_ID_HEADER, unwrap, type ApiClient } from '@leaseguard/api-client'

import type { DashboardSource } from './source'

/** Dashboard figures from the LeaseGuard API (`GET /api/v1/dashboard/summary`), for the company named explicitly. */
export function createApiDashboardSource(api: ApiClient): DashboardSource {
  return {
    summary: (companyId) => unwrap(api.GET('/api/v1/dashboard/summary', { headers: { [COMPANY_ID_HEADER]: companyId } })),
  }
}
