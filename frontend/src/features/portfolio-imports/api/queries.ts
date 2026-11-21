import { useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, PortfolioImport } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyOrThrow } from '@/lib/data/useActiveCompanyOrThrow'

import { getPortfolioImportSource } from './selectSource'
import type { GoogleSheetImport, PortfolioFileUpload, PortfolioImportListParams } from './source'

export const portfolioImportKeys = createEntityKeys('portfolio-imports')

/** The active workspace's import history, newest first. */
export function usePortfolioImportList(params: PortfolioImportListParams): UseQueryResult<Page<PortfolioImport>> {
  return useCompanyQuery(
    (companyId) => portfolioImportKeys.list(companyId, params),
    (companyId) => getPortfolioImportSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** One portfolio import batch of the active workspace; data is null when it does not exist there. */
export function usePortfolioImportQuery(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<PortfolioImport | null> {
  return useCompanyQuery(
    (companyId) => portfolioImportKeys.detail(companyId, id),
    (companyId) => getPortfolioImportSource().get(companyId, id),
    options,
  )
}

/** Stores the returned batch in its detail cache. */
function usePortfolioImportMutation<TVariables>(
  run: (companyId: EntityId, variables: TVariables) => Promise<PortfolioImport>,
): UseMutationResult<PortfolioImport, Error, TVariables> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (variables: TVariables) => run(companyId(), variables),
    onSuccess: (batch) => queryClient.setQueryData(portfolioImportKeys.detail(batch.companyId, batch.id), batch),
  })
}

/** Uploads a portfolio file and has the API read it into a batch (company admins and property managers). */
export function useUploadPortfolioFile(): UseMutationResult<PortfolioImport, Error, PortfolioFileUpload> {
  return usePortfolioImportMutation((companyId, upload: PortfolioFileUpload) => getPortfolioImportSource().upload(companyId, upload))
}

/** Has the API read a Google Sheet from its link into a batch (company admins and property managers). */
export function useImportGoogleSheet(): UseMutationResult<PortfolioImport, Error, GoogleSheetImport> {
  return usePortfolioImportMutation((companyId, sheet: GoogleSheetImport) => getPortfolioImportSource().importGoogleSheet(companyId, sheet))
}

/** Reads a batch's workbook from another of its sheets. */
export function useSelectPortfolioImportSheet(): UseMutationResult<PortfolioImport, Error, { id: EntityId; sheetName: string }> {
  return usePortfolioImportMutation((companyId, { id, sheetName }: { id: EntityId; sheetName: string }) =>
    getPortfolioImportSource().selectSheet(companyId, id, sheetName),
  )
}
