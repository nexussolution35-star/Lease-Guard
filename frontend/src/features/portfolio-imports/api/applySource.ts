import { COMPANY_ID_HEADER, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { ApprovePortfolioImportInput, EntityId, PortfolioImportSummary } from '@leaseguard/domain'

import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

/**
 * Approving a portfolio import (the LeaseGuard API). The company is explicit so a request always matches the company id
 * in its query key.
 */
export interface PortfolioImportApplySource {
  /** What approving creates now, the rows linked, skipped and still blocked, the last approval and the records created. */
  getSummary(companyId: EntityId, importId: EntityId): Promise<PortfolioImportSummary>
  /**
   * Company admins and property managers. Creates the new properties and units in one transaction and resolves to the
   * summary after it. Rejects with 422 when the accounting system is missing while properties are created, and 409 when
   * records were added meanwhile.
   */
  approve(companyId: EntityId, importId: EntityId, input: ApprovePortfolioImportInput): Promise<PortfolioImportSummary>
}

export function createApiPortfolioImportApplySource(api: ApiClient): PortfolioImportApplySource {
  const scoped = (companyId: string) => ({ [COMPANY_ID_HEADER]: companyId })
  return {
    async getSummary(companyId, importId) {
      const summary: PortfolioImportSummary = await unwrap(
        api.GET('/api/v1/portfolio-imports/{importId}/summary', { params: { path: { importId } }, headers: scoped(companyId) }),
      )
      return summary
    },

    async approve(companyId, importId, input) {
      const summary: PortfolioImportSummary = await unwrap(
        api.POST('/api/v1/portfolio-imports/{importId}/approve', { params: { path: { importId } }, body: input, headers: scoped(companyId) }),
      )
      return summary
    },
  }
}

/** The approval source: the LeaseGuard API, created on first use. */
export const getPortfolioImportApplySource: () => PortfolioImportApplySource = lazySource(() =>
  createApiPortfolioImportApplySource(getApiClient()),
)
