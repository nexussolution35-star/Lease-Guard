import { BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common'
import type { DbClient } from '@leaseguard/service-kit'
import { describe, expect, it } from 'vitest'

import { ArrearsReportDataService } from './arrears-report-data.service'
import { ArrearsReportsService } from './arrears-reports.service'
import { ReportDataService } from './report-data.service'

const COMPANY = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d'
// 21 Nov 2026, 10:00 in Johannesburg.
const NOW = new Date('2026-11-21T08:00:00Z')

const ARREARS_ROWS = [
  {
    tenant_id: 't1', tenant_name: 'Dlamini Cellular', property_id: 'p1', property_name: 'Maponya Square', unit_id: 'u1', unit_number: 'S01',
    lease_id: 'l1', lease_reference: 'MSQ-L001', statement_id: 's1', statement_date: '2026-09-30', outstanding: '12960.00',
  },
  {
    tenant_id: 't2', tenant_name: 'Fresh Mart', property_id: 'p1', property_name: 'Maponya Square', unit_id: null, unit_number: null,
    lease_id: 'l2', lease_reference: 'MSQ-L002', statement_id: 's2', statement_date: '2026-11-15', outstanding: 0,
  },
]

const ARRANGEMENT_ROWS = [
  {
    arrangement_id: 'a1', tenant_id: 't1', tenant_name: 'Dlamini Cellular', property_id: 'p1', property_name: 'Maponya Square', unit_id: 'u1',
    unit_number: 'S01', lease_id: 'l1', lease_reference: 'MSQ-L001', status: 'active', frequency: 'monthly', installment_amount: 2000,
    outstanding_balance: 6000, first_installment_date: '2026-11-15', final_installment_date: '2027-01-15', agreed_on: '2026-11-01', closed_on: null,
    suppress_arrears_reminders: true,
    installments: [
      { id: 'i1', sequence: 1, dueDate: '2026-11-15', amount: 2000, status: 'scheduled' },
      { id: 'i2', sequence: 2, dueDate: '2026-12-15', amount: 2000, status: 'scheduled' },
      { id: 'i3', sequence: 3, dueDate: '2027-01-15', amount: 2000, status: 'scheduled' },
    ],
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

const settings = (arrears: unknown, attention: unknown): Answer => ({ data: [{ arrears_config: arrears, arrangement_attention_config: attention }], error: null })

const service = new ArrearsReportsService(new ArrearsReportDataService(new ReportDataService()))

describe('ArrearsReportsService.arrears', () => {
  it('ages the latest verified balances into the company buckets and marks the tenant under arrangement', async () => {
    const { db, calls } = dbAnswering({
      reports_arrears_detail: { data: ARREARS_ROWS, error: null },
      reports_payment_arrangements: { data: ARRANGEMENT_ROWS, error: null },
      reports_arrears_settings: settings({ kind: 'arrears', minimumBalanceRands: 0, ageingBucketsDays: [30, 60] }, null),
    })
    const report = await service.arrears(db, COMPANY, {}, NOW)
    expect(calls.sort()).toEqual(['reports_arrears_detail', 'reports_arrears_settings', 'reports_payment_arrangements'])
    expect(report).toMatchObject({ reportId: 'arrears', asOf: '2026-11-21', filters: {} })
    expect(report.data.ageingBuckets).toEqual([30, 60])
    expect(report.data.rows).toEqual([
      expect.objectContaining({ statementId: 's1', unitNumber: 'S01', outstanding: 12960, ageDays: 52, bucket: '30', underArrangement: true, remindersSuppressed: true, arrangementId: 'a1' }),
    ])
    expect(report.data.buckets.map((bucket) => [bucket.bucket, bucket.amount])).toEqual([
      ['current', 0],
      ['30', 12960],
      ['60+', 0],
    ])
  })

  it('uses the default buckets when the rule is missing or does not parse, and applies the arrangement filter', async () => {
    const { db } = dbAnswering({
      reports_arrears_detail: { data: ARREARS_ROWS, error: null },
      reports_payment_arrangements: { data: ARRANGEMENT_ROWS, error: null },
      reports_arrears_settings: settings({ kind: 'arrears', ageingBucketsDays: 'thirty' }, null),
    })
    const report = await service.arrears(db, COMPANY, { status: ['no_arrangement'] }, NOW)
    expect(report.data.ageingBuckets).toEqual([30, 60, 90, 120])
    expect(report.filters).toEqual({ statuses: ['no_arrangement'] })
    expect(report.data.rows).toEqual([])
  })

  it('refuses a status the report does not offer (400) and another company (403)', async () => {
    await expect(service.arrears(dbAnswering({}).db, COMPANY, { status: ['active'] }, NOW)).rejects.toBeInstanceOf(BadRequestException)
    const refused: Answer = { data: null, error: { code: '42501', message: 'Only members of the company can read its reports' } }
    await expect(service.arrears(dbAnswering({ reports_arrears_detail: refused }).db, COMPANY, {}, NOW)).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('ArrearsReportsService.paymentArrangements', () => {
  it('reports schedule progress with the company grace days', async () => {
    const answers = (graceDays: number) =>
      dbAnswering({
        reports_payment_arrangements: { data: ARRANGEMENT_ROWS, error: null },
        reports_arrears_settings: settings(null, { kind: 'arrangement_attention', graceDays }),
      }).db
    const strict = await service.paymentArrangements(answers(0), COMPANY, {}, NOW)
    expect(strict.data).toMatchObject({ graceDays: 0, activeCount: 1, overdueInstallments: 1, outstandingUnderArrangement: 6000 })
    expect(strict.data.rows[0]).toMatchObject({ arrangementId: 'a1', paidCount: 0, totalCount: 3, nextDueDate: '2026-12-15' })
    const lenient = await service.paymentArrangements(answers(7), COMPANY, { from: '2026-11-01', status: ['active'] }, NOW)
    expect(lenient.data.overdueInstallments).toBe(0)
    expect(lenient.filters).toEqual({ from: '2026-11-01', statuses: ['active'] })
  })

  it('fails loudly on instalments of an unexpected shape rather than reporting wrong figures', async () => {
    const broken = [{ ...ARRANGEMENT_ROWS[0], installments: [{ id: 'i1', sequence: 1, dueDate: '2026-11-15', amount: 2000, status: 'paid' }] }]
    const { db } = dbAnswering({ reports_payment_arrangements: { data: broken, error: null } })
    await expect(service.paymentArrangements(db, COMPANY, {}, NOW)).rejects.toBeInstanceOf(InternalServerErrorException)
  })
})
