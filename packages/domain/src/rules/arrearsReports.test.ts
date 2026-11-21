import { describe, expect, it } from 'vitest'

import type { ArrangementInstallment } from '../types/arrangement.js'
import { arrearsOverview, type ArrearsOverviewStatement } from './arrearsOverview.js'
import { buildArrearsReport, buildPaymentArrangementsReport, type ArrearsReportAccount, type ReportArrangement } from './arrearsReports.js'
import { reportFilterProblems } from './reportFrame.js'

const AS_OF = '2026-11-21'

const account = (overrides: Partial<ArrearsReportAccount> & Pick<ArrearsReportAccount, 'tenantId' | 'statementId'>): ArrearsReportAccount => ({
  tenantName: `Tenant ${overrides.tenantId}`,
  propertyId: 'p1',
  propertyName: 'Maponya Square',
  statementDate: '2026-10-31',
  outstanding: 1000,
  ...overrides,
})

const installment = (arrangementId: string, sequence: number, dueDate: string, amount: number, status: ArrangementInstallment['status'] = 'scheduled'): ArrangementInstallment => ({
  id: `${arrangementId}-${sequence}`,
  arrangementId,
  sequence,
  dueDate,
  amount,
  status,
})

const arrangement = (overrides: Partial<ReportArrangement> & Pick<ReportArrangement, 'arrangementId' | 'tenantId'>): ReportArrangement => ({
  tenantName: `Tenant ${overrides.tenantId}`,
  propertyId: 'p1',
  propertyName: 'Maponya Square',
  unitId: 'u1',
  unitNumber: 'S01',
  leaseId: 'l1',
  leaseReference: 'MSQ-L001',
  status: 'active',
  frequency: 'monthly',
  installmentAmount: 2000,
  outstandingBalance: 6000,
  firstInstallmentDate: '2026-10-15',
  finalInstallmentDate: '2026-12-15',
  agreedOn: '2026-10-01',
  suppressArrearsReminders: true,
  installments: [],
  ...overrides,
})

describe('buildArrearsReport', () => {
  const accounts = [
    account({ tenantId: 't1', tenantName: 'Dlamini Cellular', statementId: 's1', unitId: 'u1', unitNumber: 'S01', leaseId: 'l1', leaseReference: 'MSQ-L001', outstanding: 12960, statementDate: '2026-10-31' }),
    account({ tenantId: 't1', tenantName: 'Dlamini Cellular', statementId: 's2', unitId: 'u2', unitNumber: 'S02', leaseId: 'l2', outstanding: 500, statementDate: '2026-07-31' }),
    account({ tenantId: 't2', tenantName: 'Fresh Mart', statementId: 's3', propertyId: 'p2', propertyName: 'Diepkloof Centre', outstanding: 3000, statementDate: '2026-11-20' }),
    // Settled and in credit: not arrears.
    account({ tenantId: 't3', statementId: 's4', outstanding: 0 }),
    account({ tenantId: 't4', statementId: 's5', outstanding: -250 }),
  ]
  const arrangements = [
    arrangement({ arrangementId: 'a-old', tenantId: 't1', agreedOn: '2026-09-01' }),
    arrangement({ arrangementId: 'a-new', tenantId: 't1', agreedOn: '2026-10-01' }),
    // Cancelled: no longer in force.
    arrangement({ arrangementId: 'a-cancelled', tenantId: 't2', status: 'cancelled', closedOn: '2026-11-01' }),
  ]

  it('lists every account in arrears per tenant and unit, aged into the buckets, largest first', () => {
    const report = buildArrearsReport({ accounts, arrangements, asOf: AS_OF, buckets: [30, 60, 90, 120] })
    expect(report.rows.map((row) => [row.statementId, row.unitNumber, row.ageDays, row.bucket])).toEqual([
      ['s1', 'S01', 21, 'current'],
      ['s3', undefined, 1, 'current'],
      ['s2', 'S02', 113, '90'],
    ])
    expect(report.totalOutstanding).toBe(16460)
    expect(report.tenantCount).toBe(2)
    expect(report.buckets).toEqual([
      { bucket: 'current', description: '0–29 days', amount: 15960, tenantCount: 2 },
      { bucket: '30', description: '30–59 days', amount: 0, tenantCount: 0 },
      { bucket: '60', description: '60–89 days', amount: 0, tenantCount: 0 },
      { bucket: '90', description: '90–119 days', amount: 500, tenantCount: 1 },
      { bucket: '120+', description: '120 days or more', amount: 0, tenantCount: 0 },
    ])
  })

  it('marks a tenant under an active arrangement on every unit, never taking the balance out', () => {
    const report = buildArrearsReport({ accounts, arrangements, asOf: AS_OF })
    const dlamini = report.rows.filter((row) => row.tenantId === 't1')
    expect(dlamini.every((row) => row.underArrangement && row.remindersSuppressed && row.arrangementId === 'a-new')).toBe(true)
    expect(report.rows.find((row) => row.tenantId === 't2')).toMatchObject({ underArrangement: false, remindersSuppressed: false })
    expect(report.tenantsUnderArrangement).toBe(1)
    expect(report.tenantsWithRemindersSuppressed).toBe(1)
    expect(report.outstandingUnderArrangement).toBe(13460)
    expect(report.totalOutstanding).toBe(16460)
  })

  it('shows an arrangement that does not pause reminders as under arrangement without suppression', () => {
    const report = buildArrearsReport({
      accounts,
      arrangements: [arrangement({ arrangementId: 'a', tenantId: 't2', suppressArrearsReminders: false })],
      asOf: AS_OF,
    })
    expect(report.rows.find((row) => row.tenantId === 't2')).toMatchObject({ underArrangement: true, remindersSuppressed: false })
    expect(report.tenantsWithRemindersSuppressed).toBe(0)
  })

  it('narrows to the filtered properties and arrangement states, the totals adding up the rows shown', () => {
    const byProperty = buildArrearsReport({ accounts, arrangements, asOf: AS_OF, filters: { propertyIds: ['p2'] } })
    expect(byProperty.rows.map((row) => row.statementId)).toEqual(['s3'])
    expect(byProperty.totalOutstanding).toBe(3000)

    const none = buildArrearsReport({ accounts, arrangements, asOf: AS_OF, filters: { statuses: ['no_arrangement'] } })
    expect(none.rows.map((row) => row.tenantId)).toEqual(['t2'])
    const under = buildArrearsReport({ accounts, arrangements, asOf: AS_OF, filters: { statuses: ['under_arrangement'] } })
    expect(under.rows.map((row) => row.statementId)).toEqual(['s1', 's2'])
    expect(under.buckets.find((bucket) => bucket.bucket === '90')?.amount).toBe(500)
  })

  it('falls back to the default buckets when the company has none configured', () => {
    expect(buildArrearsReport({ accounts, arrangements, asOf: AS_OF, buckets: [] }).ageingBuckets).toEqual([30, 60, 90, 120])
    expect(buildArrearsReport({ accounts, arrangements, asOf: AS_OF, buckets: [60, 30] }).ageingBuckets).toEqual([30, 60])
  })

  it('matches the Statements page (arrearsOverview) for the same verified statements', () => {
    const statements: ArrearsOverviewStatement[] = [
      { id: 's1', tenantId: 't1', propertyId: 'p1', unitId: 'u1', leaseId: 'l1', status: 'verified', statementDate: '2026-10-31', closingBalance: 12960 },
      // An older statement of the same unit: superseded by s1.
      { id: 's0', tenantId: 't1', propertyId: 'p1', unitId: 'u1', leaseId: 'l1', status: 'verified', statementDate: '2026-09-30', closingBalance: 99999 },
      { id: 's2', tenantId: 't1', propertyId: 'p1', unitId: 'u2', leaseId: 'l2', status: 'verified', statementDate: '2026-07-31', totalDue: 500 },
      { id: 's3', tenantId: 't2', propertyId: 'p2', leaseId: 'l3', status: 'verified', statementDate: '2026-11-20', closingBalance: 3000 },
      // Waiting for review: never counts.
      { id: 's9', tenantId: 't2', propertyId: 'p2', leaseId: 'l3', status: 'review_required', statementDate: '2026-11-21', closingBalance: 70000 },
    ]
    const overview = arrearsOverview({ statements, arrangements, asOf: AS_OF })
    const report = buildArrearsReport({ accounts, arrangements, asOf: AS_OF })
    expect(report.totalOutstanding).toBe(overview.totalOutstanding)
    expect(report.tenantCount).toBe(overview.tenantsInArrears)
    expect(report.tenantsUnderArrangement).toBe(overview.tenantsUnderArrangement)
    expect(report.buckets.map((bucket) => [bucket.bucket, bucket.amount, bucket.tenantCount])).toEqual(
      overview.buckets.map((bucket) => [bucket.bucket, bucket.outstanding, bucket.tenantCount]),
    )
    expect(new Set(report.rows.map((row) => `${row.statementId}:${row.bucket}:${row.underArrangement}:${row.remindersSuppressed}`))).toEqual(
      new Set(overview.entries.map((entry) => `${entry.statementId}:${entry.bucket}:${entry.underArrangement}:${entry.remindersSuppressed}`)),
    )
  })

  it('offers the arrangement states as its status filter', () => {
    expect(reportFilterProblems('arrears', { statuses: ['under_arrangement', 'no_arrangement'] })).toEqual([])
    expect(reportFilterProblems('arrears', { statuses: ['active'] })).toHaveLength(1)
  })
})

describe('buildPaymentArrangementsReport', () => {
  const active = arrangement({
    arrangementId: 'a1',
    tenantId: 't1',
    agreedOn: '2026-09-15',
    installments: [
      installment('a1', 1, '2026-10-15', 2000, 'confirmed_paid'),
      installment('a1', 2, '2026-11-15', 2000),
      installment('a1', 3, '2026-12-15', 2000),
    ],
  })
  const defaulted = arrangement({
    arrangementId: 'a2',
    tenantId: 't2',
    propertyId: 'p2',
    status: 'defaulted',
    agreedOn: '2026-06-01',
    closedOn: '2026-10-01',
    installments: [installment('a2', 1, '2026-07-01', 3000, 'missed'), installment('a2', 2, '2026-08-01', 3000, 'missed'), installment('a2', 3, '2026-09-01', 3000)],
  })
  const completed = arrangement({
    arrangementId: 'a3',
    tenantId: 't3',
    status: 'completed',
    agreedOn: '2026-03-01',
    closedOn: '2026-05-01',
    outstandingBalance: 4000,
    installments: [installment('a3', 1, '2026-04-01', 2000, 'confirmed_paid'), installment('a3', 2, '2026-05-01', 2000, 'confirmed_paid')],
  })
  const cancelled = arrangement({ arrangementId: 'a4', tenantId: 't4', status: 'cancelled', agreedOn: '2026-11-01', closedOn: '2026-11-02', installments: [installment('a4', 1, '2026-11-10', 6000)] })
  const all = [cancelled, completed, defaulted, active]

  it('lists every arrangement with schedule progress, missed and overdue instalments, active first', () => {
    const report = buildPaymentArrangementsReport({ arrangements: all, asOf: AS_OF, graceDays: 3 })
    expect(report.rows.map((row) => row.arrangementId)).toEqual(['a1', 'a2', 'a3', 'a4'])
    expect(report.rows[0]).toMatchObject({ paid: 2000, remaining: 4000, paidCount: 1, totalCount: 3, missedCount: 0, overdueCount: 1, nextDueDate: '2026-12-15', nextAmount: 2000 })
    // An arrangement no longer in force has no overdue or next instalment; its missed ones stay on record.
    expect(report.rows[1]).toMatchObject({ missedCount: 2, overdueCount: 0, closedOn: '2026-10-01' })
    expect(report.rows[1]?.nextDueDate).toBeUndefined()
    expect(report.rows[2]).toMatchObject({ paid: 4000, remaining: 0, paidCount: 2, totalCount: 2 })
    expect(report.countsByStatus).toEqual({ proposed: 0, active: 1, completed: 1, defaulted: 1, cancelled: 1 })
    expect(report.activeCount).toBe(1)
    expect(report.outstandingUnderArrangement).toBe(4000)
    expect(report.paidToDate).toBe(6000)
    expect(report.missedInstallments).toBe(2)
    expect(report.overdueInstallments).toBe(1)
    expect(report.graceDays).toBe(3)
  })

  it('counts an instalment as overdue only after the grace days', () => {
    // Due 15 Nov; 21 Nov is 6 days later.
    expect(buildPaymentArrangementsReport({ arrangements: [active], asOf: AS_OF, graceDays: 6 }).overdueInstallments).toBe(0)
    expect(buildPaymentArrangementsReport({ arrangements: [active], asOf: AS_OF, graceDays: 5 }).overdueInstallments).toBe(1)
  })

  it('narrows to the filtered properties, agreement dates and statuses', () => {
    const report = (filters: Parameters<typeof buildPaymentArrangementsReport>[0]['filters']) =>
      buildPaymentArrangementsReport({ arrangements: all, asOf: AS_OF, ...(filters ? { filters } : {}) }).rows.map((row) => row.arrangementId)
    expect(report({ propertyIds: ['p2'] })).toEqual(['a2'])
    expect(report({ statuses: ['completed', 'cancelled'] })).toEqual(['a3', 'a4'])
    expect(report({ from: '2026-06-01', to: '2026-09-15' })).toEqual(['a1', 'a2'])
    expect(report({ from: '2026-10-01' })).toEqual(['a4'])
  })

  it('offers the arrangement statuses and the agreement date range', () => {
    expect(reportFilterProblems('payment_arrangements', { statuses: ['active', 'cancelled'], from: '2026-01-01', to: '2026-12-31' })).toEqual([])
    expect(reportFilterProblems('payment_arrangements', { statuses: ['under_arrangement'] })).toHaveLength(1)
    expect(reportFilterProblems('payment_arrangements', { from: '2026-12-31', to: '2026-01-01' })).toHaveLength(1)
  })
})
