import { describe, expect, it } from 'vitest'

import { makeLease } from './__fixtures__/lease.js'
import { compareBilledRental } from './escalation.js'
import {
  buildLeaseMonitoringReport,
  buildRentalDiscrepancyReport,
  eventAgeBucket,
  type MonitoringReportEvent,
  type RentalComparisonLease,
} from './monitoringReports.js'

const AS_OF = '2026-11-21'

function event(overrides: Partial<MonitoringReportEvent> = {}): MonitoringReportEvent {
  return {
    eventId: 'e1',
    type: 'lease_expiry',
    title: 'Lease expires',
    priority: 'medium',
    status: 'new',
    propertyId: 'p1',
    propertyName: 'Maponya Square',
    identifiedOn: '2026-11-20',
    ...overrides,
  }
}

describe('eventAgeBucket', () => {
  it('buckets the days an event has been open', () => {
    expect([0, 7, 8, 30, 31, 90, 91].map(eventAgeBucket)).toEqual(['0-7', '0-7', '8-30', '8-30', '31-90', '31-90', '90+'])
  })
})

describe('buildLeaseMonitoringReport', () => {
  const events = [
    event({ eventId: 'e1', identifiedOn: '2026-11-20', priority: 'low' }),
    event({ eventId: 'e2', identifiedOn: '2026-08-01', type: 'arrears', priority: 'critical', status: 'in_progress', dueDate: '2026-11-01', propertyId: 'p2', propertyName: 'Dobsonville Centre' }),
    event({ eventId: 'e3', identifiedOn: '2026-10-01', status: 'resolved', dueDate: '2026-10-15' }),
    event({ eventId: 'e4', identifiedOn: '2026-11-20', priority: 'high', status: 'dismissed' }),
    event({ eventId: 'e5', identifiedOn: '2026-11-20', priority: 'high', status: 'action_required', calculation: { steps: ['x'] } }),
  ]

  it('lists the open events by default, oldest first then critical first, each with its age', () => {
    const report = buildLeaseMonitoringReport(events, AS_OF)
    expect(report.events.map((row) => row.eventId)).toEqual(['e2', 'e5', 'e1'])
    expect(report.total).toBe(3)
    expect(report.open).toBe(3)
    expect(report.events[0]).toMatchObject({ ageDays: 112, ageBucket: '90+', overdue: true })
    expect(report.events[2]).toMatchObject({ ageDays: 1, ageBucket: '0-7', overdue: false })
    expect(report.events[1]).not.toHaveProperty('calculation')
  })

  it('counts by type, priority, status, property and age', () => {
    const report = buildLeaseMonitoringReport(events, AS_OF)
    expect(report.byType).toMatchObject({ lease_expiry: 2, arrears: 1, rental_escalation_discrepancy: 0 })
    expect(report.byPriority).toEqual({ low: 1, medium: 0, high: 1, critical: 1 })
    expect(report.byStatus).toEqual({ new: 1, under_review: 0, action_required: 1, in_progress: 1, resolved: 0, dismissed: 0 })
    expect(report.byAge).toEqual([
      { bucket: '0-7', count: 2 },
      { bucket: '8-30', count: 0 },
      { bucket: '31-90', count: 0 },
      { bucket: '90+', count: 1 },
    ])
    expect(report.byProperty).toEqual([
      { propertyId: 'p2', propertyName: 'Dobsonville Centre', total: 1, open: 1, overdue: 1 },
      { propertyId: 'p1', propertyName: 'Maponya Square', total: 2, open: 2, overdue: 0 },
    ])
    expect(report.overdue).toBe(1)
  })

  it('narrows to statuses, properties and the identified date range', () => {
    const closed = buildLeaseMonitoringReport(events, AS_OF, { statuses: ['resolved', 'dismissed'] })
    expect(closed.events.map((row) => row.eventId)).toEqual(['e3', 'e4'])
    expect(closed.open).toBe(0)
    // A resolved event past its due date is not overdue.
    expect(closed.events[0]?.overdue).toBe(false)
    expect(buildLeaseMonitoringReport(events, AS_OF, { propertyIds: ['p2'] }).events.map((row) => row.eventId)).toEqual(['e2'])
    expect(buildLeaseMonitoringReport(events, AS_OF, { from: '2026-11-01', to: '2026-11-20' }).events.map((row) => row.eventId)).toEqual(['e5', 'e1'])
  })
})

describe('buildRentalDiscrepancyReport', () => {
  const terms = makeLease()
  const lease = (overrides: Partial<RentalComparisonLease> = {}): RentalComparisonLease => ({
    leaseId: 'l1',
    reference: 'MSQ-L001',
    status: 'active',
    verified: true,
    propertyId: 'p1',
    propertyName: 'Maponya Square',
    unitNumber: 'S01',
    tenantId: 't1',
    tenantName: 'Dlamini Cellular',
    commencementDate: terms.commencementDate,
    expiryDate: terms.expiryDate,
    initialMonthlyRental: terms.initialMonthlyRental,
    escalation: terms.escalation,
    billed: { statementId: 's1', statementDate: '2027-01-31', periodStart: '2027-01-01', rentalCharged: 35000 },
    ...overrides,
  })

  it('compares the latest billed rental with the escalated rental, as the monitoring scan does (spec: R37 800 vs R35 000)', () => {
    const report = buildRentalDiscrepancyReport({ leases: [lease()], events: [] })
    const expected = compareBilledRental(terms, 35000, '2027-01-01')
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      source: 'recomputed',
      current: true,
      leaseId: 'l1',
      statementId: 's1',
      periodStart: '2027-01-01',
      expected: 37800,
      billed: 35000,
      difference: 2800,
      withinTolerance: false,
    })
    expect(report.rows[0]?.steps).toEqual(expected.calculation.steps)
    expect(report).toMatchObject({ totalMonthlyDifference: 2800, underBilled: 2800, overBilled: 0, outsideToleranceCount: 1, recomputedCount: 1, eventCount: 0, leasesCompared: 1 })
  })

  it('links the event raised for the statement, and applies the company tolerance', () => {
    const raised = event({ eventId: 'ev1', type: 'rental_escalation_discrepancy', statementId: 's1', leaseId: 'l1', tenantId: 't1', status: 'under_review' })
    const report = buildRentalDiscrepancyReport({ leases: [lease()], events: [raised] })
    expect(report.rows[0]).toMatchObject({ source: 'event', eventId: 'ev1', eventStatus: 'under_review' })
    expect(report).toMatchObject({ eventCount: 1, recomputedCount: 0, openEventCount: 1 })

    const tolerant = buildRentalDiscrepancyReport({ leases: [lease()], events: [], tolerance: { toleranceRands: 3000, tolerancePercent: 0 } })
    expect(tolerant.rows[0]?.withinTolerance).toBe(true)
    expect(tolerant).toMatchObject({ totalMonthlyDifference: 0, outsideToleranceCount: 0, recomputedCount: 0 })
  })

  it('skips unverified and unmonitored leases, counts leases waiting for verification and those awaiting a billed statement', () => {
    const report = buildRentalDiscrepancyReport({
      leases: [
        lease({ leaseId: 'l2', verified: false, status: 'pending_verification' }),
        lease({ leaseId: 'l3', status: 'expired' }),
        lease({ leaseId: 'l4', billed: undefined }),
      ],
      events: [],
    })
    expect(report.rows).toEqual([])
    expect(report).toMatchObject({ leasesCompared: 0, awaitingStatement: 1, unverifiedLeasesExcluded: 1 })
  })

  it('keeps an open event on an earlier statement with the calculation it recorded', () => {
    const stale = event({
      eventId: 'ev0',
      type: 'rental_escalation_discrepancy',
      statementId: 's0',
      statementDate: '2026-12-31',
      periodStart: '2026-12-01',
      leaseId: 'l1',
      leaseReference: 'MSQ-L001',
      tenantId: 't1',
      tenantName: 'Dlamini Cellular',
      calculation: { expectedAmount: 35000, actualAmount: 36000, difference: -1000, steps: ['Billed rental: R 36 000,00'] },
    })
    const dismissed = { ...stale, eventId: 'ev-old', statementId: 'sx', status: 'dismissed' as const }
    const report = buildRentalDiscrepancyReport({ leases: [lease()], events: [stale, dismissed] })
    expect(report.rows.map((row) => [row.eventId ?? row.source, row.current])).toEqual([
      ['recomputed', true],
      ['ev0', false],
    ])
    expect(report.rows[1]).toMatchObject({ expected: 35000, billed: 36000, difference: -1000, withinTolerance: false, steps: ['Billed rental: R 36 000,00'] })
    expect(report).toMatchObject({ totalMonthlyDifference: 1800, underBilled: 2800, overBilled: 1000, openEventCount: 1 })
  })

  it('narrows to properties, the billing period and the comparison outcome', () => {
    const leases = [lease(), lease({ leaseId: 'l9', reference: 'DVC-L001', propertyId: 'p2', propertyName: 'Dobsonville', billed: { statementId: 's9', statementDate: '2027-02-28', periodStart: '2027-02-01', rentalCharged: 37800 } })]
    const all = buildRentalDiscrepancyReport({ leases, events: [] })
    expect(all.rows.map((row) => row.leaseId)).toEqual(['l1', 'l9'])
    expect(buildRentalDiscrepancyReport({ leases, events: [] }, { statuses: ['within_tolerance'] }).rows.map((row) => row.leaseId)).toEqual(['l9'])
    expect(buildRentalDiscrepancyReport({ leases, events: [] }, { propertyIds: ['p2'] }).leasesCompared).toBe(1)
    expect(buildRentalDiscrepancyReport({ leases, events: [] }, { from: '2027-02-01' }).rows.map((row) => row.leaseId)).toEqual(['l9'])
  })
})
