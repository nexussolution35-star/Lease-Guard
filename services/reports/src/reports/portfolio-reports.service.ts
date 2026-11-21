import { Injectable } from '@nestjs/common'
import { buildOccupancyReport, buildPortfolioOverview, type EntityId, type ReportEnvelope } from '@leaseguard/domain'
import type { DbClient } from '@leaseguard/service-kit'

import { saToday } from './as-of'
import { ReportDataService } from './report-data.service'
import { reportFiltersFrom, type ReportQuery } from './report-query'

/**
 * Puts the portfolio overview and occupancy reports together: the rows come from the reporting functions (caller's
 * token, RLS), the figures from the domain rules in @leaseguard/domain (rules/portfolioReports.ts).
 */
@Injectable()
export class PortfolioReportsService {
  constructor(private readonly data: ReportDataService) {}

  async portfolioOverview(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'portfolio_overview'>> {
    const filters = reportFiltersFrom('portfolio_overview', query)
    const [properties, accounts] = await Promise.all([this.data.propertyFigures(db, companyId), this.data.arrearsAccounts(db, companyId)])
    return { reportId: 'portfolio_overview', asOf: saToday(now), filters, data: buildPortfolioOverview(properties, accounts, filters) }
  }

  async occupancy(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'occupancy'>> {
    const filters = reportFiltersFrom('occupancy', query)
    const units = await this.data.unitOccupancy(db, companyId)
    return { reportId: 'occupancy', asOf: saToday(now), filters, data: buildOccupancyReport(units, filters) }
  }
}
