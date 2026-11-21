import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type {
  EntityId,
  PortfolioImportColumnMapping,
  PortfolioImportMapping,
  PortfolioImportPreview,
  PortfolioImportRowChange,
  PortfolioImportRowCheck,
} from '@leaseguard/domain'

import { useCompanyQuery } from '@/lib/data/queries'
import { useActiveCompanyOrThrow } from '@/lib/data/useActiveCompanyOrThrow'

import { getPortfolioImportPreviewSource, type PortfolioImportPreviewParams } from './previewSource'
import { portfolioImportKeys } from './queries'

/**
 * Keys under the batch's detail key. `version` is the batch's `updatedAt`: reading another sheet changes the columns,
 * so the mapping and preview of the previous sheet are never shown for the new one.
 */
export const portfolioImportPreviewKeys = {
  batch: (companyId: EntityId, importId: EntityId) => [...portfolioImportKeys.detail(companyId, importId), 'preview'] as const,
  mapping: (companyId: EntityId, importId: EntityId, version: string) =>
    [...portfolioImportPreviewKeys.batch(companyId, importId), 'mapping', version] as const,
  rows: (companyId: EntityId, importId: EntityId, version: string, params: PortfolioImportPreviewParams) =>
    [...portfolioImportPreviewKeys.batch(companyId, importId), 'rows', version, params] as const,
}

/** How the batch's columns map to LeaseGuard fields. */
export function usePortfolioImportMappingQuery(importId: EntityId, version: string): UseQueryResult<PortfolioImportMapping> {
  return useCompanyQuery(
    (companyId) => portfolioImportPreviewKeys.mapping(companyId, importId, version),
    (companyId) => getPortfolioImportPreviewSource().getMapping(companyId, importId),
  )
}

/** One page of the batch's rows checked against the database; the previous page stays visible while the next loads. */
export function usePortfolioImportPreviewQuery(
  importId: EntityId,
  version: string,
  params: PortfolioImportPreviewParams,
): UseQueryResult<PortfolioImportPreview> {
  return useCompanyQuery(
    (companyId) => portfolioImportPreviewKeys.rows(companyId, importId, version, params),
    (companyId) => getPortfolioImportPreviewSource().preview(companyId, importId, params),
    { keepPrevious: true },
  )
}

/** Applies a mapping to the batch (company admins and property managers); the mapping and preview are read again. */
export function useSavePortfolioImportMapping(
  importId: EntityId,
): UseMutationResult<PortfolioImportMapping, Error, PortfolioImportColumnMapping> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (mapping: PortfolioImportColumnMapping) => getPortfolioImportPreviewSource().saveMapping(companyId(), importId, mapping),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: portfolioImportPreviewKeys.batch(companyId(), importId) }),
  })
}

/**
 * Corrects, skips or links one row (company admins and property managers). The batch is read again (the first
 * correction applies the mapping shown to it), and with it the mapping and every row: a change to one row can change
 * another's result, such as the duplicate of a skipped row.
 */
export function useChangePortfolioImportRow(
  importId: EntityId,
): UseMutationResult<PortfolioImportRowCheck, Error, { rowNumber: number; change: PortfolioImportRowChange }> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: ({ rowNumber, change }: { rowNumber: number; change: PortfolioImportRowChange }) =>
      getPortfolioImportPreviewSource().changeRow(companyId(), importId, rowNumber, change),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: portfolioImportKeys.detail(companyId(), importId) }),
        queryClient.invalidateQueries({ queryKey: portfolioImportKeys.lists(companyId()) }),
      ]),
  })
}
