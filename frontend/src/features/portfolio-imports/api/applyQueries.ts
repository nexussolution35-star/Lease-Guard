import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { ApprovePortfolioImportInput, EntityId, PortfolioImportSummary } from '@leaseguard/domain'

import { propertyKeys } from '@/features/properties/api/queries'
import { tenantKeys } from '@/features/tenants/api/queries'
import { unitKeys } from '@/features/units/api/queries'
import { useCompanyQuery } from '@/lib/data/queries'
import { useActiveCompanyOrThrow } from '@/lib/data/useActiveCompanyOrThrow'

import { getPortfolioImportApplySource } from './applySource'
import { portfolioImportPreviewKeys } from './previewQueries'
import { portfolioImportKeys } from './queries'

/** Under the batch's preview key, so a row change (which reads the preview again) reads the summary again too. */
export const portfolioImportSummaryKey = (companyId: EntityId, importId: EntityId, version: string) =>
  [...portfolioImportPreviewKeys.batch(companyId, importId), 'summary', version] as const

/** What approving the batch creates now, and what it has created. `version` is the batch's `updatedAt`. */
export function usePortfolioImportSummaryQuery(importId: EntityId, version: string): UseQueryResult<PortfolioImportSummary> {
  return useCompanyQuery(
    (companyId) => portfolioImportSummaryKey(companyId, importId, version),
    (companyId) => getPortfolioImportApplySource().getSummary(companyId, importId),
  )
}

/**
 * Approves the batch (company admins and property managers). The batch, its preview and summary, and the property, unit
 * and tenant lists are read again: the approval creates properties, units and tenants.
 */
export function useApprovePortfolioImport(importId: EntityId): UseMutationResult<PortfolioImportSummary, Error, ApprovePortfolioImportInput> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (input: ApprovePortfolioImportInput) => getPortfolioImportApplySource().approve(companyId(), importId, input),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: portfolioImportKeys.detail(companyId(), importId) }),
        queryClient.invalidateQueries({ queryKey: portfolioImportKeys.lists(companyId()) }),
        queryClient.invalidateQueries({ queryKey: propertyKeys.all }),
        queryClient.invalidateQueries({ queryKey: unitKeys.all }),
        queryClient.invalidateQueries({ queryKey: tenantKeys.all }),
      ]),
  })
}
