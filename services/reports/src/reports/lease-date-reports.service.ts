import { Injectable } from '@nestjs/common'
import { buildLeaseExpiryReport, buildRenewalDeadlinesReport, type EntityId, type ReportEnvelope } from '@leaseguard/domain'
import type { DbClient } from '@leaseguard/service-kit'

import { saToday } from './as-of'
import { LeaseDateReportDataService } from './lease-date-report-data.service'
import { reportFiltersFrom, type ReportQuery } from './report-query'

/**
 * Puts the lease expiry and renewal deadline reports together (ticket R-03): the leases and the company's monitoring
 * thresholds come from the reporting functions (caller's token, RLS), the figures from the domain rules in
 * @leaseguard/domain (rules/leaseDateReports.ts), the rules lease monitoring uses, on the South African "today".
 */
@Injectable()
export class LeaseDateReportsService {
  constructor(private readonly data: LeaseDateReportDataService) {}

  async leaseExpiry(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'lease_expiry'>> {
    const filters = reportFiltersFrom('lease_expiry', query)
    const asOf = saToday(now)
    const [leases, settings] = await Promise.all([this.data.leaseDates(db, companyId), this.data.settings(db, companyId)])
    return { reportId: 'lease_expiry', asOf, filters, data: buildLeaseExpiryReport(leases, settings, asOf, filters) }
  }

  async renewalDeadlines(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'renewal_deadlines'>> {
    const filters = reportFiltersFrom('renewal_deadlines', query)
    const asOf = saToday(now)
    const [leases, settings] = await Promise.all([this.data.leaseDates(db, companyId), this.data.settings(db, companyId)])
    return { reportId: 'renewal_deadlines', asOf, filters, data: buildRenewalDeadlinesReport(leases, settings, asOf, filters) }
  }
}
