import { COMPANY_ID_HEADER, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'

import type { CompanySource } from './source'

/** The active company from the LeaseGuard API (`/api/v1/companies/{companyId}` and its sub-resources). */
export function createApiCompanySource(api: ApiClient): CompanySource {
  // The path and X-Company-Id must name the same (active) company.
  const request = (companyId: string) => ({ params: { path: { companyId } }, headers: { [COMPANY_ID_HEADER]: companyId } })
  return {
    async get(companyId) {
      try {
        return await unwrap(api.GET('/api/v1/companies/{companyId}', request(companyId)))
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },
    update(companyId, changes) {
      return unwrap(api.PATCH('/api/v1/companies/{companyId}', { ...request(companyId), body: changes }))
    },
    configureWhatsApp(companyId, configuration) {
      return unwrap(api.PUT('/api/v1/companies/{companyId}/whatsapp', { ...request(companyId), body: configuration }))
    },
    getOnboarding(companyId) {
      return unwrap(api.GET('/api/v1/companies/{companyId}/onboarding', request(companyId)))
    },
  }
}
