import { Injectable } from '@nestjs/common'
import {
  buildOwnerWeeklySummary,
  guaranteeNoticeDaysFor,
  inReportProperties,
  messageTypeTemplateState,
  nextOwnerSummaryDate,
  ownerSummaryCompanyBlockers,
  ownerSummaryMessage,
  ownerSummaryRecipientBlockers,
  ownerSummaryTemplateProblems,
  ownerSummaryTemplateValues,
  ownerSummaryWeekStart,
  type EntityId,
  type ISODate,
  type MessageTypeTemplateMapping,
  type OwnerSummarySources,
  type OwnerWeeklySummary,
  type OwnerWeeklySummaryPreview,
  type ReportEnvelope,
  type Weekday,
} from '@leaseguard/domain'
import type { DbClient } from '@leaseguard/service-kit'

import { ArrearsReportDataService } from './arrears-report-data.service'
import { saToday } from './as-of'
import { MonitoringReportDataService } from './monitoring-report-data.service'
import { OwnerSummaryDataService, type StoredOwnerSummary, type SummaryOwner } from './owner-summary-data.service'
import { reportFiltersFrom, type ReportQuery } from './report-query'
import { SecurityReportDataService } from './security-report-data.service'

/** One owner's summary as computed now, with the WhatsApp values and every reason it would not be sent. */
export interface ComputedOwnerSummary {
  owner: SummaryOwner
  summary: OwnerWeeklySummary
  values: string[]
  message?: string
  /** The company's blockers, then the owner's own. Empty: the summary can be sent. */
  blockers: string[]
}

/** Every owner's summary of a company for the week `asOf` falls in. */
export interface CompanyOwnerSummaries {
  asOf: ISODate
  weekStart: ISODate
  weekday: Weekday
  mapping?: MessageTypeTemplateMapping
  companyBlockers: string[]
  owners: ComputedOwnerSummary[]
  stored: StoredOwnerSummary[]
}

/**
 * The weekly owner summary (ticket R-07): every property owner's summary computed from the company's verified records
 * with the domain rules (rules/ownerWeeklySummary.ts, built on the same report rules as the Reports page), compared
 * with the owner's previous stored summary, with the WhatsApp text of the template chosen for owner_weekly_summary and
 * the reasons it would not be sent. The Reports page previews it with the caller's token; the reports worker computes
 * the same with its service-role client, stores it and hands it to the core messaging pipeline.
 */
@Injectable()
export class OwnerSummaryService {
  constructor(
    private readonly owners: OwnerSummaryDataService,
    private readonly arrears: ArrearsReportDataService,
    private readonly monitoring: MonitoringReportDataService,
    private readonly security: SecurityReportDataService,
  ) {}

  async compute(db: DbClient, companyId: EntityId, asOf: ISODate): Promise<CompanyOwnerSummaries> {
    const weekStart = ownerSummaryWeekStart(asOf)
    const [owners, channel, stored, sources] = await Promise.all([
      this.owners.owners(db, companyId),
      this.owners.channel(db, companyId),
      this.owners.stored(db, companyId, weekStart),
      this.sources(db, companyId),
    ])
    const companyBlockers = ownerSummaryCompanyBlockers({ ...(channel.mapping ? { mapping: channel.mapping } : {}), whatsappConnected: channel.whatsappConnected })
    const canFill = channel.mapping !== undefined && ownerSummaryTemplateProblems(channel.mapping.body).length === 0
    const storedByOwner = new Map(stored.map((row) => [row.ownerUserId, row]))

    const computed = owners
      .filter((owner) => owner.properties.length > 0)
      .map((owner): ComputedOwnerSummary => {
        const summary = buildOwnerWeeklySummary({
          owner: { userId: owner.userId, name: owner.name },
          properties: owner.properties,
          asOf,
          previous: storedByOwner.get(owner.userId)?.previous ?? null,
          sources,
        })
        const values = ownerSummaryTemplateValues(summary)
        return {
          owner,
          summary,
          values,
          ...(canFill && channel.mapping ? { message: ownerSummaryMessage(channel.mapping.body, values) } : {}),
          blockers: [...companyBlockers, ...ownerSummaryRecipientBlockers(companyId, owner, values)],
        }
      })

    return {
      asOf,
      weekStart,
      weekday: channel.weekday,
      ...(channel.mapping ? { mapping: channel.mapping } : {}),
      companyBlockers,
      owners: computed,
      stored,
    }
  }

  /** The Reports page: this week's summary of each owner (of the filtered properties) and what became of it. */
  async report(db: DbClient, companyId: EntityId, query: ReportQuery, now = new Date()): Promise<ReportEnvelope<'owner_weekly_summary'>> {
    const filters = reportFiltersFrom('owner_weekly_summary', query)
    const asOf = saToday(now)
    const company = await this.compute(db, companyId, asOf)
    const storedByOwner = new Map(company.stored.map((row) => [row.ownerUserId, row]))
    const owners = company.owners
      .filter((owner) => owner.owner.properties.some((property) => inReportProperties(filters, property.propertyId)))
      .map((owner): OwnerWeeklySummaryPreview => {
        const current = storedByOwner.get(owner.owner.userId)?.current
        return {
          summary: owner.summary,
          values: owner.values,
          ...(owner.message ? { message: owner.message } : {}),
          blockers: owner.blockers,
          ...(current ? { delivery: current } : {}),
        }
      })
    const state = messageTypeTemplateState(company.mapping)
    return {
      reportId: 'owner_weekly_summary',
      asOf,
      filters,
      data: {
        weekStart: company.weekStart,
        sendWeekday: company.weekday,
        nextSendOn: nextOwnerSummaryDate(asOf, company.weekday),
        blockers: company.companyBlockers,
        ...(company.mapping
          ? { template: { metaTemplateName: company.mapping.metaTemplateName, language: company.mapping.language, sendable: state.sendable, summary: state.summary } }
          : {}),
        owners,
      },
    }
  }

  /** The company records every owner's summary is computed from (each read once for all owners). */
  private async sources(db: DbClient, companyId: EntityId): Promise<OwnerSummarySources> {
    const [accounts, arrangements, settings, events, rentalComparisons, tolerance, security, notice] = await Promise.all([
      this.arrears.arrearsDetail(db, companyId),
      this.arrears.arrangements(db, companyId),
      this.arrears.settings(db, companyId),
      this.monitoring.monitoringEvents(db, companyId),
      this.monitoring.rentalComparisons(db, companyId),
      this.monitoring.discrepancyTolerance(db, companyId),
      this.security.leaseSecurity(db, companyId),
      this.security.guaranteeNoticeSettings(db, companyId),
    ])
    return {
      accounts,
      arrangements,
      ageingBuckets: settings.ageingBuckets,
      graceDays: settings.graceDays,
      events,
      rentalComparisons,
      tolerance,
      security,
      guaranteeNoticeDays: guaranteeNoticeDaysFor(notice.companyNoticeDays, notice.ruleNoticeDays),
    }
  }
}
