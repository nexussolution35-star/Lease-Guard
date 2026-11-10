import type { EntityId, TenantMessageContext } from '@leaseguard/domain'

import type { DbClient } from '../infrastructure/database/rls-client.factory'
import { readOrThrow } from './read-error'

/** A payment arrangement as the reminder rules of @leaseguard/domain read it. */
export type ReminderArrangement = TenantMessageContext['arrangements'][number]

/** One tenant's arrangements (the outbound gate) or a whole company's active ones (arrears monitoring). */
export type ArrangementScope = { readonly tenantId: EntityId } | { readonly activeOnly: true }

/** Rows per request; the Data API `max_rows` limit (supabase/config.toml). */
const PAGE_SIZE = 1000

/**
 * Loads the arrangements that decide whether arrears reminders are paused for a tenant
 * (`shouldSuppressArrearsReminder`). One query and one row mapping for every caller that must agree on
 * suppression: the outbound gate and the daily arrears monitoring. Read page by page, so a large
 * company is never silently cut off at the row limit. Every read filters by company (the worker reads
 * with the service role). Throws MessagingReadError.
 */
export async function loadReminderArrangements(db: DbClient, companyId: EntityId, scope: ArrangementScope): Promise<ReminderArrangement[]> {
  const arrangements: ReminderArrangement[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = db.from('payment_arrangements').select('id, tenant_id, status, agreed_on, closed_on, suppress_arrears_reminders').eq('company_id', companyId)
    query = 'tenantId' in scope ? query.eq('tenant_id', scope.tenantId) : query.eq('status', 'active')
    const rows = readOrThrow(await query.order('id').range(from, from + PAGE_SIZE - 1), 'Load payment arrangements', [])
    for (const row of rows) {
      arrangements.push({
        tenantId: row.tenant_id,
        status: row.status,
        agreedOn: row.agreed_on,
        ...(row.closed_on ? { closedOn: row.closed_on } : {}),
        suppressArrearsReminders: row.suppress_arrears_reminders,
      })
    }
    if (rows.length < PAGE_SIZE) return arrangements
  }
}
