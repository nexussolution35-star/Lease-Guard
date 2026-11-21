import type { ComponentType } from 'react'

import type { AvailableReportId } from '../api/source'
import { DepositsGuaranteesReportView } from './DepositsGuaranteesReportView'
import { ArrearsReportView } from './ArrearsReportView'
import { LeaseExpiryReportView } from './LeaseExpiryReportView'
import { LeaseMonitoringReportView } from './LeaseMonitoringReportView'
import { OccupancyReportView } from './OccupancyReportView'
import { PaymentArrangementsReportView } from './PaymentArrangementsReportView'
import { PortfolioOverviewReportView } from './PortfolioOverviewReportView'
import { RentalDiscrepanciesReportView } from './RentalDiscrepanciesReportView'
import { RenewalDeadlinesReportView } from './RenewalDeadlinesReportView'
import { CommunicationActivityReportView } from './CommunicationActivityReportView'
import { StatementProcessingReportView } from './StatementProcessingReportView'
import { OwnerWeeklySummaryReportView } from './OwnerWeeklySummaryReportView'
import type { ReportViewProps } from './reportViewProps'

/** The view of each report the reports service serves; each ticket that builds a report adds its view here. */
export const REPORT_VIEWS: { readonly [Id in AvailableReportId]: ComponentType<ReportViewProps> } = {
  portfolio_overview: PortfolioOverviewReportView,
  occupancy: OccupancyReportView,
  lease_monitoring: LeaseMonitoringReportView,
  rental_discrepancies: RentalDiscrepanciesReportView,
  lease_expiry: LeaseExpiryReportView,
  renewal_deadlines: RenewalDeadlinesReportView,
  arrears: ArrearsReportView,
  payment_arrangements: PaymentArrangementsReportView,
  deposits_guarantees: DepositsGuaranteesReportView,
  statement_processing: StatementProcessingReportView,
  communication_activity: CommunicationActivityReportView,
  owner_weekly_summary: OwnerWeeklySummaryReportView,
}
