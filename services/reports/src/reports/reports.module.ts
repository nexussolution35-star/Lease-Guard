import { Module } from '@nestjs/common'

import { ArrearsReportDataService } from './arrears-report-data.service'
import { ArrearsReportsController } from './arrears-reports.controller'
import { ArrearsReportsService } from './arrears-reports.service'
import { LeaseDateReportDataService } from './lease-date-report-data.service'
import { LeaseDateReportsController } from './lease-date-reports.controller'
import { LeaseDateReportsService } from './lease-date-reports.service'
import { MonitoringReportDataService } from './monitoring-report-data.service'
import { MonitoringReportsController } from './monitoring-reports.controller'
import { MonitoringReportsService } from './monitoring-reports.service'
import { OwnerSummaryDataService } from './owner-summary-data.service'
import { OwnerSummaryReportsController } from './owner-summary-reports.controller'
import { OwnerSummaryService } from './owner-summary.service'
import { PortfolioReportsController } from './portfolio-reports.controller'
import { PortfolioReportsService } from './portfolio-reports.service'
import { ReportDataService } from './report-data.service'
import { SecurityReportDataService } from './security-report-data.service'
import { SecurityReportsController } from './security-reports.controller'
import { SecurityReportsService } from './security-reports.service'
import { StatementCommunicationReportDataService } from './statement-communication-report-data.service'
import { StatementCommunicationReportsController } from './statement-communication-reports.controller'
import { StatementCommunicationReportsService } from './statement-communication-reports.service'

/** The report endpoints, `GET /api/v1/reports/{reportId}`: one controller per group of reports. */
@Module({
  controllers: [PortfolioReportsController, MonitoringReportsController, ArrearsReportsController, LeaseDateReportsController, SecurityReportsController, StatementCommunicationReportsController, OwnerSummaryReportsController],
  providers: [ReportDataService, PortfolioReportsService, MonitoringReportDataService, MonitoringReportsService, ArrearsReportDataService, ArrearsReportsService, LeaseDateReportDataService, LeaseDateReportsService, SecurityReportDataService, SecurityReportsService, StatementCommunicationReportDataService, StatementCommunicationReportsService, OwnerSummaryDataService, OwnerSummaryService],
  exports: [ReportDataService, OwnerSummaryService],
})
export class ReportsModule {}
