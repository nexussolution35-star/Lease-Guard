import { appliedReportFilters, isValidISODate, REPORT_FILTER_SUPPORT, type ReportFilters, type ReportId } from '@leaseguard/domain'
import { z } from 'zod'

import { isUuid } from '@/lib/data/ids'

/** A list in the URL; one value is read as a list of one. Invalid entries are dropped, never fail the route. */
const list = (item: (value: string) => boolean) =>
  z
    .union([z.string(), z.array(z.unknown())])
    .optional()
    .transform((value) => {
      const values = value === undefined ? [] : Array.isArray(value) ? value : [value]
      const kept = [...new Set(values.filter((entry): entry is string => typeof entry === 'string' && item(entry)))]
      return kept.length > 0 ? kept : undefined
    })
    .catch(undefined)

const isoDate = z.string().refine(isValidISODate).optional().catch(undefined)

/**
 * `/reports/$reportId` search params: the report frame's filters live in the URL (shareable, kept on reload and the
 * back button). Property ids, an inclusive date range and statuses; values that cannot be valid fall back to "no
 * filter" instead of failing the route.
 */
export const reportSearchSchema = z.object({
  propertyId: list(isUuid),
  from: isoDate,
  to: isoDate,
  status: list((value) => /^[a-z_]{1,64}$/.test(value)),
})

/** The report frame's URL state (what `reportSearchSchema` produces); every filter is optional. */
export interface ReportSearch {
  propertyId?: string[] | undefined
  from?: string | undefined
  to?: string | undefined
  status?: string[] | undefined
}

/**
 * The filters the report applies for the URL state: only the filters the report offers (REPORT_FILTER_SUPPORT), only
 * statuses it offers, and a date range only when it does not end before it starts.
 */
export function reportFiltersFromSearch(id: ReportId, search: ReportSearch): ReportFilters {
  const support = REPORT_FILTER_SUPPORT[id]
  const offered = support.statuses?.values ?? []
  const statuses = search.status?.filter((status) => offered.includes(status))
  const rangeOk = !(search.from && search.to && search.from > search.to)
  return appliedReportFilters(id, {
    ...(search.propertyId ? { propertyIds: search.propertyId } : {}),
    ...(rangeOk && search.from ? { from: search.from } : {}),
    ...(rangeOk && search.to ? { to: search.to } : {}),
    ...(statuses && statuses.length > 0 ? { statuses } : {}),
  })
}

/** Whether any filter the report offers is set in the URL. */
export function hasReportFilters(id: ReportId, search: ReportSearch): boolean {
  return Object.keys(reportFiltersFromSearch(id, search)).length > 0
}
