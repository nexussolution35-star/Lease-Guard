import { Injectable } from '@nestjs/common'
import { buildDepositsGuaranteesReport, guaranteeNoticeDaysFor, type EntityId, type ReportEnvelope } from '@leaseguard/domain'
import type { DbClient } from '@leaseguard/service-kit'

import { saToday } from './as-of'
import { reportFiltersFrom, type ReportQuery } from './report-query'
import { SecurityReportDataService } from './security-report-data.service'

/**
 * Puts the deposits and guarantees report together: the leases come from the reporting functions (caller's token,
 * RLS), the cover, shortfalls and expiry states from the domain rules lease monitoring uses (rules/securityReports.ts),
 * with the company's guarantee expiry notice days. A monitoring report: nothing here claims or calls a guarantee.
 */
@Injectable()
export class SecurityReportsService {
  constructor(private readonly data: SecurityReportDataService) {}

  async depositsGuarantees(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'deposits_guarantees'>> {
    const filters = reportFiltersFrom('deposits_guarantees', query)
    const asOf = saToday(now)
    const [records, notice] = await Promise.all([this.data.leaseSecurity(db, companyId), this.data.guaranteeNoticeSettings(db, companyId)])
    const noticeDays = guaranteeNoticeDaysFor(notice.companyNoticeDays, notice.ruleNoticeDays)
    return { reportId: 'deposits_guarantees', asOf, filters, data: buildDepositsGuaranteesReport(records, asOf, noticeDays, filters) }
  }
}
