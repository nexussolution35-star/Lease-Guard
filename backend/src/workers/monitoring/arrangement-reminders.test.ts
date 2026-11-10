import type { ArrangementInstallment } from '@leaseguard/domain'
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
  TENANT,
  UNIT,
  unusedRuntime,
} from '../workers.test-helpers'
import { arrangementFindings, type ReminderArrangement } from './arrangement-reminders.findings'
import { ArrangementRemindersProcessor } from './arrangement-reminders.processor'

const AS_OF = '2026-11-09'
const ARRANGEMENT = '99999999-9999-4999-8999-999999999999'

function instalment(sequence: number, dueDate: string, status: ArrangementInstallment['status'] = 'scheduled'): ArrangementInstallment {
  return { id: `inst-${sequence}`, arrangementId: ARRANGEMENT, sequence, dueDate, amount: 10000, status }
}

function arrangement(installments: ArrangementInstallment[], overrides: Partial<ReminderArrangement> = {}): ReminderArrangement {
  return {
    id: ARRANGEMENT,
    tenantId: TENANT,
    propertyId: PROPERTY,
    unitId: UNIT,
    leaseId: LEASE,
    status: 'active',
    agreedOn: '2026-09-01',
    installments,
    ...overrides,
  }
}

describe('arrangementFindings', () => {
  it('raises an arrangement_attention event per open instalment overdue beyond the grace days', () => {
    const rules = settings([rule({ event_type: 'arrangement_attention', default_priority: 'high', config: { kind: 'arrangement_attention', graceDays: 3 } })])
    const { overdue } = arrangementFindings({
      arrangements: [
        arrangement([
          instalment(1, '2026-10-01', 'confirmed_paid'),
          instalment(2, '2026-10-15'),
          instalment(3, '2026-11-07'),
          instalment(4, '2026-12-15'),
        ]),
      ],
      settings: rules,
      names,
      asOf: AS_OF,
    })
    expect(overdue).toEqual([
      expect.objectContaining({
        dedupeKey: 'arrangement_attention:inst-2',
        type: 'arrangement_attention',
        arrangementId: ARRANGEMENT,
        title: 'Missed instalment: Test Trading arrangement (2 of 4)',
        dueDate: '2026-10-15',
        priority: 'high',
        assignedToUserId: MANAGER,
      }),
    ])
  })

  it('notifies the property manager (never the tenant) of an instalment due within the lead days', () => {
    const { upcoming, overdue } = arrangementFindings({
      arrangements: [arrangement([instalment(1, '2026-11-11'), instalment(2, '2026-12-11')])],
      settings: settings(),
      names,
      asOf: AS_OF,
    })
    expect(overdue).toEqual([])
    expect(upcoming).toEqual([
      expect.objectContaining({
        dedupeKey: `arrangement_instalment_due:inst-1:${MANAGER}`,
        userId: MANAGER,
        type: 'arrangement',
        link: { entityType: 'payment_arrangement', entityId: ARRANGEMENT },
      }),
    ])
    const later = arrangementFindings({ arrangements: [arrangement([instalment(1, '2026-11-20')])], settings: settings(), names, asOf: AS_OF })
    expect(later.upcoming).toEqual([])
  })

  it('ignores arrangements that are not active on the scan date', () => {
    const { overdue, upcoming } = arrangementFindings({
      arrangements: [
        arrangement([instalment(1, '2026-10-01')], { status: 'completed', closedOn: '2026-10-30' }),
        arrangement([instalment(1, '2026-11-10')], { agreedOn: '2026-12-01' }),
      ],
      settings: settings(),
      names,
      asOf: AS_OF,
    })
    expect([...overdue, ...upcoming]).toEqual([])
  })
})

describe('ArrangementRemindersProcessor', () => {
  it('loads the job company arrangements and instalments and never updates instalments', async () => {
    const db = fakeDb(
      router({
        reads: {
          companies: [companySettingsRow],
          properties: [{ id: PROPERTY, manager_user_id: MANAGER }],
          payment_arrangements: [
            { id: ARRANGEMENT, tenant_id: TENANT, property_id: PROPERTY, unit_id: UNIT, lease_id: LEASE, status: 'active', agreed_on: '2026-09-01', closed_on: null },
          ],
          arrangement_installments: [
            { id: 'inst-1', arrangement_id: ARRANGEMENT, sequence: 1, due_date: '2026-10-15', amount: 10000, status: 'scheduled', reminder_sent_at: null, confirmed_by_user_id: null, confirmed_on: null, notes: null },
            { id: 'inst-2', arrangement_id: ARRANGEMENT, sequence: 2, due_date: '2026-11-10', amount: 10000, status: 'scheduled', reminder_sent_at: null, confirmed_by_user_id: null, confirmed_on: null, notes: null },
          ],
        },
      }),
    )
    const processor = new ArrangementRemindersProcessor(unusedRuntime, clientsFor(db.client))
    await expect(processor.scan({ companyId: COMPANY, asOf: AS_OF })).resolves.toMatchObject({ overdue: 1 })

    const instalments = db.queries.find((q) => q.table === 'arrangement_installments')
    expect(instalments && eqValue(instalments, 'company_id')).toBe(COMPANY)
    expect(instalments && callsTo(instalments, 'in')).toEqual([['arrangement_id', [ARRANGEMENT]]])
    expect(db.queries.filter((q) => q.table === 'arrangement_installments' && isWrite(q))).toEqual([])
    expect(db.queries.filter((q) => q.table === 'communications')).toEqual([])

    const events = db.queries.find((q) => q.table === 'monitoring_events' && isWrite(q))
    const eventRows = events ? callsTo(events, 'upsert')[0][0] : []
    expect(eventRows).toEqual([expect.objectContaining({ company_id: COMPANY, dedupe_key: 'arrangement_attention:inst-1' })])
    const notifications = db.queries.find((q) => q.table === 'notifications')
    const notificationRows = notifications ? callsTo(notifications, 'upsert')[0][0] : []
    expect(notificationRows).toEqual([expect.objectContaining({ company_id: COMPANY, user_id: MANAGER, type: 'arrangement' })])
  })
})
