import { Injectable } from '@nestjs/common'
import {
  arrearsOverview,
  DEFAULT_AGEING_BUCKETS,
  type ArrearsOverviewArrangement,
  type ArrearsOverviewStatement,
  type EntityId,
  type StatementArrearsEntry,
  type StatementArrearsSummary,
} from '@leaseguard/domain'

import { httpErrorFromDatabase } from '../../common/http/database-errors'
import { fetchAllRows } from '../../common/http/fetch-all'
import { saToday } from '../../common/sa-today'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { buildMonitoringSettings } from '../../common/monitoring/monitoring-settings'

/** Verified statements with the names the summary shows (to-one embeds over the composite foreign keys). */
const VERIFIED_SELECT =
  'id, tenant_id, property_id, unit_id, lease_id, status, statement_date, closing_balance, total_due, verified_by_user_id, verified_at, ' +
  'property:properties!statements_property_fk(name), tenant:tenants!statements_tenant_fk(trading_name), unit:units!statements_unit_fk(unit_number)'

const COMPANY_SETTINGS_SELECT =
  'id, status, lease_expiry_notice_days, renewal_deadline_warning_days, guarantee_expiry_notice_days, installment_reminder_lead_days'

interface VerifiedRow {
  id: string
  tenant_id: string | null
  property_id: string
  unit_id: string | null
  lease_id: string | null
  status: ArrearsOverviewStatement['status']
  statement_date: string | null
  closing_balance: number | null
  total_due: number | null
  verified_by_user_id: string | null
  verified_at: string | null
  property: { name: string } | null
  tenant: { trading_name: string } | null
  unit: { unit_number: string } | null
}

/**
 * What a company's verified statements say it is owed, calculated by the domain `arrearsOverview` (each tenant's
 * latest verified statement, aged into the company's arrears monitoring buckets, active payment arrangements marked)
 * plus the number of statements still waiting for review. Every read runs through the caller's RLS-bound client and
 * filters by company. A monitoring record, never a transaction.
 */
@Injectable()
export class StatementArrearsService {
  async summary(db: DbClient, companyId: EntityId, now: Date = new Date()): Promise<StatementArrearsSummary> {
    const asOf = saToday(now)
    const [rows, arrangements, buckets, pendingReview] = await Promise.all([
      fetchAllRows<VerifiedRow>('Load verified statements', (from, to) =>
        db
          .from('statements')
          .select(VERIFIED_SELECT)
          .eq('company_id', companyId)
          .eq('status', 'verified')
          .not('tenant_id', 'is', null)
          .order('id')
          .range(from, to)
          .overrideTypes<VerifiedRow[], { merge: false }>(),
      ),
      this.activeArrangements(db, companyId),
      this.ageingBuckets(db, companyId),
      this.pendingReview(db, companyId),
    ])

    const statements: ArrearsOverviewStatement[] = rows.map((row) => ({
      id: row.id,
      propertyId: row.property_id,
      ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
      ...(row.lease_id ? { leaseId: row.lease_id } : {}),
      status: row.status,
      ...(row.statement_date !== null ? { statementDate: row.statement_date } : {}),
      ...(row.closing_balance !== null ? { closingBalance: row.closing_balance } : {}),
      ...(row.total_due !== null ? { totalDue: row.total_due } : {}),
    }))
    const { entries, ...overview } = arrearsOverview({ statements, arrangements, asOf, buckets })

    const byId = new Map(rows.map((row) => [row.id, row]))
    return {
      ...overview,
      pendingReview,
      entries: entries.map((entry): StatementArrearsEntry => {
        const row = byId.get(entry.statementId)
        return {
          ...entry,
          tenantName: row?.tenant?.trading_name ?? '',
          propertyName: row?.property?.name ?? '',
          ...(row?.unit_id ? { unitId: row.unit_id } : {}),
          ...(row?.unit ? { unitNumber: row.unit.unit_number } : {}),
          ...(row?.verified_by_user_id ? { verifiedByUserId: row.verified_by_user_id } : {}),
          ...(row?.verified_at ? { verifiedAt: row.verified_at } : {}),
        }
      }),
    }
  }

  private async activeArrangements(db: DbClient, companyId: EntityId): Promise<ArrearsOverviewArrangement[]> {
    const rows = await fetchAllRows('Load payment arrangements', (from, to) =>
      db
        .from('payment_arrangements')
        .select('id, tenant_id, status, agreed_on, closed_on, suppress_arrears_reminders')
        .eq('company_id', companyId)
        .eq('status', 'active')
        .order('id')
        .range(from, to),
    )
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      status: row.status,
      agreedOn: row.agreed_on,
      ...(row.closed_on ? { closedOn: row.closed_on } : {}),
      suppressArrearsReminders: row.suppress_arrears_reminders,
    }))
  }

  /** The company's arrears monitoring buckets (the same configuration the daily arrears monitoring ages with). */
  private async ageingBuckets(db: DbClient, companyId: EntityId): Promise<readonly number[]> {
    const [company, rules] = await Promise.all([
      db.from('companies').select(COMPANY_SETTINGS_SELECT).eq('id', companyId).maybeSingle(),
      db
        .from('monitoring_rules')
        .select('id, event_type, enabled, default_priority, config, default_assignee_user_id')
        .eq('company_id', companyId)
        .eq('event_type', 'arrears'),
    ])
    if (company.error) throw httpErrorFromDatabase(company.error, 'Load company settings')
    if (rules.error) throw httpErrorFromDatabase(rules.error, 'Load arrears monitoring rule')
    if (!company.data) return DEFAULT_AGEING_BUCKETS
    const settings = buildMonitoringSettings(company.data, rules.data ?? [])
    return settings.rule('arrears').config?.ageingBucketsDays ?? DEFAULT_AGEING_BUCKETS
  }

  private async pendingReview(db: DbClient, companyId: EntityId): Promise<number> {
    const { count, error } = await db
      .from('statements')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('status', 'review_required')
    if (error) throw httpErrorFromDatabase(error, 'Count statements waiting for review')
    return count ?? 0
  }
}
