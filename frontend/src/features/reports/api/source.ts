import type { EntityId, ReportDefinition, ReportEnvelope, ReportFilters, ReportId } from '@leaseguard/domain'

/**
 * The reports the reports service serves (`GET /api/v1/reports/{reportId}`), in catalogue order. Each ticket that
 * builds a report adds its id here and its request in `apiSource.ts`; the Reports page opens the others as "not
 * available yet".
 */
export const AVAILABLE_REPORT_IDS = ['portfolio_overview', 'occupancy', 'lease_monitoring', 'rental_discrepancies', 'lease_expiry', 'renewal_deadlines', 'deposits_guarantees', 'arrears', 'payment_arrangements', 'statement_processing', 'communication_activity', 'owner_weekly_summary'] as const satisfies readonly ReportId[]
export type AvailableReportId = (typeof AVAILABLE_REPORT_IDS)[number]

export function isAvailableReportId(id: ReportId): id is AvailableReportId {
  return (AVAILABLE_REPORT_IDS as readonly string[]).includes(id)
}

/**
 * Where the reports come from: the reports service through the gateway (ADR 0003). Every figure is computed there
 * from the company's verified records; the web app only shows it.
 */
export interface ReportsSource {
  /** The report catalogue (`GET /api/v1/reports`). */
  catalogue(companyId: EntityId): Promise<ReportDefinition[]>
  /** One report with the filters applied, the filters stated back and its "as at" date. */
  report<Id extends AvailableReportId>(companyId: EntityId, id: Id, filters: ReportFilters): Promise<ReportEnvelope<Id>>
}
