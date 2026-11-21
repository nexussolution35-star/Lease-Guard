import { BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common'
import type { DbClient } from '@leaseguard/service-kit'
import { describe, expect, it } from 'vitest'

import { LeaseDateReportDataService } from './lease-date-report-data.service'
import { LeaseDateReportsService } from './lease-date-reports.service'

const COMPANY = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d'
const PROPERTY = '3a1b2c3d-4e5f-4061-8728-394a5b6c7d8e'
// 12:00 on 21 Nov 2026 in South Africa.
const NOW = new Date('2026-11-21T10:00:00Z')

const leaseRow = (patch: Record<string, unknown>) => ({
  lease_id: 'l1',
  lease_reference: 'MSQ-L001',
  lease_status: 'active',
  verified: true,
  tenant_id: 't1',
  tenant_name: 'Dlamini Cellular',
  property_id: PROPERTY,
  property_name: 'Maponya Square',
  unit_id: 'u1',
  unit_number: 'S01',
  expiry_date: '2027-02-28',
  current_monthly_rental: '12960.00',
  renewal_option_exists: true,
  renewal_exercised: false,
  renewal_notice_period_months: 3,
  open_expiry_event_id: 'e1',
  open_renewal_event_id: null,
  ...patch,
})

type Answer = { data: unknown; error: { code: string; message: string } | null }

function dbAnswering(answers: Record<string, Answer>) {
  const calls: { fn: string; args: unknown }[] = []
  const db = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args })
      return answers[fn] ?? { data: [], error: null }
    },
  } as unknown as DbClient
  return { db, calls }
}

const SETTINGS: Answer = { data: [{ lease_expiry_notice_days: [180, 90, 30], renewal_warning_days: [90, 60, 30] }], error: null }

describe('LeaseDateReportsService', () => {
  const service = new LeaseDateReportsService(new LeaseDateReportDataService())

  it('puts the lease expiry report together from the reporting functions, as at the South African date', async () => {
    const { db, calls } = dbAnswering({
      reports_lease_dates: {
        data: [leaseRow({}), leaseRow({ lease_id: 'l2', lease_reference: 'WIP-L003', verified: false, lease_status: 'pending_verification' })],
        error: null,
      },
      reports_lease_date_settings: SETTINGS,
    })
    const report = await service.leaseExpiry(db, COMPANY, {}, NOW)
    expect(report).toMatchObject({ reportId: 'lease_expiry', asOf: '2026-11-21', filters: {} })
    expect(report.data.rows).toEqual([
      expect.objectContaining({ leaseId: 'l1', daysUntilExpiry: 99, bucket: 'months_3_6', monthlyRental: 12960, noticeThreshold: 180, openEventId: 'e1', renewalOptionAvailable: true }),
    ])
    expect(report.data.unverifiedLeasesExcluded).toBe(1)
    expect(calls.map((call) => call.fn).sort()).toEqual(['reports_lease_date_settings', 'reports_lease_dates'])
    expect(calls.every((call) => JSON.stringify(call.args) === JSON.stringify({ p_company_id: COMPANY }))).toBe(true)
  })

  it('puts the renewal deadlines report together with the deadline and the warning monitoring raises', async () => {
    const { db } = dbAnswering({ reports_lease_dates: { data: [leaseRow({})], error: null }, reports_lease_date_settings: SETTINGS })
    const report = await service.renewalDeadlines(db, COMPANY, { status: ['due_critical'] }, NOW)
    expect(report.filters).toEqual({ statuses: ['due_critical'] })
    // Expiry 28 Feb 2027 less 3 months: 28 Nov 2026, 7 days on.
    expect(report.data.rows).toEqual([expect.objectContaining({ deadline: '2026-11-28', daysUntilDeadline: 7, status: 'due_critical', warningThreshold: 30 })])
    expect(report.data.requiringWarning).toBe(1)
  })

  it('treats a rule switched off as no thresholds', async () => {
    const { db } = dbAnswering({
      reports_lease_dates: { data: [leaseRow({})], error: null },
      reports_lease_date_settings: { data: [{ lease_expiry_notice_days: null, renewal_warning_days: null }], error: null },
    })
    const report = await service.leaseExpiry(db, COMPANY, {}, NOW)
    expect(report.data.withinNoticeCount).toBe(0)
    expect(report.data.noticeDays).toEqual([])
  })

  it('refuses a status the report does not offer (400) before reading anything', async () => {
    const { db, calls } = dbAnswering({})
    await expect(service.leaseExpiry(db, COMPANY, { status: ['vacant'] }, NOW)).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.renewalDeadlines(db, COMPANY, { status: ['not_applicable'] }, NOW)).rejects.toBeInstanceOf(BadRequestException)
    expect(calls).toEqual([])
  })

  it('answers 403 when the database refuses the company, and fails loudly on rows of an unexpected shape', async () => {
    const refused = dbAnswering({ reports_lease_dates: { data: null, error: { code: '42501', message: 'Only members of the company can read its reports' } }, reports_lease_date_settings: SETTINGS })
    await expect(service.leaseExpiry(refused.db, COMPANY, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException)
    const odd = dbAnswering({ reports_lease_dates: { data: [{ lease_id: 'l1' }], error: null }, reports_lease_date_settings: SETTINGS })
    await expect(service.renewalDeadlines(odd.db, COMPANY, {}, NOW)).rejects.toBeInstanceOf(InternalServerErrorException)
    const noSettings = dbAnswering({ reports_lease_dates: { data: [], error: null }, reports_lease_date_settings: { data: [], error: null } })
    await expect(service.leaseExpiry(noSettings.db, COMPANY, {}, NOW)).rejects.toBeInstanceOf(InternalServerErrorException)
  })
})
