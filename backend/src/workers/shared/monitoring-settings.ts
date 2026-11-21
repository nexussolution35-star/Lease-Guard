import type { EntityId, MonitoringEventType } from '@leaseguard/domain'
import { UnrecoverableError } from 'bullmq'

import { buildMonitoringSettings, type MonitoringSettings } from '../../common/monitoring/monitoring-settings'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { unwrap } from './db'

export * from '../../common/monitoring/monitoring-settings'

/**
 * Loads the company's monitoring configuration. Null when the company is no longer active (suspended
 * or archived after the dispatch ran): nothing is monitored. An unknown company fails the job permanently.
 */
export async function loadMonitoringSettings(
  db: DbClient,
  companyId: EntityId,
  onInvalidConfig?: (eventType: MonitoringEventType, reason: string) => void,
): Promise<MonitoringSettings | null> {
  const companyResult = await db
    .from('companies')
    .select('id, status, lease_expiry_notice_days, renewal_deadline_warning_days, guarantee_expiry_notice_days, installment_reminder_lead_days')
    .eq('id', companyId)
    .maybeSingle()
  const company = unwrap(companyResult, 'Load company settings', null)
  if (!company) throw new UnrecoverableError(`Company ${companyId} does not exist`)
  if (company.status !== 'active') return null
  const rulesResult = await db
    .from('monitoring_rules')
    .select('id, event_type, enabled, default_priority, config, default_assignee_user_id')
    .eq('company_id', companyId)
  const rules = unwrap(rulesResult, 'Load monitoring rules', [])
  return buildMonitoringSettings(company, rules, onInvalidConfig)
}
