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
import { ReportScreen } from './ReportScreen'

const fakeSource = vi.hoisted(() => ({ catalogue: vi.fn(), report: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getReportsSource: () => fakeSource as unknown as ReportsSource }))
const fakeProperties = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
const download = vi.hoisted(() => vi.fn())
vi.mock('../csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../csv')>()), downloadCsv: download }))

const PROPERTY_ID = '3a1b2c3d-4e5f-4061-8728-394a5b6c7d8e'

const EXPIRY: ReportEnvelope<'lease_expiry'> = {
  reportId: 'lease_expiry',
  asOf: '2026-11-21',
  filters: {},
  data: {
    buckets: [
      { bucket: 'expired', count: 1, monthlyRental: 9000 },
      { bucket: 'months_0_3', count: 1, monthlyRental: 12960 },
      { bucket: 'months_3_6', count: 0, monthlyRental: 0 },
      { bucket: 'months_6_12', count: 0, monthlyRental: 0 },
      { bucket: 'later', count: 0, monthlyRental: 0 },
    ],
    rows: [
      {
        leaseId: 'l0',
        reference: 'WIP-L003',
        tenantId: 't2',
        tenantName: 'Kasi Flame Grill',
        propertyId: PROPERTY_ID,
        propertyName: 'Maponya Square',
        unitId: 'u2',
        unitNumber: 'S02',
        expiryDate: '2026-11-01',
        daysUntilExpiry: -20,
        bucket: 'expired',
        monthlyRental: 9000,
        renewalOptionAvailable: false,
      },
      {
        leaseId: 'l1',
        reference: 'MSQ-L001',
        tenantId: 't1',
        tenantName: 'Dlamini Cellular',
        propertyId: PROPERTY_ID,
        propertyName: 'Maponya Square',
        unitId: 'u1',
        unitNumber: 'S01',
        expiryDate: '2026-12-15',
        daysUntilExpiry: 24,
        bucket: 'months_0_3',
        monthlyRental: 12960,
        renewalOptionAvailable: true,
        noticeThreshold: 30,
        openEventId: 'e1',
      },
    ],
    expiredCount: 1,
    withinNoticeCount: 1,
    noticeDays: [180, 90, 30],
    unverifiedLeasesExcluded: 2,
  },
}

const RENEWALS: ReportEnvelope<'renewal_deadlines'> = {
  reportId: 'renewal_deadlines',
  asOf: '2026-11-21',
  filters: {},
  data: {
    rows: [
      {
        leaseId: 'l3',
        reference: 'DVC-L003',
        tenantId: 't3',
        tenantName: 'Fresh Mart',
        propertyId: PROPERTY_ID,
        propertyName: 'Maponya Square',
        unitNumber: 'S03',
        expiryDate: '2027-01-31',
        noticePeriodMonths: 3,
        deadline: '2026-10-31',
        daysUntilDeadline: -21,
        status: 'passed',
      },
      {
        leaseId: 'l1',
        reference: 'MSQ-L001',
        tenantId: 't1',
        tenantName: 'Dlamini Cellular',
        propertyId: PROPERTY_ID,
        propertyName: 'Maponya Square',
        unitNumber: 'S01',
        expiryDate: '2027-06-15',
        noticePeriodMonths: 6,
        deadline: '2026-12-15',
        daysUntilDeadline: 24,
        status: 'due_soon',
        warningThreshold: 30,
        openEventId: 'e2',
      },
    ],
    countsByStatus: { passed: 1, due_critical: 0, due_soon: 1, upcoming: 0, open: 0, exercised: 0 },
    requiringWarning: 1,
    warningDays: [90, 60, 30],
    missingNoticePeriod: 1,
    unverifiedLeasesExcluded: 0,
  },
}

const definitionOf = (id: string) => {
  const definition = REPORT_CATALOGUE.find((report) => report.id === id)
  if (!definition) throw new Error(id)
  return definition
}

async function renderReport(id: string, search: ReportSearch = {}, onSearchChange = vi.fn()) {
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <ReportScreen definition={definitionOf(id)} search={search} onSearchChange={onSearchChange} />
    </QueryClientProvider>,
    `/reports/${id}`,
  )
  return onSearchChange
}

const csvLines = () => (download.mock.calls[0] as [string, string])[1].trim().split('\r\n')

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.report.mockReset().mockImplementation(async (_companyId: string, id: string) => (id === 'renewal_deadlines' ? RENEWALS : EXPIRY))
  fakeProperties.list.mockReset().mockResolvedValue({ items: [{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Maponya Square' }], total: 1, page: 1, pageSize: 100 })
  download.mockReset()
})

describe('Lease expiry', () => {
  it('shows the leases by expiry bucket and lease by lease, each linking to its lease and open event', async () => {
    await renderReport('lease_expiry')
    const leases = await screen.findByRole('table', { name: 'Leases and their expiry' })
    expect(screen.getByText(/As at/)).toHaveTextContent('As at 21 Nov 2026')
    const soon = within(leases).getByRole('row', { name: /MSQ-L001/ })
    expect(within(soon).getByRole('link', { name: 'MSQ-L001' })).toHaveAttribute('href', '/leases/l1')
    expect(within(soon).getByRole('link', { name: 'Open event' })).toHaveAttribute('href', '/monitoring/e1')
    expect(soon).toHaveTextContent('15 Dec 2026')
    expect(soon).toHaveTextContent('24 days')
    expect(soon).toHaveTextContent('Within 3 months')
    expect(soon).toHaveTextContent(/R\s?12\s?960,00/)
    expect(within(leases).getByRole('row', { name: /WIP-L003/ })).toHaveTextContent('20 days ago')

    const buckets = screen.getByRole('table', { name: 'Leases by expiry' })
    expect(within(buckets).getAllByRole('row')).toHaveLength(6)
    expect(within(buckets).getByRole('row', { name: /6–12 months/ })).toHaveTextContent('0')
    expect(screen.getByText('Notice at 180, 90 and 30 days')).toBeInTheDocument()
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'lease_expiry', {})
  })

  it('exports exactly the rows shown as CSV, ISO dates and plain rand', async () => {
    await renderReport('lease_expiry')
    await screen.findByRole('table', { name: 'Leases and their expiry' })
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect((download.mock.calls[0] as [string, string])[0]).toBe('leaseguard-lease-expiry-2026-11-21.csv')
    expect(csvLines()).toEqual([
      'Lease,Tenant,Property,Unit,Expiry date,Days to expiry,Expiry,Monthly rental (ZAR),Renewal option available,Notice threshold reached (days),Open expiry event',
      'WIP-L003,Kasi Flame Grill,Maponya Square,S02,2026-11-01,-20,Expired,9000.00,No,,No',
      'MSQ-L001,Dlamini Cellular,Maponya Square,S01,2026-12-15,24,Within 3 months,12960.00,Yes,30,Yes',
    ])
  })

  it('offers the expiry buckets and the expiry date range as filters, kept in the URL', async () => {
    const onSearchChange = await renderReport('lease_expiry', { status: ['months_0_3'], from: '2026-11-01', to: '2027-02-28' })
    await screen.findByRole('table', { name: 'Leases and their expiry' })
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'lease_expiry', { statuses: ['months_0_3'], from: '2026-11-01', to: '2027-02-28' })
    const group = screen.getByRole('group', { name: 'Report filters' })
    expect(within(group).getByRole('button', { name: 'Expiry, 1 selected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter: Within 3 months' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Remove filter: Expiry date/ }))
    expect(onSearchChange).toHaveBeenLastCalledWith({ status: ['months_0_3'], from: undefined, to: undefined })
  })

  it('says why nothing is listed when the leases are waiting for verification', async () => {
    fakeSource.report.mockResolvedValueOnce({ ...EXPIRY, data: { ...EXPIRY.data, rows: [], unverifiedLeasesExcluded: 2 } })
    await renderReport('lease_expiry')
    expect(await screen.findByText('No verified leases to report')).toBeInTheDocument()
    expect(screen.getByText(/2 leases are waiting for verification/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })
})

describe('Renewal deadlines', () => {
  it('lists the notice deadlines soonest first with the days left, each linking to its lease and open event', async () => {
    await renderReport('renewal_deadlines')
    const table = await screen.findByRole('table', { name: 'Renewal notice deadlines' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('link')[0]?.textContent)).toEqual(['DVC-L003', 'MSQ-L001'])
    expect(rows[0]).toHaveTextContent('Deadline passed')
    expect(rows[0]).toHaveTextContent('21 days ago')
    expect(rows[1]).toHaveTextContent('15 Dec 2026')
    expect(rows[1]).toHaveTextContent('Due within 30 days')
    expect(within(rows[1]!).getByRole('link', { name: 'Open event' })).toHaveAttribute('href', '/monitoring/e2')
    expect(screen.getByText('Warnings at 90, 60 and 30 days')).toBeInTheDocument()
    expect(screen.getByText('No notice period')).toBeInTheDocument()
  })

  it('exports the deadlines as CSV', async () => {
    await renderReport('renewal_deadlines')
    await screen.findByRole('table', { name: 'Renewal notice deadlines' })
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(csvLines()).toEqual([
      'Lease,Tenant,Property,Unit,Expiry date,Notice period (months),Notice deadline,Days left,Status,Warning threshold reached (days),Open renewal event',
      'DVC-L003,Fresh Mart,Maponya Square,S03,2027-01-31,3,2026-10-31,-21,Deadline passed,,No',
      'MSQ-L001,Dlamini Cellular,Maponya Square,S01,2027-06-15,6,2026-12-15,24,Due within 30 days,30,Yes',
    ])
  })

  it('offers the deadline statuses and the notice deadline range as filters', async () => {
    await renderReport('renewal_deadlines', { status: ['due_critical', 'not_applicable'] })
    await screen.findByRole('table', { name: 'Renewal notice deadlines' })
    // A status the report does not offer is dropped from the URL state rather than sent.
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'renewal_deadlines', { statuses: ['due_critical'] })
    const group = screen.getByRole('group', { name: 'Report filters' })
    expect(within(group).getByRole('button', { name: 'Deadline, 1 selected' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: /Notice deadline/ })).toBeInTheDocument()
  })
})
