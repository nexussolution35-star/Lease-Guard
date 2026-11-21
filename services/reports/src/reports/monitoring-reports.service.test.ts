import { BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common'
import type { DbClient } from '@leaseguard/service-kit'
import { describe, expect, it } from 'vitest'

import { MonitoringReportDataService } from './monitoring-report-data.service'
import { MonitoringReportsService } from './monitoring-reports.service'

const COMPANY = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d'
// 21 Nov 2026, 10:00 in Johannesburg.
const NOW = new Date('2026-11-21T08:00:00Z')

const EVENT_ROWS = [
  {
    event_id: 'e1', event_type: 'rental_escalation_discrepancy', title: 'Rental under-charged', priority: 'high', status: 'new',
    property_id: 'p1', property_name: 'Maponya Square', unit_number: 'S01', tenant_id: 't1', tenant_name: 'Dlamini Cellular',
    lease_id: 'l1', lease_reference: 'MSQ-L001', statement_id: 's1', statement_date: '2026-09-30', statement_period_start: '2026-09-01',
    identified_on: '2026-10-01', due_date: null,
    calculation: { expectedAmount: '13996.80', actualAmount: 12960, difference: 1036.8, steps: ['Initial rental R 12 000,00'] },
  },
  {
    event_id: 'e2', event_type: 'lease_expiry', title: 'Lease expires', priority: 'medium', status: 'resolved',
    property_id: 'p1', property_name: 'Maponya Square', unit_number: null, tenant_id: null, tenant_name: null, lease_id: null,
    lease_reference: null, statement_id: null, statement_date: null, statement_period_start: null, identified_on: '2026-11-20',
    due_date: '2026-11-25', calculation: null,
  },
]

const LEASE_ROWS = [
  {
    lease_id: 'l1', lease_reference: 'MSQ-L001', lease_status: 'active', verified: true, property_id: 'p1', property_name: 'Maponya Square',
    unit_number: 'S01', tenant_id: 't1', tenant_name: 'Dlamini Cellular', commencement_date: '2024-01-01', expiry_date: '2028-12-31',
    initial_monthly_rental: '12000.00', escalation_type: 'percentage', escalation_percentage: '8.000', escalation_fixed_amount: null,
    escalation_cpi_assumed_percentage: null, escalation_cpi_margin_percentage: null, escalation_frequency: 'annual',
    first_escalation_date: '2025-01-01', statement_id: 's1', statement_date: '2026-09-30', period_start: '2026-09-01', rental_charged: '12960.00',
  },
  {
    lease_id: 'l2', lease_reference: 'WIP-L003', lease_status: 'pending_verification', verified: false, property_id: 'p1',
    property_name: 'Maponya Square', unit_number: 'S02', tenant_id: 't2', tenant_name: 'Kasi Flame Grill', commencement_date: '2025-03-01',
    expiry_date: '2030-02-28', initial_monthly_rental: 9000, escalation_type: 'percentage', escalation_percentage: 7, escalation_fixed_amount: null,
    escalation_cpi_assumed_percentage: null, escalation_cpi_margin_percentage: null, escalation_frequency: 'annual',
    first_escalation_date: '2026-03-01', statement_id: null, statement_date: null, period_start: null, rental_charged: null,
  },
]

type Answer = { data: unknown; error: { code: string; message: string } | null }

function dbAnswering(answers: Record<string, Answer>) {
  const calls: string[] = []
  const db = {
    rpc: async (fn: string, args: { p_company_id: string }) => {
      calls.push(fn)
      expect(args).toEqual({ p_company_id: COMPANY })
      return answers[fn] ?? { data: [], error: null }
    },
  } as unknown as DbClient
  return { db, calls }
}

const service = new MonitoringReportsService(new MonitoringReportDataService())

describe('MonitoringReportsService.leaseMonitoring', () => {
  it('lists the open events by default with their age on the South African date', async () => {
    const { db, calls } = dbAnswering({ reports_monitoring_events: { data: EVENT_ROWS, error: null } })
    const report = await service.leaseMonitoring(db, COMPANY, {}, NOW)
    expect(calls).toEqual(['reports_monitoring_events'])
    expect(report).toMatchObject({ reportId: 'lease_monitoring', asOf: '2026-11-21', filters: {} })
    expect(report.data.events.map((row) => row.eventId)).toEqual(['e1'])
    expect(report.data.events[0]).toMatchObject({ ageDays: 51, ageBucket: '31-90', unitNumber: 'S01', statementId: 's1' })
    expect(report.data.byType.rental_escalation_discrepancy).toBe(1)
  })

  it('states the status filter back and refuses a status the report does not offer', async () => {
    const { db } = dbAnswering({ reports_monitoring_events: { data: EVENT_ROWS, error: null } })
    const report = await service.leaseMonitoring(db, COMPANY, { status: ['resolved'] }, NOW)
    expect(report.filters).toEqual({ statuses: ['resolved'] })
    expect(report.data.events.map((row) => row.eventId)).toEqual(['e2'])
    await expect(service.leaseMonitoring(db, COMPANY, { status: ['vacant'] }, NOW)).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('MonitoringReportsService.rentalDiscrepancies', () => {
  it('compares the billed rental with the escalated rental and links the event raised for the statement', async () => {
    const { db, calls } = dbAnswering({
      reports_rental_comparisons: { data: LEASE_ROWS, error: null },
      reports_monitoring_events: { data: EVENT_ROWS, error: null },
      reports_discrepancy_rule: { data: [{ enabled: true, config: { kind: 'rental_escalation_discrepancy', toleranceRands: 50, tolerancePercent: 0 } }], error: null },
    })
    const report = await service.rentalDiscrepancies(db, COMPANY, {}, NOW)
    expect(calls.sort()).toEqual(['reports_discrepancy_rule', 'reports_monitoring_events', 'reports_rental_comparisons'])
    // R12 000 × 1.08 × 1.08 = R13 996,80 expected at 1 Sep 2026; R12 960 billed.
    expect(report.data.rows).toHaveLength(1)
    expect(report.data.rows[0]).toMatchObject({
      source: 'event', eventId: 'e1', current: true, expected: 13996.8, billed: 12960, difference: 1036.8, withinTolerance: false, statementId: 's1',
    })
    expect(report.data).toMatchObject({ totalMonthlyDifference: 1036.8, leasesCompared: 1, unverifiedLeasesExcluded: 1, openEventCount: 1 })
  })

  it('falls back to an exact comparison when the rule config does not parse', async () => {
    const { db } = dbAnswering({
      reports_rental_comparisons: { data: LEASE_ROWS, error: null },
      reports_discrepancy_rule: { data: [{ enabled: true, config: { kind: 'rental_escalation_discrepancy', toleranceRands: 'lots' } }], error: null },
    })
    const report = await service.rentalDiscrepancies(db, COMPANY, { status: ['outside_tolerance'] }, NOW)
    expect(report.data.rows[0]).toMatchObject({ source: 'recomputed', withinTolerance: false })
    expect(report.data.recomputedCount).toBe(1)
  })

  it('answers 403 when the database refuses the company, and fails loudly on rows of an unexpected shape', async () => {
    const refused = dbAnswering({ reports_rental_comparisons: { data: null, error: { code: '42501', message: 'Only members of the company can read its reports' } } })
    await expect(service.rentalDiscrepancies(refused.db, COMPANY, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException)
    const odd = dbAnswering({ reports_monitoring_events: { data: [{ event_id: 'e1', event_type: 'unknown' }], error: null } })
    await expect(service.leaseMonitoring(odd.db, COMPANY, {}, NOW)).rejects.toBeInstanceOf(InternalServerErrorException)
  })
})
