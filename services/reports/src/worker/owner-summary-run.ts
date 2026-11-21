import {
  isOwnerSummaryDay,
  ownerSummaryWeekStart,
  type EntityId,
  type ISODate,
  type OwnerSummaryDeliveryJob,
  type OwnerSummaryStatus,
  type OwnerWeeklySummary,
  type Weekday,
} from '@leaseguard/domain'

import type { CompanyOwnerSummaries } from '../reports/owner-summary.service'

/** The reports worker's queues (its own; the core's `owner-summary-delivery` is the only other one it touches). */
export const OWNER_SUMMARY_DISPATCH_QUEUE = 'reports-owner-summary-dispatch'
export const OWNER_SUMMARY_COMPANY_QUEUE = 'reports-owner-summary'

/**
 * Every day at 07:00 in South Africa the dispatch looks for the companies whose owner summary day (Settings →
 * Monitoring, Monday unless changed) is today, and queues one job per company. Idempotent across replicas.
 */
export const OWNER_SUMMARY_DISPATCH_SCHEDULE = { schedulerId: 'weekly-owner-summary-dispatch', pattern: '0 7 * * *', tz: 'Africa/Johannesburg' } as const

/** A company's job: compute, store and hand over every owner's summary for the week `asOf` falls in. */
export interface CompanyOwnerSummaryJob {
  companyId: EntityId
  asOf: ISODate
}

/** One job per company and week (the core's job id convention), so a second run of the dispatch adds nothing. */
export function companyOwnerSummaryJobId(job: CompanyOwnerSummaryJob): string {
  return [OWNER_SUMMARY_COMPANY_QUEUE, ...[job.companyId, ownerSummaryWeekStart(job.asOf)].map((value) => encodeURIComponent(value.toLowerCase()))].join('.')
}

/** A summary to store for one owner and week. */
export interface OwnerSummaryRecord {
  companyId: EntityId
  ownerUserId: EntityId
  weekStart: ISODate
  asOf: ISODate
  summary: OwnerWeeklySummary
  values: string[]
  status: 'ready' | 'blocked'
  blockers: string[]
}

/** Where the reports worker keeps its summaries (reports_owner_summaries) and finds the companies. */
export interface OwnerSummaryStore {
  /** The active companies and their owner summary day. */
  companies(): Promise<{ companyId: EntityId; weekday: Weekday }[]>
  /** The owner's stored summary of the week, if any. */
  find(companyId: EntityId, ownerUserId: EntityId, weekStart: ISODate): Promise<{ summaryId: EntityId; status: OwnerSummaryStatus } | null>
  /** Stores the week's summary (replacing a blocked one) and returns its id. */
  save(record: OwnerSummaryRecord): Promise<EntityId>
  markHandedOver(companyId: EntityId, summaryId: EntityId): Promise<void>
}

/** The core messaging pipeline, reached by queue only. */
export interface DeliveryRequests {
  request(job: OwnerSummaryDeliveryJob): Promise<void>
}

export interface DispatchResult {
  asOf: ISODate
  companies: EntityId[]
}

/** The companies whose owner summary day is `asOf`, each queued once for the week. */
export async function dispatchOwnerSummaries(
  deps: { store: OwnerSummaryStore; enqueue: (jobs: CompanyOwnerSummaryJob[]) => Promise<void> },
  asOf: ISODate,
): Promise<DispatchResult> {
  const due = (await deps.store.companies()).filter((company) => isOwnerSummaryDay(asOf, company.weekday)).map((company) => company.companyId)
  await deps.enqueue(due.map((companyId) => ({ companyId, asOf })))
  return { asOf, companies: due }
}

export interface CompanyRunResult {
  companyId: EntityId
  weekStart: ISODate
  handedOver: number
  blocked: number
  /** Handed over by an earlier run of the week: never sent twice. */
  alreadyHandedOver: number
}

/**
 * One company's week: every owner's summary computed from verified records, stored (so next week's change is exact)
 * and, when nothing blocks it, handed to the core messaging pipeline. A summary already handed over is final; one
 * stored as ready but not handed over (a run stopped in between) is handed over as stored; a blocked one is computed
 * again, so a template approved or a number connected later in the week lets a manual run send it.
 */
export async function runCompanyOwnerSummaries(
  deps: { compute: (companyId: EntityId, asOf: ISODate) => Promise<CompanyOwnerSummaries>; store: OwnerSummaryStore; delivery: DeliveryRequests },
  { companyId, asOf }: CompanyOwnerSummaryJob,
): Promise<CompanyRunResult> {
  const company = await deps.compute(companyId, asOf)
  const result: CompanyRunResult = { companyId, weekStart: company.weekStart, handedOver: 0, blocked: 0, alreadyHandedOver: 0 }
  for (const owner of company.owners) {
    const existing = await deps.store.find(companyId, owner.owner.userId, company.weekStart)
    if (existing?.status === 'handed_over') {
      result.alreadyHandedOver++
      continue
    }
    const summaryId =
      existing?.status === 'ready'
        ? existing.summaryId
        : await deps.store.save({
            companyId,
            ownerUserId: owner.owner.userId,
            weekStart: company.weekStart,
            asOf,
            summary: owner.summary,
            values: owner.values,
            status: owner.blockers.length > 0 ? 'blocked' : 'ready',
            blockers: owner.blockers,
          })
    if (existing?.status !== 'ready' && owner.blockers.length > 0) {
      result.blocked++
      continue
    }
    await deps.delivery.request({ companyId, summaryId })
    await deps.store.markHandedOver(companyId, summaryId)
    result.handedOver++
  }
  return result
}
