import { Injectable } from '@nestjs/common'
import { buildLeaseMonitoringReport, buildRentalDiscrepancyReport, type EntityId, type ReportEnvelope } from '@leaseguard/domain'
import type { DbClient } from '@leaseguard/service-kit'

import { saToday } from './as-of'
import { MonitoringReportDataService } from './monitoring-report-data.service'
import { reportFiltersFrom, type ReportQuery } from './report-query'

/**
 * Puts the lease monitoring and rental discrepancy reports together (ticket R-02): the rows come from the reporting
 * functions (caller's token, RLS), the figures from the domain rules in @leaseguard/domain (rules/monitoringReports.ts),
 * the rules monitoring itself uses.
 */
@Injectable()
export class MonitoringReportsService {
  constructor(private readonly data: MonitoringReportDataService) {}

  async leaseMonitoring(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'lease_monitoring'>> {
    const filters = reportFiltersFrom('lease_monitoring', query)
    const asOf = saToday(now)
    const events = await this.data.monitoringEvents(db, companyId)
    return { reportId: 'lease_monitoring', asOf, filters, data: buildLeaseMonitoringReport(events, asOf, filters) }
  }

  async rentalDiscrepancies(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'rental_discrepancies'>> {
    const filters = reportFiltersFrom('rental_discrepancies', query)
    const [leases, events, tolerance] = await Promise.all([
      this.data.rentalComparisons(db, companyId),
      this.data.monitoringEvents(db, companyId),
      this.data.discrepancyTolerance(db, companyId),
    ])
    return { reportId: 'rental_discrepancies', asOf: saToday(now), filters, data: buildRentalDiscrepancyReport({ leases, events, tolerance }, filters) }
  }
}
