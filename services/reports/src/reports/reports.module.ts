import { Module } from '@nestjs/common'

import { PortfolioReportsController } from './portfolio-reports.controller'
import { PortfolioReportsService } from './portfolio-reports.service'
import { ReportDataService } from './report-data.service'

/** The report endpoints, `GET /api/v1/reports/{reportId}`: one controller per group of reports. */
@Module({
  controllers: [PortfolioReportsController],
  providers: [ReportDataService, PortfolioReportsService],
  exports: [ReportDataService],
})
export class ReportsModule {}
