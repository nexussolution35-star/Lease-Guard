import { Injectable } from '@nestjs/common'
import { buildCommunicationActivityReport, buildStatementProcessingReport, type EntityId, type ReportEnvelope } from '@leaseguard/domain'
import type { DbClient } from '@leaseguard/service-kit'

import { saToday } from './as-of'
import { reportFiltersFrom, type ReportQuery } from './report-query'
import { StatementCommunicationReportDataService } from './statement-communication-report-data.service'

/**
 * Puts the statement processing and communication activity reports together: the rows come from the reporting
 * functions (caller's token, RLS), the figures from the domain rules in @leaseguard/domain
 * (rules/statementCommunicationReports.ts). Read-only: nothing is sent, approved or retried from here.
 */
@Injectable()
export class StatementCommunicationReportsService {
  constructor(private readonly data: StatementCommunicationReportDataService) {}

  async statementProcessing(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'statement_processing'>> {
    const filters = reportFiltersFrom('statement_processing', query)
    const asOf = saToday(now)
    const [statements, fields] = await Promise.all([this.data.statementUploads(db, companyId), this.data.reviewFields(db, companyId)])
    return { reportId: 'statement_processing', asOf, filters, data: buildStatementProcessingReport(statements, fields, asOf, filters) }
  }

  async communicationActivity(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'communication_activity'>> {
    const filters = reportFiltersFrom('communication_activity', query)
    const messages = await this.data.communications(db, companyId)
    return { reportId: 'communication_activity', asOf: saToday(now), filters, data: buildCommunicationActivityReport(messages, now, filters) }
  }
}
