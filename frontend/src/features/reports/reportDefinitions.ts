import { findReportDefinition, isReportId, REPORT_CATALOGUE, type ReportDefinition, type ReportId } from '@leaseguard/domain'

/** The reports LeaseGuard offers: the shared catalogue in @leaseguard/domain, also served by GET /api/v1/reports. */
export const REPORT_DEFINITIONS: readonly ReportDefinition[] = REPORT_CATALOGUE

export function getReportDefinition(id: ReportId): ReportDefinition {
  const def = REPORT_DEFINITIONS.find((d) => d.id === id)
  if (!def) throw new Error(`Unknown report ${id}`)
  return def
}

export { findReportDefinition, isReportId }
