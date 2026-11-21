import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { REPORT_CATALOGUE, type ReportEnvelope } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { ReportsSource } from '../api/source'
import type { ReportSearch } from '../reportSearch'
import { ArrearsReportView } from './ArrearsReportView'
import { PaymentArrangementsReportView } from './PaymentArrangementsReportView'

const fakeSource = vi.hoisted(() => ({ catalogue: vi.fn(), report: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getReportsSource: () => fakeSource as unknown as ReportsSource }))
const fakeProperties = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
const download = vi.hoisted(() => vi.fn())
vi.mock('../csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../csv')>()), downloadCsv: download }))

const PROPERTY_ID = '3a1b2c3d-4e5f-4061-8728-394a5b6c7d8e'

const ARREARS: ReportEnvelope<'arrears'> = {
  reportId: 'arrears',
  asOf: '2026-11-21',
  filters: {},
  data: {
    ageingBuckets: [30, 60],
    totalOutstanding: 15960,
    tenantCount: 2,
    tenantsUnderArrangement: 1,
    tenantsWithRemindersSuppressed: 1,
    outstandingUnderArrangement: 12960,
    buckets: [
      { bucket: 'current', description: '0–29 days', amount: 3000, tenantCount: 1 },
      { bucket: '30', description: '30–59 days', amount: 12960, tenantCount: 1 },
      { bucket: '60+', description: '60 days or more', amount: 0, tenantCount: 0 },
    ],
    rows: [
      {
        tenantId: 't1', tenantName: 'Dlamini Cellular', propertyId: PROPERTY_ID, propertyName: 'Maponya Square', unitId: 'u1', unitNumber: 'S01',
        leaseId: 'l1', leaseReference: 'MSQ-L001', statementId: 's1', statementDate: '2026-09-30', outstanding: 12960, ageDays: 52, bucket: '30',
        underArrangement: true, remindersSuppressed: true, arrangementId: 'a1',
      },
      {
        tenantId: 't2', tenantName: 'Fresh Mart', propertyId: PROPERTY_ID, propertyName: 'Maponya Square', leaseId: 'l2', leaseReference: 'MSQ-L002',
        statementId: 's2', statementDate: '2026-11-15', outstanding: 3000, ageDays: 6, bucket: 'current', underArrangement: false, remindersSuppressed: false,
      },
    ],
  },
}

const ARRANGEMENTS: ReportEnvelope<'payment_arrangements'> = {
  reportId: 'payment_arrangements',
  asOf: '2026-11-21',
  filters: {},
  data: {
    graceDays: 3,
    countsByStatus: { proposed: 0, active: 1, completed: 0, defaulted: 0, cancelled: 1 },
    activeCount: 1,
    outstandingUnderArrangement: 4000,
    paidToDate: 2000,
    missedInstallments: 0,
    overdueInstallments: 1,
    rows: [
      {
        arrangementId: 'a1', tenantId: 't1', tenantName: 'Dlamini Cellular', propertyId: PROPERTY_ID, propertyName: 'Maponya Square', unitId: 'u1',
        unitNumber: 'S01', leaseId: 'l1', leaseReference: 'MSQ-L001', status: 'active', frequency: 'monthly', installmentAmount: 2000,
        agreedOn: '2026-09-15', finalInstallmentDate: '2026-12-15', suppressArrearsReminders: true, outstandingBalance: 6000, paid: 2000,
        remaining: 4000, paidCount: 1, totalCount: 3, missedCount: 0, overdueCount: 1, nextDueDate: '2026-12-15', nextAmount: 2000,
      },
      {
        arrangementId: 'a2', tenantId: 't2', tenantName: 'Fresh Mart', propertyId: PROPERTY_ID, propertyName: 'Maponya Square', unitId: 'u2',
        unitNumber: 'S02', leaseId: 'l2', leaseReference: 'MSQ-L002', status: 'cancelled', frequency: 'weekly', installmentAmount: 500,
        agreedOn: '2026-08-01', finalInstallmentDate: '2026-09-26', closedOn: '2026-08-20', suppressArrearsReminders: true, outstandingBalance: 4000,
        paid: 0, remaining: 4000, paidCount: 0, totalCount: 8, missedCount: 0, overdueCount: 0,
      },
    ],
  },
}

const definitionOf = (id: string) => {
  const definition = REPORT_CATALOGUE.find((report) => report.id === id)
  if (!definition) throw new Error(id)
  return definition
}

const VIEWS = { arrears: ArrearsReportView, payment_arrangements: PaymentArrangementsReportView }

async function renderReport(id: keyof typeof VIEWS, search: ReportSearch = {}, onSearchChange = vi.fn()) {
  const View = VIEWS[id]
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <View definition={definitionOf(id)} search={search} onSearchChange={onSearchChange} />
    </QueryClientProvider>,
    `/reports/${id}`,
  )
  return onSearchChange
}

const csvLines = () => (download.mock.calls[0] as [string, string])[1].trim().split('\r\n')

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.report.mockReset().mockImplementation(async (_companyId: string, id: string) => (id === 'arrears' ? ARREARS : ARRANGEMENTS))
  fakeProperties.list.mockReset().mockResolvedValue({ items: [{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Maponya Square' }], total: 1, page: 1, pageSize: 100 })
  download.mockReset()
})

describe('Arrears ageing', () => {
  it('shows the outstanding per tenant and unit, aged, with the arrangement in force and its suppression', async () => {
    await renderReport('arrears')
    const table = await screen.findByRole('table', { name: 'Accounts in arrears' })
    expect(screen.getByText(/As at/)).toHaveTextContent('As at 21 Nov 2026')
    const dlamini = within(table).getByRole('row', { name: /Dlamini Cellular/ })
    expect(dlamini).toHaveTextContent(/R\s?12\s?960,00/)
    expect(dlamini).toHaveTextContent('52 days')
    expect(dlamini).toHaveTextContent('Arrears reminders paused')
    expect(within(dlamini).getByRole('link', { name: 'Dlamini Cellular' })).toHaveAttribute('href', '/tenants/t1')
    expect(within(dlamini).getByRole('link', { name: 'Unit S01' })).toHaveAttribute('href', '/units/u1')
    expect(within(dlamini).getByRole('link', { name: 'MSQ-L001' })).toHaveAttribute('href', '/leases/l1')
    expect(within(dlamini).getByRole('link', { name: '30 Sep 2026' })).toHaveAttribute('href', '/statements/s1')
    expect(within(dlamini).getByRole('link', { name: 'Under arrangement' })).toHaveAttribute('href', '/arrangements/a1')
    const fresh = within(table).getByRole('row', { name: /Fresh Mart/ })
    expect(within(fresh).queryByText('Under arrangement')).toBeNull()

    const buckets = screen.getByRole('table', { name: 'Outstanding by ageing bucket' })
    expect(within(buckets).getByRole('row', { name: /^30 days/ })).toHaveTextContent('30–59 days')
    expect(within(buckets).getByRole('row', { name: /^60\+ days/ })).toBeInTheDocument()
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'arrears', {})
  })

  it('offers no payment action anywhere', async () => {
    await renderReport('arrears')
    await screen.findByRole('table', { name: 'Accounts in arrears' })
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).not.toContainEqual(expect.stringMatching(/pay/i))
  })

  it('exports the accounts shown as CSV', async () => {
    await renderReport('arrears')
    await screen.findByRole('table', { name: 'Accounts in arrears' })
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(download.mock.calls[0]?.[0]).toBe('leaseguard-arrears-2026-11-21.csv')
    expect(csvLines()).toEqual([
      'Tenant,Property,Unit,Lease,Statement date,Outstanding (ZAR),Age (days),Ageing bucket,Under arrangement,Reminders paused',
      'Dlamini Cellular,Maponya Square,S01,MSQ-L001,2026-09-30,12960.00,52,30 days,Yes,Yes',
      'Fresh Mart,Maponya Square,,MSQ-L002,2026-11-15,3000.00,6,Current,No,No',
    ])
  })

  it('filters by arrangement through the URL, without a date range', async () => {
    const onSearchChange = await renderReport('arrears', { status: ['under_arrangement'] })
    await screen.findByRole('table', { name: 'Accounts in arrears' })
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'arrears', { statuses: ['under_arrangement'] })
    const group = screen.getByRole('group', { name: 'Report filters' })
    expect(within(group).getByRole('button', { name: /^Arrangement, 1 selected/ })).toBeInTheDocument()
    expect(within(group).queryByRole('button', { name: /date/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Under arrangement' }))
    expect(onSearchChange).toHaveBeenLastCalledWith({ status: undefined })
  })

  it('says when no verified statement shows a balance', async () => {
    fakeSource.report.mockResolvedValueOnce({ ...ARREARS, data: { ...ARREARS.data, rows: [] } })
    await renderReport('arrears')
    expect(await screen.findByText('No arrears')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })
})

describe('Payment arrangements', () => {
  it('lists active and ended arrangements with schedule progress, missed and overdue instalments, each linking to its record', async () => {
    await renderReport('payment_arrangements')
    const table = await screen.findByRole('table', { name: 'Payment arrangements' })
    const active = within(table).getByRole('row', { name: /Dlamini Cellular/ })
    expect(within(active).getByRole('link', { name: 'Dlamini Cellular' })).toHaveAttribute('href', '/arrangements/a1')
    expect(active).toHaveTextContent('1 of 3 paid')
    expect(within(active).getByRole('progressbar', { name: 'Instalments paid, Dlamini Cellular' })).toBeInTheDocument()
    expect(active).toHaveTextContent('15 Dec 2026')
    const cancelled = within(table).getByRole('row', { name: /Fresh Mart/ })
    expect(cancelled).toHaveTextContent('Cancelled')
    expect(cancelled).toHaveTextContent('Closed 20 Aug 2026')
    expect(screen.getByText('Overdue instalments')).toBeInTheDocument()
    expect(screen.getByText('Open 3 days past the due date')).toBeInTheDocument()
  })

  it('offers the arrangement statuses and the agreement date range, read from the URL', async () => {
    await renderReport('payment_arrangements', { status: ['active'], from: '2026-09-01' })
    await screen.findByRole('table', { name: 'Payment arrangements' })
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'payment_arrangements', { from: '2026-09-01', statuses: ['active'] })
    const group = screen.getByRole('group', { name: 'Report filters' })
    expect(within(group).getByRole('button', { name: /^Arrangement status/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove filter: Agreed on/ })).toBeInTheDocument()
  })

  it('exports the arrangements shown as CSV', async () => {
    await renderReport('payment_arrangements')
    await screen.findByRole('table', { name: 'Payment arrangements' })
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    const lines = csvLines()
    expect(lines[0]).toBe(
      'Tenant,Property,Unit,Lease,Status,Agreed on,Closed on,Frequency,Instalment (ZAR),Balance agreed (ZAR),Paid (ZAR),Remaining (ZAR),Instalments paid,Instalments,Missed,Overdue,Next due,Next amount (ZAR),Arrears reminders paused',
    )
    expect(lines.slice(1)).toEqual([
      'Dlamini Cellular,Maponya Square,S01,MSQ-L001,Active,2026-09-15,,Monthly,2000.00,6000.00,2000.00,4000.00,1,3,0,1,2026-12-15,2000.00,Yes',
      'Fresh Mart,Maponya Square,S02,MSQ-L002,Cancelled,2026-08-01,2026-08-20,Weekly,500.00,4000.00,0.00,4000.00,0,8,0,0,,,Yes',
    ])
  })
})
