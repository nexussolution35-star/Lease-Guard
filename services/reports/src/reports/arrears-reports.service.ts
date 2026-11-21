import { Injectable } from '@nestjs/common'
import { buildArrearsReport, buildPaymentArrangementsReport, type EntityId, type ReportEnvelope } from '@leaseguard/domain'
import type { DbClient } from '@leaseguard/service-kit'

import { ArrearsReportDataService } from './arrears-report-data.service'
import { saToday } from './as-of'
import { reportFiltersFrom, type ReportQuery } from './report-query'

/**
 * Puts the arrears and payment arrangements reports together: the rows come from the reporting functions (caller's
 * token, RLS), the figures from the domain rules in @leaseguard/domain (rules/arrearsReports.ts), with the company's
 * ageing buckets and instalment grace days. Monitoring summaries: nothing here takes or records a payment.
 */
@Injectable()
export class ArrearsReportsService {
  constructor(private readonly data: ArrearsReportDataService) {}

  async arrears(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'arrears'>> {
    const filters = reportFiltersFrom('arrears', query)
    const asOf = saToday(now)
    const [accounts, arrangements, settings] = await Promise.all([
      this.data.arrearsDetail(db, companyId),
      this.data.arrangements(db, companyId),
      this.data.settings(db, companyId),
    ])
    return { reportId: 'arrears', asOf, filters, data: buildArrearsReport({ accounts, arrangements, asOf, buckets: settings.ageingBuckets, filters }) }
  }

  async paymentArrangements(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'payment_arrangements'>> {
    const filters = reportFiltersFrom('payment_arrangements', query)
    const asOf = saToday(now)
    const [arrangements, settings] = await Promise.all([this.data.arrangements(db, companyId), this.data.settings(db, companyId)])
    return {
      reportId: 'payment_arrangements',
      asOf,
      filters,
      data: buildPaymentArrangementsReport({ arrangements, asOf, graceDays: settings.graceDays, filters }),
    }
  }
}
