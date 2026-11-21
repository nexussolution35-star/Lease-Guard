import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import {
  clientsFor,
  COMPANY,
  companySettingsRow,
  eqValue,
  fixedClock,
  isWrite,
  LEASE,
  leaseRow,
  MANAGER,
  PROPERTY,
  router,
  STATEMENT,
  TENANT,
  UNIT,
  unusedRuntime,
} from '../workers.test-helpers'
import { ArrearsMonitoringProcessor } from './arrears-monitoring.processor'
import { LeaseMonitoringProcessor } from './lease-monitoring.processor'
import { StatementMonitoringProcessor } from './statement-monitoring.processor'

const verifiedStatement = {
  id: STATEMENT,
  status: 'verified',
  tenant_id: TENANT,
  property_id: PROPERTY,
  unit_id: UNIT,
  lease_id: LEASE,
  statement_date: '2026-10-01',
  period_start: '2026-10-01',
  closing_balance: 19036.48,
  total_due: 19036.48,
  rental_charged: 19036.48,
}

function harness(statement: Record<string, unknown> | null) {
  const db = fakeDb(
    router({
      reads: {
        companies: [companySettingsRow],
        statements: statement ? [statement] : [],
        leases: [{ ...leaseRow, lease_bank_guarantees: [] }],
        properties: [{ id: PROPERTY, manager_user_id: MANAGER }],
      },
      respond: (query) =>
        query.table === 'monitoring_events' && callsTo(query, 'upsert').length > 0 ? { data: [{ id: 'evt-1' }], error: null } : undefined,
    }),
  )
  const clients = clientsFor(db.client)
  const processor = new StatementMonitoringProcessor(
    unusedRuntime,
    clients,
    fixedClock('2026-11-21T08:00:00Z'),
    new ArrearsMonitoringProcessor(unusedRuntime, clients),
    new LeaseMonitoringProcessor(unusedRuntime, clients),
  )
  return { processor, queries: db.queries }
}

describe('StatementMonitoringProcessor', () => {
  it('runs arrears and lease monitoring for the verified statement\'s tenant only, as of today', async () => {
    const { processor, queries } = harness(verifiedStatement)
    const result = await processor.run({ companyId: COMPANY, statementId: STATEMENT })
    expect(result).toMatchObject({ tenantId: TENANT, asOf: '2026-11-21' })

    const [lookup, ...scans] = queries.filter((q) => q.table === 'statements')
    expect(lookup && eqValue(lookup, 'id')).toBe(STATEMENT)
    expect(scans).toHaveLength(2)
    for (const scan of scans) {
      expect(eqValue(scan, 'company_id')).toBe(COMPANY)
      expect(eqValue(scan, 'status')).toBe('verified')
      expect(eqValue(scan, 'tenant_id')).toBe(TENANT)
    }
    const leases = queries.find((q) => q.table === 'leases')
    expect(leases && eqValue(leases, 'tenant_id')).toBe(TENANT)

    const raised = queries
      .filter((q) => q.table === 'monitoring_events' && isWrite(q))
      .flatMap((q) => callsTo(q, 'upsert').flatMap(([rows]) => rows as { type: string; tenant_id: string | null }[]))
    expect(raised.map((row) => row.type)).toContain('arrears')
    for (const row of raised) expect(row.tenant_id).toBe(TENANT)
  })

  it('does nothing for a statement that is not verified (or no longer exists)', async () => {
    const pending = harness({ ...verifiedStatement, status: 'review_required' })
    await expect(pending.processor.run({ companyId: COMPANY, statementId: STATEMENT })).resolves.toEqual({ skipped: 'not_verified' })
    expect(pending.queries.map((q) => q.table)).toEqual(['statements'])

    const missing = harness(null)
    await expect(missing.processor.run({ companyId: COMPANY, statementId: STATEMENT })).resolves.toEqual({ skipped: 'not_verified' })
  })
})
