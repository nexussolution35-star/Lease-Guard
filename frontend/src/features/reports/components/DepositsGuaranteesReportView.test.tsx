import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { REPORT_CATALOGUE, type ReportEnvelope, type ReportFilters } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { ReportsSource } from '../api/source'
import type { ReportSearch } from '../reportSearch'
import { DepositsGuaranteesReportView } from './DepositsGuaranteesReportView'

const fakeSource = vi.hoisted(() => ({ catalogue: vi.fn(), report: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getReportsSource: () => fakeSource as unknown as ReportsSource }))
const fakeProperties = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
const download = vi.hoisted(() => vi.fn())
vi.mock('../csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../csv')>()), downloadCsv: download }))

const PROPERTY_ID = '3a1b2c3d-4e5f-4061-8728-394a5b6c7d8e'

const REPORT: ReportEnvelope<'deposits_guarantees'> = {
  reportId: 'deposits_guarantees',
  asOf: '2026-11-21',
  filters: {},
  data: {
    totalDeposits: 70_000,
    totalGuarantees: 165_000,
    depositShortfallTotal: 5_600,
    guaranteeShortfallTotal: 8_400,
    leasesWithShortfall: 1,
    expiringGuarantees: 1,
    expiredGuarantees: 0,
    guaranteeNoticeDays: [90, 30],
    unverifiedLeasesExcluded: 2,
    rows: [
      {
        leaseId: 'l1',
        reference: 'MSQ-L001',
        tenantId: 't1',
        tenantName: 'Marula Optometrists',
        propertyId: PROPERTY_ID,
        propertyName: 'Maponya Square',
        unitId: 'u1',
        unitNumber: 'S01',
        expectedMonthlyRental: 37_800,
        depositAmount: 70_000,
        depositHeldBy: 'landlord',
        depositBasisMonths: 2,
        depositRequired: 75_600,
        depositShortfall: 5_600,
        guaranteeBank: 'Standard Bank',
        guaranteeReference: 'BG-1',
        guaranteeAmount: 105_000,
        guaranteeBasisMonths: 3,
        guaranteeRequired: 113_400,
        guaranteeShortfall: 8_400,
        guaranteeExpiresOn: '2029-05-31',
        guaranteeState: 'active',
        guaranteeDaysUntilExpiry: 922,
        needsAttention: true,
      },
      {
        leaseId: 'l2',
        reference: 'MSQ-L002',
        tenantId: 't2',
        tenantName: 'Quagga Cycles',
        propertyId: PROPERTY_ID,
        propertyName: 'Maponya Square',
        unitId: 'u2',
        unitNumber: 'S02',
        expectedMonthlyRental: 20_000,
        depositShortfall: 0,
        guaranteeBank: 'Absa',
        guaranteeReference: 'BG-2',
        guaranteeAmount: 60_000,
        guaranteeBasisMonths: 3,
        guaranteeRequired: 60_000,
        guaranteeShortfall: 0,
        guaranteeExpiresOn: '2026-11-30',
        guaranteeState: 'expiring',
        guaranteeDaysUntilExpiry: 9,
        needsAttention: true,
      },
    ],
  },
}

const definition = REPORT_CATALOGUE.find((report) => report.id === 'deposits_guarantees')!

async function renderReport(search: ReportSearch = {}, onSearchChange = vi.fn()) {
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <DepositsGuaranteesReportView definition={definition} search={search} onSearchChange={onSearchChange} />
    </QueryClientProvider>,
    '/reports/deposits_guarantees',
  )
  return onSearchChange
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.report.mockReset().mockResolvedValue(REPORT)
  fakeProperties.list.mockReset().mockResolvedValue({ items: [{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Maponya Square' }], total: 1, page: 1, pageSize: 100 })
  download.mockReset()
})

describe('Deposits and guarantees', () => {
  it('shows each lease\'s cover from the API, linked to its records, with short and expiring guarantees marked', async () => {
    await renderReport()
    const table = await screen.findByRole('table', { name: 'Deposits and guarantees by lease' })
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'deposits_guarantees', {})
    expect(screen.getByText(/As at/)).toHaveTextContent('As at 21 Nov 2026')

    const short = within(table).getByRole('row', { name: /MSQ-L001/ })
    expect(within(short).getByRole('link', { name: 'MSQ-L001' })).toHaveAttribute('href', '/leases/l1')
    expect(within(short).getByRole('link', { name: 'Marula Optometrists' })).toHaveAttribute('href', '/tenants/t1')
    expect(within(short).getByRole('link', { name: 'Unit S01' })).toHaveAttribute('href', '/units/u1')
    expect(short).toHaveTextContent(/R\s?113\s?400,00 required/)
    expect(short).toHaveTextContent(/R\s?8\s?400,00/)
    expect(short).toHaveTextContent('Needs attention')
    expect(short).toHaveTextContent('31 May 2029')

    const expiring = within(table).getByRole('row', { name: /MSQ-L002/ })
    expect(expiring).toHaveTextContent('Expiring')
    expect(expiring).toHaveTextContent('In 9 days')
    // No deposit on this lease: its deposit cells read "None".
    expect(within(expiring).getAllByText('None', { selector: '.sr-only' }).length).toBeGreaterThan(0)

    expect(screen.getByText('Guarantee shortfall')).toBeInTheDocument()
    expect(screen.getByText(/2 leases with a deposit or guarantee are not\s+listed/)).toBeInTheDocument()
  })

  it('exports exactly the rows shown as CSV, amounts in rand and dates ISO', async () => {
    await renderReport()
    await screen.findByRole('table', { name: 'Deposits and guarantees by lease' })
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    const [fileName, csv] = download.mock.calls[0] as [string, string]
    expect(fileName).toBe('leaseguard-deposits-guarantees-2026-11-21.csv')
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe(
      'Property,Lease,Tenant,Unit,Expected monthly rental (ZAR),Deposit held (ZAR),Deposit held by,Deposit basis (months),Deposit required (ZAR),Deposit shortfall (ZAR),' +
        'Guarantee bank,Guarantee reference,Guarantee amount (ZAR),Guarantee basis (months),Guarantee required (ZAR),Guarantee shortfall (ZAR),Guarantee expiry,Guarantee state,Days until expiry,Needs attention',
    )
    expect(lines.slice(1)).toEqual([
      'Maponya Square,MSQ-L001,Marula Optometrists,S01,37800.00,70000.00,Landlord,2,75600.00,5600.00,Standard Bank,BG-1,105000.00,3,113400.00,8400.00,2029-05-31,Active,922,Yes',
      'Maponya Square,MSQ-L002,Quagga Cycles,S02,20000.00,,,,,,Absa,BG-2,60000.00,3,60000.00,0.00,2026-11-30,Expiring,9,Yes',
    ])
  })

  it('offers the guarantee states and the guarantee expiry range as filters, kept in the URL', async () => {
    const onSearchChange = await renderReport({ propertyId: [PROPERTY_ID], status: ['expiring'], from: '2026-11-01', to: '2026-12-31' })
    await screen.findByRole('table', { name: 'Deposits and guarantees by lease' })
    const filters: ReportFilters = { propertyIds: [PROPERTY_ID], from: '2026-11-01', to: '2026-12-31', statuses: ['expiring'] }
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'deposits_guarantees', filters)

    const group = screen.getByRole('group', { name: 'Report filters' })
    expect(within(group).getByRole('button', { name: 'Guarantee, 1 selected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter: Guarantee expiry: 01 Nov 2026 – 31 Dec 2026' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Expiring' }))
    expect(onSearchChange).toHaveBeenLastCalledWith({ propertyId: [PROPERTY_ID], status: undefined, from: '2026-11-01', to: '2026-12-31' })
  })

  it('shows an empty state when no verified lease carries a deposit or guarantee', async () => {
    fakeSource.report.mockResolvedValueOnce({ ...REPORT, data: { ...REPORT.data, rows: [] } })
    await renderReport()
    expect(await screen.findByText('No deposits or guarantees')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })
})
