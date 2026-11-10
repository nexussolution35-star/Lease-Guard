import type { Lease } from '@leaseguard/domain'

import type { Tables } from '../infrastructure/database/database.types'
import type { ServiceRoleClientFactory } from '../infrastructure/database/service-role-client.factory'
import type { DbClient } from '../infrastructure/database/rls-client.factory'
import { callsTo, type FakeResult, type RecordedQuery } from '../common/testing/fake-db.test-helpers'
import type { ProcessorRuntime } from './jobs/processor-runtime'
import { recordNames } from './monitoring/event-presentation'
import type { Clock } from './shared/clock'
import { buildMonitoringSettings, type CompanySettingsRow, type MonitoringRuleRow } from './shared/monitoring-settings'

export const COMPANY = '11111111-1111-4111-8111-111111111111'
export const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222'
export const MANAGER = '33333333-3333-4333-8333-333333333333'
export const PROPERTY = '44444444-4444-4444-8444-444444444444'
export const UNIT = '55555555-5555-4555-8555-555555555555'
export const TENANT = '66666666-6666-4666-8666-666666666666'
export const LEASE = '77777777-7777-4777-8777-777777777777'
export const STATEMENT = '88888888-8888-4888-8888-888888888888'

const TS = '2026-01-01T08:00:00+02:00'

/** A verified R35 000 lease, 8% annual escalation from 1 Jan 2027, expiring 31 Dec 2030. */
export function makeLease(overrides: Partial<Lease> = {}): Lease {
  return {
    id: LEASE,
    companyId: COMPANY,
    createdAt: TS,
    updatedAt: TS,
    reference: 'TST-L001',
    propertyId: PROPERTY,
    unitId: UNIT,
    tenantId: TENANT,
    commencementDate: '2026-01-01',
    expiryDate: '2030-12-31',
    initialMonthlyRental: 35000,
    currentMonthlyRental: 35000,
    paymentDueDay: 1,
    escalation: { type: 'percentage', percentage: 8, frequency: 'annual', firstEscalationDate: '2027-01-01' },
    renewalOption: { exists: false, exercised: false },
    status: 'active',
    verified: true,
    ...overrides,
  }
}

/** A verified, active lease row expiring 31 Jan 2027, without renewal option, deposit or guarantee. */
export const leaseRow: Tables<'leases'> = {
  id: LEASE,
  company_id: COMPANY,
  reference: 'TST-L001',
  property_id: PROPERTY,
  unit_id: UNIT,
  tenant_id: TENANT,
  commencement_date: '2024-02-01',
  expiry_date: '2027-01-31',
  initial_monthly_rental: 25000,
  current_monthly_rental: 27000,
  payment_due_day: 1,
  escalation_type: 'percentage',
  escalation_percentage: 8,
  escalation_fixed_amount: null,
  escalation_cpi_assumed_percentage: null,
  escalation_cpi_margin_percentage: null,
  escalation_frequency: 'annual',
  first_escalation_date: '2025-02-01',
  renewal_option_exists: false,
  renewal_term_months: null,
  renewal_notice_period_months: null,
  renewal_exercised: false,
  renewal_exercised_on: null,
  renewal_notes: null,
  deposit_amount: null,
  deposit_basis_months: null,
  deposit_held_by: null,
  deposit_received_on: null,
  deposit_interest_bearing: null,
  deposit_notes: null,
  status: 'active',
  verified: true,
  verified_by_user_id: MANAGER,
  verified_at: TS,
  previous_lease_id: null,
  notes: null,
  created_at: TS,
  updated_at: TS,
}

export const companySettingsRow: CompanySettingsRow = {
  id: COMPANY,
  status: 'active',
  lease_expiry_notice_days: [180, 90, 30],
  renewal_deadline_warning_days: [90, 60, 30],
  guarantee_expiry_notice_days: [90, 30],
  installment_reminder_lead_days: 3,
}

export function settings(rules: MonitoringRuleRow[] = []): ReturnType<typeof buildMonitoringSettings> {
  return buildMonitoringSettings(companySettingsRow, rules)
}

export function rule(overrides: Partial<MonitoringRuleRow> & Pick<MonitoringRuleRow, 'event_type' | 'config'>): MonitoringRuleRow {
  return {
    id: `rule-${overrides.event_type}`,
    enabled: true,
    default_priority: 'medium',
    default_assignee_user_id: null,
    ...overrides,
  }
}

export const names = recordNames(
  [{ id: TENANT, trading_name: 'Test Trading' }],
  [{ id: UNIT, unit_number: 'Shop 1' }],
  [{ id: PROPERTY, manager_user_id: MANAGER }],
)

/** Processors only call runtime.start in onModuleInit, which unit tests do not run. */
export const unusedRuntime = { start: () => undefined } as unknown as ProcessorRuntime

export function clientsFor(client: DbClient): ServiceRoleClientFactory {
  return { get: () => client } as unknown as ServiceRoleClientFactory
}

export function fixedClock(iso: string): Clock {
  const now = new Date(iso)
  return { now: () => now, today: () => iso.slice(0, 10) } as Clock
}

/** The value passed to `eq(column, value)` in a recorded query, if any. */
export function eqValue(query: RecordedQuery, column: string): unknown {
  return callsTo(query, 'eq').find(([name]) => name === column)?.[1]
}

/** True when the query is a write (insert/upsert/update) rather than a read. */
export function isWrite(query: RecordedQuery): boolean {
  return query.calls.some(([method]) => method === 'upsert' || method === 'insert' || method === 'update')
}

/**
 * Routes fake responses: `respond` first (return undefined to fall through), then writes succeed with no
 * rows, then reads return `reads[table]` (an array; `maybeSingle()` gets its first row or null).
 */
export function router(routes: {
  reads?: Record<string, readonly unknown[]>
  respond?: (query: RecordedQuery) => FakeResult | undefined
}): (query: RecordedQuery) => FakeResult {
  return (query) => {
    const custom = routes.respond?.(query)
    if (custom) return custom
    if (isWrite(query)) return { data: [], error: null }
    const rows = routes.reads?.[query.table] ?? []
    const single = query.calls.some(([method]) => method === 'maybeSingle' || method === 'single')
    return { data: single ? (rows[0] ?? null) : rows, error: null }
  }
}
