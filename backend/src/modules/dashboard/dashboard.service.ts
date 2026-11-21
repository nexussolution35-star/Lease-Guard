import { Injectable } from '@nestjs/common'
import {
  DASHBOARD_EVENT_FIGURES,
  OPEN_EVENT_STATUSES,
  type DashboardEventFigure,
  type DashboardSummary,
  type EntityId,
} from '@leaseguard/domain'

import { httpErrorFromDatabase } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { StatementArrearsService } from '../statements/statement-arrears.service'

interface CountResult {
  count: number | null
  error: { code: string; message: string; details?: string | null; hint?: string | null } | null
}

/** Awaits a head-only `count: 'exact'` query and returns its count. */
async function countOf(what: string, request: PromiseLike<CountResult>): Promise<number> {
  const { count, error } = await request
  if (error) throw httpErrorFromDatabase(error, what)
  return count ?? 0
}

const HEAD_COUNT = { count: 'exact', head: true } as const

/**
 * The dashboard figures (PRD §7.1) of one company, in one request. Every read runs through the caller's RLS-bound client
 * and filters by company; the queries run in parallel and the counts are head-only (`count=exact`, no rows), each over
 * an indexed column. The balances and the statements waiting for review are the statements arrears summary's own
 * figures (the latest verified statement per unit, calculated by the domain `arrearsOverview`), so the dashboard and
 * the Statements screen never disagree. A monitoring summary, never a transaction.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly arrears: StatementArrearsService) {}

  async summary(db: DbClient, companyId: EntityId, now: Date = new Date()): Promise<DashboardSummary> {
    const eventFigures = Object.entries(DASHBOARD_EVENT_FIGURES) as [DashboardEventFigure, string][]

    const [arrears, properties, units, occupiedUnits, activeLeases, activeArrangements, pendingApprovals, ...eventCounts] =
      await Promise.all([
        this.arrears.summary(db, companyId, now),
        countOf(
          'Count properties',
          db.from('properties').select('id', HEAD_COUNT).eq('company_id', companyId).neq('status', 'archived'),
        ),
        // Units of the properties counted above: the inner embed drops the units of an archived property.
        countOf(
          'Count units',
          db
            .from('units')
            .select('id, property:properties!units_property_fk!inner(status)', HEAD_COUNT)
            .eq('company_id', companyId)
            .neq('property.status', 'archived'),
        ),
        countOf(
          'Count occupied units',
          db
            .from('units')
            .select('id, property:properties!units_property_fk!inner(status)', HEAD_COUNT)
            .eq('company_id', companyId)
            .eq('occupancy_status', 'occupied')
            .neq('property.status', 'archived'),
        ),
        countOf('Count active leases', db.from('leases').select('id', HEAD_COUNT).eq('company_id', companyId).eq('status', 'active')),
        countOf(
          'Count active payment arrangements',
          db.from('payment_arrangements').select('id', HEAD_COUNT).eq('company_id', companyId).eq('status', 'active'),
        ),
        countOf(
          'Count messages awaiting approval',
          db.from('message_approvals').select('id', HEAD_COUNT).eq('company_id', companyId).eq('decision', 'pending'),
        ),
        ...eventFigures.map(([figure, type]) =>
          countOf(
            `Count open monitoring events (${figure})`,
            db
              .from('monitoring_events')
              .select('id', HEAD_COUNT)
              .eq('company_id', companyId)
              .eq('type', type as (typeof DASHBOARD_EVENT_FIGURES)[DashboardEventFigure])
              .in('status', [...OPEN_EVENT_STATUSES]),
          ),
        ),
      ])

    const events = Object.fromEntries(eventFigures.map(([figure], index) => [figure, eventCounts[index] ?? 0])) as Record<
      DashboardEventFigure,
      number
    >

    return {
      asOf: arrears.asOf,
      properties,
      units,
      occupiedUnits,
      activeLeases,
      totalOutstanding: arrears.totalOutstanding,
      tenantsInArrears: arrears.tenantsInArrears,
      activeArrangements,
      pendingStatementReviews: arrears.pendingReview,
      pendingApprovals,
      ...events,
    }
  }
}
