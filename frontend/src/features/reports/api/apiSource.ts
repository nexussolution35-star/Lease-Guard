import { COMPANY_ID_HEADER, compactQuery, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { EntityId, ReportEnvelope, ReportFilters } from '@leaseguard/domain'

import type { AvailableReportId, ReportsSource } from './source'

/** The shared report query: `propertyId` and `status` repeat (`?status=a&status=b`). */
export interface ReportQuery {
  propertyId?: string[]
  from?: string
  to?: string
  status?: string[]
}

/** The filters as the report endpoints read them; empty lists are left out. */
export function reportQueryOf(filters: ReportFilters): ReportQuery {
  return compactQuery({
    propertyId: filters.propertyIds && filters.propertyIds.length > 0 ? [...filters.propertyIds] : undefined,
    from: filters.from,
    to: filters.to,
    status: filters.statuses && filters.statuses.length > 0 ? [...filters.statuses] : undefined,
  })
}

type ReportRequest<Id extends AvailableReportId> = (api: ApiClient, companyId: EntityId, query: ReportQuery) => Promise<ReportEnvelope<Id>>

const headersFor = (companyId: EntityId) => ({ [COMPANY_ID_HEADER]: companyId })

/** One request per report the service serves. */
const REPORT_REQUESTS: { [Id in AvailableReportId]: ReportRequest<Id> } = {
  portfolio_overview: (api, companyId, query) =>
    unwrap(api.GET('/api/v1/reports/portfolio_overview', { params: { query }, headers: headersFor(companyId) })),
  occupancy: (api, companyId, query) => unwrap(api.GET('/api/v1/reports/occupancy', { params: { query }, headers: headersFor(companyId) })),
  lease_monitoring: (api, companyId, query) =>
    unwrap(api.GET('/api/v1/reports/lease_monitoring', { params: { query }, headers: headersFor(companyId) })),
  rental_discrepancies: (api, companyId, query) =>
    unwrap(api.GET('/api/v1/reports/rental_discrepancies', { params: { query }, headers: headersFor(companyId) })),
  lease_expiry: (api, companyId, query) =>
    unwrap(api.GET('/api/v1/reports/lease_expiry', { params: { query }, headers: headersFor(companyId) })),
  renewal_deadlines: (api, companyId, query) =>
    unwrap(api.GET('/api/v1/reports/renewal_deadlines', { params: { query }, headers: headersFor(companyId) })),
  arrears: (api, companyId, query) => unwrap(api.GET('/api/v1/reports/arrears', { params: { query }, headers: headersFor(companyId) })),
  payment_arrangements: (api, companyId, query) =>
    unwrap(api.GET('/api/v1/reports/payment_arrangements', { params: { query }, headers: headersFor(companyId) })),
  deposits_guarantees: (api, companyId, query) =>
    unwrap(api.GET('/api/v1/reports/deposits_guarantees', { params: { query }, headers: headersFor(companyId) })),
  statement_processing: (api, companyId, query) =>
    unwrap(api.GET('/api/v1/reports/statement_processing', { params: { query }, headers: headersFor(companyId) })),
  communication_activity: (api, companyId, query) =>
    unwrap(api.GET('/api/v1/reports/communication_activity', { params: { query }, headers: headersFor(companyId) })),
}

/** Reports from the reports service through the gateway, for the company named explicitly. */
export function createApiReportsSource(api: ApiClient): ReportsSource {
  return {
    catalogue: async (companyId) => (await unwrap(api.GET('/api/v1/reports', { headers: headersFor(companyId) }))).reports,
    report: (companyId, id, filters) => REPORT_REQUESTS[id](api, companyId, reportQueryOf(filters)),
  }
}
