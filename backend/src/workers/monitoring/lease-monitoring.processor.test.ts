import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import { clientsFor, COMPANY, companySettingsRow, eqValue, isWrite, leaseRow, MANAGER, router, unusedRuntime } from '../workers.test-helpers'
import { LeaseMonitoringProcessor } from './lease-monitoring.processor'

const expiringLease = { ...leaseRow, lease_bank_guarantees: [] }

function harness(reads: Record<string, readonly unknown[]>, inserted: unknown[] = [{ id: 'evt-1' }]) {
  const db = fakeDb(
    router({
      reads,
      respond: (query) => {
        if (query.table === 'monitoring_events' && callsTo(query, 'upsert').length > 0) return { data: inserted, error: null }
        return undefined
      },
    }),
  )
  return { processor: new LeaseMonitoringProcessor(unusedRuntime, clientsFor(db.client)), queries: db.queries }
}

describe('LeaseMonitoringProcessor', () => {
  it('scans verified, monitored leases of the job company only and raises deduplicated events', async () => {
    const { processor, queries } = harness({
      companies: [companySettingsRow],
      leases: [expiringLease],
      properties: [{ id: leaseRow.property_id, manager_user_id: MANAGER }],
    })
    const summary = await processor.scan({ companyId: COMPANY, asOf: '2026-11-09' })
    expect(summary).toMatchObject({ findings: 1, created: 1 })

    const reads = queries.filter((q) => !isWrite(q) && q.table !== 'companies')
    for (const query of reads) expect(eqValue(query, 'company_id')).toBe(COMPANY)
    const leaseQuery = queries.find((q) => q.table === 'leases')
    expect(leaseQuery && eqValue(leaseQuery, 'verified')).toBe(true)
    expect(leaseQuery && callsTo(leaseQuery, 'in')).toEqual([['status', ['active', 'expiring']]])

    const upsert = queries.find((q) => q.table === 'monitoring_events' && isWrite(q))
    const [[rows, options]] = upsert ? callsTo(upsert, 'upsert') : [[]]
    expect(options).toEqual({ onConflict: 'company_id,dedupe_key', ignoreDuplicates: true })
    expect(rows).toEqual([
      expect.objectContaining({
        company_id: COMPANY,
        dedupe_key: `lease_expiry:${leaseRow.id}:2027-01-31:90`,
        priority: 'high',
        assigned_to_user_id: MANAGER,
        status: 'new',
      }),
    ])
  })

  it('notifies the manager of open high and critical events, keyed per event and recipient', async () => {
    const { processor, queries } = harness({
      companies: [companySettingsRow],
      leases: [expiringLease],
      properties: [{ id: leaseRow.property_id, manager_user_id: MANAGER }],
      monitoring_events: [{ id: 'evt-1', title: 'T', description: 'D', priority: 'high', status: 'new', assigned_to_user_id: MANAGER }],
    })
    await processor.scan({ companyId: COMPANY, asOf: '2026-11-09' })
    const lookup = queries.find((q) => q.table === 'monitoring_events' && !isWrite(q))
    expect(lookup && callsTo(lookup, 'not')).toEqual([['status', 'in', '(resolved,dismissed)']])
    const notification = queries.find((q) => q.table === 'notifications')
    const [[rows, options]] = notification ? callsTo(notification, 'upsert') : [[]]
    expect(options).toEqual({ onConflict: 'company_id,dedupe_key', ignoreDuplicates: true })
    expect(rows).toEqual([
      expect.objectContaining({
        company_id: COMPANY,
        user_id: MANAGER,
        type: 'monitoring_event',
        severity: 'warning',
        dedupe_key: `monitoring_event:evt-1:${MANAGER}`,
        link_entity_type: 'monitoring_event',
        link_entity_id: 'evt-1',
      }),
    ])
  })

  it('skips a company that is no longer active and rejects a malformed date', async () => {
    const { processor, queries } = harness({ companies: [{ ...companySettingsRow, status: 'suspended' }] })
    await expect(processor.scan({ companyId: COMPANY, asOf: '2026-11-09' })).resolves.toMatchObject({ skipped: 'company_inactive' })
    expect(queries.map((q) => q.table)).toEqual(['companies'])
    await expect(processor.scan({ companyId: COMPANY, asOf: '2026-02-30' })).rejects.toThrow(/Invalid asOf/)
  })

  it('fails the attempt (to be retried) when the database errors', async () => {
    const db = fakeDb(() => ({ data: null, error: { code: 'PGRST000', message: 'connection refused' } }))
    const processor = new LeaseMonitoringProcessor(unusedRuntime, clientsFor(db.client))
    await expect(processor.scan({ companyId: COMPANY, asOf: '2026-11-09' })).rejects.toThrow(/Load company settings failed \(PGRST000\)/)
  })
})
