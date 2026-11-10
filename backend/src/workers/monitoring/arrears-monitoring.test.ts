import { describe, expect, it } from 'vitest'

import { callsTo, fakeDb } from '../../common/testing/fake-db.test-helpers'
import {
  clientsFor,
  COMPANY,
  companySettingsRow,
  eqValue,
  isWrite,
  LEASE,
  MANAGER,
  names,
  PROPERTY,
  router,
  rule,
  settings,
  STATEMENT,
  TENANT,
  UNIT,
  unusedRuntime,
} from '../workers.test-helpers'
import { type ArrearsArrangement, arrearsFindings, type ArrearsStatement } from './arrears-monitoring.findings'
import { ArrearsMonitoringProcessor } from './arrears-monitoring.processor'

const AS_OF = '2026-11-09'

function statement(overrides: Partial<ArrearsStatement> = {}): ArrearsStatement {
  return {
    id: STATEMENT,
    tenantId: TENANT,
    propertyId: PROPERTY,
    unitId: UNIT,
    leaseId: LEASE,
    status: 'verified',
    statementDate: '2026-10-01',
    closingBalance: 19036.48,
    totalDue: 19036.48,
    ...overrides,
  }
}

const activeArrangement: ArrearsArrangement = {
  tenantId: TENANT,
  status: 'active',
  agreedOn: '2026-10-15',
  suppressArrearsReminders: true,
}

describe('arrearsFindings', () => {
  it('raises one arrears event per latest verified statement, prioritised by ageing bucket', () => {
    const { drafts } = arrearsFindings({ statements: [statement()], arrangements: [], settings: settings(), names, asOf: AS_OF })
    expect(drafts).toEqual([
      expect.objectContaining({
        dedupeKey: `arrears:${STATEMENT}:30`,
        type: 'arrears',
        tenantId: TENANT,
        unitId: UNIT,
        statementId: STATEMENT,
        title: 'Arrears: Test Trading owes R 19 036,48',
        priority: 'high',
        assignedToUserId: MANAGER,
      }),
    ])
    const old = arrearsFindings({ statements: [statement({ statementDate: '2026-06-01' })], arrangements: [], settings: settings(), names, asOf: AS_OF })
    expect(old.drafts[0].priority).toBe('critical')
    const current = arrearsFindings({ statements: [statement({ statementDate: '2026-11-01' })], arrangements: [], settings: settings(), names, asOf: AS_OF })
    expect(current.drafts[0].priority).toBe('medium')
  })

  it('raises the same statement again, at a higher priority, each time it ages into a later bucket', () => {
    const scan = (asOf: string) =>
      arrearsFindings({ statements: [statement({ statementDate: '2026-11-01' })], arrangements: [], settings: settings(), names, asOf }).drafts[0]
    const current = scan('2026-11-09')
    expect(current).toMatchObject({ dedupeKey: `arrears:${STATEMENT}:current`, priority: 'medium' })
    // Re-scanning within the same bucket repeats the key, so raising it again is a no-op (idempotent).
    expect(scan('2026-11-20')).toEqual(expect.objectContaining({ dedupeKey: current.dedupeKey, priority: 'medium' }))
    // Ageing into a later bucket is a new finding with a new key, so it is raised (and notified) once.
    expect(scan('2026-12-05')).toMatchObject({ dedupeKey: `arrears:${STATEMENT}:30`, priority: 'high' })
    expect(scan('2027-01-05')).toMatchObject({ dedupeKey: `arrears:${STATEMENT}:60`, priority: 'high' })
    expect(scan('2027-03-05')).toMatchObject({ dedupeKey: `arrears:${STATEMENT}:120+`, priority: 'critical' })
  })

  it('ignores unverified statements and balances in credit', () => {
    const { drafts } = arrearsFindings({
      statements: [statement({ status: 'review_required' }), statement({ id: 's-credit', tenantId: 'tenant-2', closingBalance: -50 })],
      arrangements: [],
      settings: settings(),
      names,
      asOf: AS_OF,
    })
    expect(drafts).toEqual([])
  })

  it('is suppressed while an active payment arrangement pauses arrears reminders', () => {
    const result = arrearsFindings({ statements: [statement()], arrangements: [activeArrangement], settings: settings(), names, asOf: AS_OF })
    expect(result).toEqual({ drafts: [], suppressedTenantIds: [TENANT] })
    const notSuppressing = arrearsFindings({
      statements: [statement()],
      arrangements: [{ ...activeArrangement, suppressArrearsReminders: false }],
      settings: settings(),
      names,
      asOf: AS_OF,
    })
    expect(notSuppressing.drafts).toHaveLength(1)
  })

  it('applies the company rule threshold and can be disabled', () => {
    const threshold = settings([rule({ event_type: 'arrears', config: { kind: 'arrears', minimumBalanceRands: 20000, ageingBucketsDays: [30, 60, 90] } })])
    expect(arrearsFindings({ statements: [statement()], arrangements: [], settings: threshold, names, asOf: AS_OF }).drafts).toEqual([])
    const disabled = settings([rule({ event_type: 'arrears', enabled: false, config: { kind: 'arrears', minimumBalanceRands: 0, ageingBucketsDays: [30] } })])
    expect(arrearsFindings({ statements: [statement()], arrangements: [], settings: disabled, names, asOf: AS_OF }).drafts).toEqual([])
  })
})

describe('ArrearsMonitoringProcessor', () => {
  it('reads verified statements and active arrangements of the job company and reports suppressed tenants', async () => {
    const db = fakeDb(
      router({
        reads: {
          companies: [companySettingsRow],
          statements: [
            {
              id: STATEMENT,
              tenant_id: TENANT,
              property_id: PROPERTY,
              unit_id: UNIT,
              lease_id: LEASE,
              status: 'verified',
              statement_date: '2026-10-01',
              closing_balance: 19036.48,
              total_due: 19036.48,
            },
          ],
          payment_arrangements: [{ tenant_id: TENANT, status: 'active', agreed_on: '2026-10-15', closed_on: null, suppress_arrears_reminders: true }],
        },
      }),
    )
    const processor = new ArrearsMonitoringProcessor(unusedRuntime, clientsFor(db.client))
    await expect(processor.scan({ companyId: COMPANY, asOf: AS_OF })).resolves.toMatchObject({ findings: 0, suppressed: 1, created: 0 })
    const statements = db.queries.find((q) => q.table === 'statements')
    expect(statements && eqValue(statements, 'company_id')).toBe(COMPANY)
    expect(statements && eqValue(statements, 'status')).toBe('verified')
    const arrangements = db.queries.find((q) => q.table === 'payment_arrangements')
    expect(arrangements && eqValue(arrangements, 'company_id')).toBe(COMPANY)
    expect(db.queries.filter(isWrite).flatMap((q) => callsTo(q, 'upsert'))).toEqual([])
  })
})
