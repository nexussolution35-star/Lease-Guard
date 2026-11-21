import { COMPANY_ID_HEADER, unwrap, type ApiClient } from '@leaseguard/api-client'
import type {
  EntityId,
  PortfolioImportColumnMapping,
  PortfolioImportMapping,
  PortfolioImportPreview,
  PortfolioImportRowChange,
  PortfolioImportRowCheck,
  PortfolioImportRowResult,
} from '@leaseguard/domain'

import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

/** Which rows of the preview to read. */
export interface PortfolioImportPreviewParams {
  result?: PortfolioImportRowResult | undefined
  page: number
  pageSize: number
}

/**
 * A batch's column mapping and its row preview (the LeaseGuard API). The company is explicit so a request always
 * matches the company id in its query key.
 */
export interface PortfolioImportPreviewSource {
  /** The mapping applied to the batch, else the company's saved one for the same headings, else the suggested one. */
  getMapping(companyId: EntityId, importId: EntityId): Promise<PortfolioImportMapping>
  /** Company admins and property managers. Rejects with 422 when a column is not the file's or is chosen twice. */
  saveMapping(companyId: EntityId, importId: EntityId, mapping: PortfolioImportColumnMapping): Promise<PortfolioImportMapping>
  /** The batch's rows checked against the database, with the counts per result. */
  preview(companyId: EntityId, importId: EntityId, params: PortfolioImportPreviewParams): Promise<PortfolioImportPreview>
  /**
   * Company admins and property managers. Corrects, skips or links one row (kept on the batch, never on a property or
   * unit) and resolves to the row checked again. Rejects with 422 for a field not imported in the batch's scope or a
   * record that cannot be linked to the row.
   */
  changeRow(companyId: EntityId, importId: EntityId, rowNumber: number, change: PortfolioImportRowChange): Promise<PortfolioImportRowCheck>
}

export function createApiPortfolioImportPreviewSource(api: ApiClient): PortfolioImportPreviewSource {
  const scoped = (companyId: string) => ({ [COMPANY_ID_HEADER]: companyId })
  return {
    async getMapping(companyId, importId) {
      const mapping: PortfolioImportMapping = await unwrap(
        api.GET('/api/v1/portfolio-imports/{importId}/mapping', { params: { path: { importId } }, headers: scoped(companyId) }),
      )
      return mapping
    },

    async saveMapping(companyId, importId, mapping) {
      const saved: PortfolioImportMapping = await unwrap(
        api.PUT('/api/v1/portfolio-imports/{importId}/mapping', { params: { path: { importId } }, body: { mapping }, headers: scoped(companyId) }),
      )
      return saved
    },

    async preview(companyId, importId, { result, page, pageSize }) {
      const preview: PortfolioImportPreview = await unwrap(
        api.GET('/api/v1/portfolio-imports/{importId}/preview', {
          params: { path: { importId }, query: { page, pageSize, ...(result ? { result } : {}) } },
          headers: scoped(companyId),
        }),
      )
      return preview
    },

    async changeRow(companyId, importId, rowNumber, change) {
      const checked: PortfolioImportRowCheck = await unwrap(
        api.PATCH('/api/v1/portfolio-imports/{importId}/rows/{rowNumber}', {
          params: { path: { importId, rowNumber } },
          body: change,
          headers: scoped(companyId),
        }),
      )
      return checked
    },
  }
}

/** The preview source: the LeaseGuard API, created on first use. */
export const getPortfolioImportPreviewSource: () => PortfolioImportPreviewSource = lazySource(() =>
  createApiPortfolioImportPreviewSource(getApiClient()),
)
