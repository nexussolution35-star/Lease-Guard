import { OWNER_SUMMARY_STATUSES, WEEKDAYS, type EntityId, type ISODate, type Weekday } from '@leaseguard/domain'
import type { DbClient } from '@leaseguard/service-kit'
import { z } from 'zod'

import type { OwnerSummaryRecord, OwnerSummaryStore } from './owner-summary-run'

/** A database call of the reports worker failed. Retryable: the job is retried with backoff. */
export class ReportsWorkerDatabaseError extends Error {
  constructor(operation: string, error: { code?: string; message: string }) {
    super(`${operation} failed (${error.code ?? 'unknown'}): ${error.message}`)
    this.name = 'ReportsWorkerDatabaseError'
  }
}

const companyRow = z.object({ company_id: z.string(), owner_summary_weekday: z.enum(WEEKDAYS) })
const storedRow = z.object({ id: z.string(), status: z.enum(OWNER_SUMMARY_STATUSES) })

function check<T>(result: { data: unknown; error: { code?: string; message: string } | null }, operation: string, schema: z.ZodType<T>): T {
  if (result.error) throw new ReportsWorkerDatabaseError(operation, result.error)
  const parsed = schema.safeParse(result.data)
  if (!parsed.success) throw new ReportsWorkerDatabaseError(operation, { message: `unexpected shape: ${parsed.error.message}` })
  return parsed.data
}

/**
 * reports_owner_summaries through the reports worker's service-role client. The reports service writes only its own
 * reports_* tables; every query names the company (the service role bypasses Row Level Security).
 */
export class SupabaseOwnerSummaryStore implements OwnerSummaryStore {
  constructor(private readonly db: () => DbClient) {}

  async companies(): Promise<{ companyId: EntityId; weekday: Weekday }[]> {
    const rows = check(await this.db().rpc('reports_owner_summary_companies'), 'List the companies', z.array(companyRow))
    return rows.map((row) => ({ companyId: row.company_id, weekday: row.owner_summary_weekday }))
  }

  async find(companyId: EntityId, ownerUserId: EntityId, weekStart: ISODate) {
    const row = check(
      await this.db()
        .from('reports_owner_summaries')
        .select('id, status')
        .eq('company_id', companyId)
        .eq('owner_user_id', ownerUserId)
        .eq('week_start', weekStart)
        .maybeSingle(),
      'Find the stored owner summary',
      storedRow.nullable(),
    )
    return row ? { summaryId: row.id, status: row.status } : null
  }

  async save(record: OwnerSummaryRecord): Promise<EntityId> {
    const row = check(
      await this.db()
        .from('reports_owner_summaries')
        .upsert(
          {
            company_id: record.companyId,
            owner_user_id: record.ownerUserId,
            week_start: record.weekStart,
            as_of: record.asOf,
            total_outstanding: record.summary.totalOutstanding,
            summary: record.summary,
            template_values: record.values,
            status: record.status,
            blockers: record.blockers,
            computed_at: new Date().toISOString(),
          },
          { onConflict: 'company_id,owner_user_id,week_start' },
        )
        .select('id, status')
        .single(),
      'Store the owner summary',
      storedRow,
    )
    return row.id
  }

  async markHandedOver(companyId: EntityId, summaryId: EntityId): Promise<void> {
    const result = await this.db()
      .from('reports_owner_summaries')
      .update({ status: 'handed_over', handed_over_at: new Date().toISOString(), blockers: [] })
      .eq('company_id', companyId)
      .eq('id', summaryId)
      .neq('status', 'handed_over')
    if (result.error) throw new ReportsWorkerDatabaseError('Mark the owner summary handed over', result.error)
  }
}
