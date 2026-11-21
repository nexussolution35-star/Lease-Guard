export { COMPANY_ID_HEADER, createApiClient, unwrap, type ApiClient, type ApiClientOptions, type paths as GatewayPaths } from './client.js'
export { ApiError, apiErrorFromResponse, isApiError, NETWORK_ERROR_STATUS, type ApiErrorBody } from './errors.js'
export { compactQuery, pageCount, type Page } from './pagination.js'
export type * from './generated/schema.js'
/** The reports service's generated types (services/reports/openapi.json), e.g. `Reports.ReportCatalogueDto`. */
export type * as Reports from './generated/reports-schema.js'
