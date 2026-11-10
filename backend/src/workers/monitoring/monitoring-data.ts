import type { EntityId } from '@leaseguard/domain'

import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { fetchAll } from '../shared/db'
import type { RaiseResult } from '../shared/monitoring-outputs'
import { recordNames, type RecordNames } from './event-presentation'

/**
 * Tenant names, unit numbers and property managers of ONE company (service role: every query filters
 * company_id explicitly).
 */
export async function loadRecordNames(db: DbClient, companyId: EntityId): Promise<RecordNames> {
  const [tenants, units, properties] = await Promise.all([
    fetchAll('Load tenants', (from, to) =>
      db.from('tenants').select('id, trading_name').eq('company_id', companyId).order('id').range(from, to),
    ),
    fetchAll('Load units', (from, to) =>
      db.from('units').select('id, unit_number').eq('company_id', companyId).order('id').range(from, to),
    ),
    fetchAll('Load properties', (from, to) =>
      db.from('properties').select('id, manager_user_id').eq('company_id', companyId).order('id').range(from, to),
    ),
  ])
  return recordNames(tenants, units, properties)
}

/** Result of one company scan, also logged. */
export interface ScanSummary extends RaiseResult {
  /** Findings evaluated (existing keys are not raised again). */
  findings: number
  skipped?: 'company_inactive'
}
