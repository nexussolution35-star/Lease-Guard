import { BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common'
import type { DbClient } from '@leaseguard/service-kit'
import { describe, expect, it } from 'vitest'

import { ReportDataService } from './report-data.service'
import { SecurityReportDataService } from './security-report-data.service'
import { SecurityReportsService } from './security-reports.service'

const COMPANY = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d'
// 21 Nov 2026, 10:00 in Johannesburg.
const NOW = new Date('2026-11-21T08:00:00Z')

/** R35 000 at 8% a year from 01 Mar 2026, a R105 000 guarantee sized at three months and a R70 000 two-month deposit. */
const leaseRow = (patch: Record<string, unknown> = {}) => ({
  lease_id: 'l1',
  reference: 'MSQ-L001',
  lease_status: 'active',
  verified: true,
  tenant_id: 't1',
  tenant_name: 'Marula Optometrists',
  property_id: 'p1',
  property_name: 'Maponya Square',
  unit_id: 'u1',
  unit_number: 'S01',
  commencement_date: '2025-03-01',
  expiry_date: '2029-02-28',
  initial_monthly_rental: '35000.00',
  escalation_type: 'percentage',
  escalation_percentage: '8.000',
  escalation_fixed_amount: null,
  escalation_cpi_assumed_percentage: null,
  escalation_cpi_margin_percentage: null,
  escalation_frequency: 'annual',
  first_escalation_date: '2026-03-01',
  deposit_amount: '70000.00',
  deposit_basis_months: '2.00',
  deposit_held_by: 'landlord',
  deposit_interest_bearing: true,
  guarantee_bank: 'Standard Bank',
  guarantee_reference: 'BG-1',
  guarantee_amount: '105000.00',
  guarantee_basis_months: '3.00',
  guarantee_issued_on: '2025-03-01',
  guarantee_expires_on: '2026-12-15',
  guarantee_status: 'active',
  ...patch,
})

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

const notice = (company: number[], rule: unknown = null): Answer => ({ data: [{ company_notice_days: company, rule_notice_days: rule }], error: null })

const service = new SecurityReportsService(new SecurityReportDataService(new ReportDataService()))

describe('SecurityReportsService.depositsGuarantees', () => {
  it('works out the cover after escalation and the expiry state with the company notice days', async () => {
    const { db, calls } = dbAnswering({
      reports_lease_security: {
        data: [leaseRow(), leaseRow({ lease_id: 'l2', reference: 'MSQ-L002', verified: false, lease_status: 'pending_verification' })],
        error: null,
      },
      reports_guarantee_notice_days: notice([90, 30]),
    })
    const report = await service.depositsGuarantees(db, COMPANY, {}, NOW)

    expect(calls.sort()).toEqual(['reports_guarantee_notice_days', 'reports_lease_security'])
    expect(report).toMatchObject({ reportId: 'deposits_guarantees', asOf: '2026-11-21', filters: {} })
    expect(report.data.rows).toHaveLength(1)
    expect(report.data.rows[0]).toMatchObject({
      leaseId: 'l1',
      expectedMonthlyRental: 37_800,
      guaranteeRequired: 113_400,
      guaranteeShortfall: 8_400,
      depositRequired: 75_600,
      depositShortfall: 5_600,
      guaranteeState: 'expiring',
      guaranteeDaysUntilExpiry: 24,
      needsAttention: true,
    })
    expect(report.data).toMatchObject({ unverifiedLeasesExcluded: 1, expiringGuarantees: 1, guaranteeNoticeDays: [90, 30], totalGuarantees: 105_000 })
  })

  it('uses the guarantee expiry rule\'s notice days, as lease monitoring does', async () => {
    const { db } = dbAnswering({ reports_lease_security: { data: [leaseRow()], error: null }, reports_guarantee_notice_days: notice([90, 30], [14]) })
    const report = await service.depositsGuarantees(db, COMPANY, {}, NOW)
    expect(report.data.guaranteeNoticeDays).toEqual([14])
    expect(report.data.rows[0]?.guaranteeState).toBe('active')
  })

  it('applies the guarantee state and expiry range filters and states them back', async () => {
    const { db } = dbAnswering({
      reports_lease_security: { data: [leaseRow(), leaseRow({ lease_id: 'l3', reference: 'MSQ-L003', guarantee_expires_on: '2029-05-31' })], error: null },
      reports_guarantee_notice_days: notice([90, 30]),
    })
    const report = await service.depositsGuarantees(db, COMPANY, { status: ['active'], from: '2027-01-01' }, NOW)
    expect(report.filters).toEqual({ statuses: ['active'], from: '2027-01-01' })
    expect(report.data.rows.map((row) => row.leaseId)).toEqual(['l3'])
  })

  it('refuses a status the report does not offer', async () => {
    const { db } = dbAnswering({})
    await expect(service.depositsGuarantees(db, COMPANY, { status: ['vacant'] }, NOW)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('answers 403 when the database refuses the company, and fails loudly on rows of an unexpected shape', async () => {
    const refused = dbAnswering({ reports_lease_security: { data: null, error: { code: '42501', message: 'Only members of the company can read its reports' } } })
    await expect(service.depositsGuarantees(refused.db, COMPANY, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException)
    const odd = dbAnswering({ reports_lease_security: { data: [leaseRow({ guarantee_status: 'lost' })], error: null }, reports_guarantee_notice_days: notice([90, 30]) })
    await expect(service.depositsGuarantees(odd.db, COMPANY, {}, NOW)).rejects.toBeInstanceOf(InternalServerErrorException)
  })
})
