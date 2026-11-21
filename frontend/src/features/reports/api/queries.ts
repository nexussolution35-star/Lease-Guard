import type { UseQueryResult } from '@tanstack/react-query'
import type { ReportDefinition, ReportEnvelope, ReportFilters } from '@leaseguard/domain'

import { createEntityKeys } from '@/lib/data/queryKeys'
import { useCompanyQuery } from '@/lib/data/queries'

import { getReportsSource } from './selectSource'
import type { AvailableReportId } from './source'

export const reportKeys = createEntityKeys('reports')

export const reportCatalogueKey = (companyId: string) => [...reportKeys.company(companyId), 'catalogue'] as const
export const reportKey = (companyId: string, id: AvailableReportId, filters: ReportFilters) =>
  [...reportKeys.company(companyId), 'report', id, filters] as const

/** The report catalogue of the active workspace. */
export function useReportCatalogue(): UseQueryResult<ReportDefinition[]> {
  return useCompanyQuery(reportCatalogueKey, (companyId) => getReportsSource().catalogue(companyId))
}

/**
 * One report of the active workspace with the filters from the URL. Changing a filter keeps the previous figures on
 * screen while the next ones load (never another company's). Read afresh once stale (30 s); nothing invalidates it.
 */
export function useReport<Id extends AvailableReportId>(id: Id, filters: ReportFilters): UseQueryResult<ReportEnvelope<Id>> {
  return useCompanyQuery(
    (companyId) => reportKey(companyId, id, filters),
    (companyId) => getReportsSource().report(companyId, id, filters),
    { keepPrevious: true },
  )
}
