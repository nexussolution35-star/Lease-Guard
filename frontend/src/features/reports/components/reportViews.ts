import type { ComponentType } from 'react'

import type { AvailableReportId } from '../api/source'
import { OccupancyReportView } from './OccupancyReportView'
import { PortfolioOverviewReportView } from './PortfolioOverviewReportView'
import type { ReportViewProps } from './reportViewProps'

/** The view of each report the reports service serves; each ticket that builds a report adds its view here. */
export const REPORT_VIEWS: { readonly [Id in AvailableReportId]: ComponentType<ReportViewProps> } = {
  portfolio_overview: PortfolioOverviewReportView,
  occupancy: OccupancyReportView,
}
