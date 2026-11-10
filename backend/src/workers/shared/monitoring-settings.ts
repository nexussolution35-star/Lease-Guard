import type {
  CompanySettings,
  EntityId,
  EventPriority,
  MonitoringEventType,
  MonitoringRuleConfig,
} from '@leaseguard/domain'
import { UnrecoverableError } from 'bullmq'
import { z } from 'zod'

import type { Tables } from '../../infrastructure/database/database.types'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { unwrap } from './db'

const days = z.array(z.number().int().positive())

/** Runtime shape of monitoring_rules.config (camelCase, discriminated by `kind`). */
const ruleConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rental_escalation_discrepancy'), toleranceRands: z.number().nonnegative(), tolerancePercent: z.number().nonnegative() }),
  z.object({ kind: z.literal('lease_expiry'), noticeDays: days }),
  z.object({ kind: z.literal('renewal_notice_deadline'), warningDays: days }),
  z.object({ kind: z.literal('guarantee_expiry'), noticeDays: days }),
  z.object({ kind: z.literal('guarantee_shortfall'), minimumCoverageMonths: z.number().nonnegative(), toleranceRands: z.number().nonnegative() }),
  z.object({ kind: z.literal('deposit_shortfall'), minimumCoverageMonths: z.number().nonnegative() }),
  z.object({ kind: z.literal('arrears'), minimumBalanceRands: z.number().nonnegative(), ageingBucketsDays: days.min(1) }),
  z.object({ kind: z.literal('arrangement_attention'), graceDays: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('statement_review_required'), confidenceThreshold: z.number().min(0).max(1) }),
]) satisfies z.ZodType<MonitoringRuleConfig>

export type RuleConfigOf<T extends MonitoringEventType> = Extract<MonitoringRuleConfig, { kind: T }>

/** How one event type is monitored for a company. Without a monitoring_rules row: enabled, company defaults. */
export interface RuleSettings<T extends MonitoringEventType> {
  enabled: boolean
  ruleId?: EntityId
  defaultPriority?: EventPriority
  defaultAssigneeUserId?: EntityId
  config?: RuleConfigOf<T>
}

export type CompanyMonitoringDefaults = Pick<
  CompanySettings,
  'leaseExpiryNoticeDays' | 'renewalDeadlineWarningDays' | 'guaranteeExpiryNoticeDays' | 'installmentReminderLeadDays'
>

export interface MonitoringSettings {
  company: CompanyMonitoringDefaults
  rule<T extends MonitoringEventType>(type: T): RuleSettings<T>
}

export type CompanySettingsRow = Pick<
  Tables<'companies'>,
  'id' | 'status' | 'lease_expiry_notice_days' | 'renewal_deadline_warning_days' | 'guarantee_expiry_notice_days' | 'installment_reminder_lead_days'
>
export type MonitoringRuleRow = Pick<
  Tables<'monitoring_rules'>,
  'id' | 'event_type' | 'enabled' | 'default_priority' | 'config' | 'default_assignee_user_id'
>

/**
 * Combines the company's settings columns with its monitoring_rules rows. A rule whose config does not
 * parse keeps its enabled flag, priority and assignee but falls back to the company defaults for its
 * parameters (`onInvalidConfig` is told why).
 */
export function buildMonitoringSettings(
  company: CompanySettingsRow,
  rules: readonly MonitoringRuleRow[],
  onInvalidConfig: (eventType: MonitoringEventType, reason: string) => void = () => undefined,
): MonitoringSettings {
  const byType = new Map<MonitoringEventType, RuleSettings<MonitoringEventType>>()
  for (const row of rules) {
    const parsed = ruleConfigSchema.safeParse(row.config)
    let config: MonitoringRuleConfig | undefined
    if (!parsed.success) onInvalidConfig(row.event_type, parsed.error.message)
    else if (parsed.data.kind !== row.event_type) onInvalidConfig(row.event_type, `config kind "${parsed.data.kind}" does not match`)
    else config = parsed.data
    byType.set(row.event_type, {
      enabled: row.enabled,
      ruleId: row.id,
      defaultPriority: row.default_priority,
      ...(row.default_assignee_user_id ? { defaultAssigneeUserId: row.default_assignee_user_id } : {}),
      ...(config ? { config } : {}),
    })
  }
  return {
    company: {
      leaseExpiryNoticeDays: company.lease_expiry_notice_days,
      renewalDeadlineWarningDays: company.renewal_deadline_warning_days,
      guaranteeExpiryNoticeDays: company.guarantee_expiry_notice_days,
      installmentReminderLeadDays: company.installment_reminder_lead_days,
    },
    rule<T extends MonitoringEventType>(type: T): RuleSettings<T> {
      // The map is keyed by event type and each config was checked to have `kind === type`.
      return (byType.get(type) as RuleSettings<T> | undefined) ?? { enabled: true }
    },
  }
}

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
