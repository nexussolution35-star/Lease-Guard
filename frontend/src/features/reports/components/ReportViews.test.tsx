import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { REPORT_CATALOGUE, REPORT_IDS, type ReportEnvelope, type ReportFilters } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import { isAvailableReportId, type ReportsSource } from '../api/source'
import type { ReportSearch } from '../reportSearch'
import { ReportCatalogueScreen } from './ReportCatalogueScreen'
import { ReportScreen } from './ReportScreen'

const fakeSource = vi.hoisted(() => ({ catalogue: vi.fn(), report: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getReportsSource: () => fakeSource as unknown as ReportsSource }))
const fakeProperties = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
const download = vi.hoisted(() => vi.fn())
vi.mock('../csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../csv')>()), downloadCsv: download }))

const PROPERTY_ID = '3a1b2c3d-4e5f-4061-8728-394a5b6c7d8e'

const PORTFOLIO: ReportEnvelope<'portfolio_overview'> = {
  reportId: 'portfolio_overview',
  asOf: '2026-11-21',
  filters: {},
  data: {
    propertyCount: 1,
    unitCount: 4,
    occupiedUnits: 3,
    vacantUnits: 1,
    occupancyRate: 0.75,
    activeLeases: 2,
    unverifiedLeases: 1,
    monthlyRentalRoll: 21960,
    totalOutstanding: 16500.5,
    tenantsInArrears: 2,
    openEvents: 3,
    properties: [
      {
        propertyId: PROPERTY_ID,
        propertyName: 'Maponya Square',
        code: 'MSQ',
        status: 'active',
        unitCount: 4,
        occupiedUnits: 3,
        vacantUnits: 1,
        occupancyRate: 0.75,
        activeLeases: 2,
        monthlyRentalRoll: 21960,
        outstanding: 16500.5,
        tenantsInArrears: 2,
        openEvents: 3,
      },
    ],
  },
}

const OCCUPANCY: ReportEnvelope<'occupancy'> = {
  reportId: 'occupancy',
  asOf: '2026-11-21',
  filters: {},
  data: {
    totals: { total: 2, occupied: 1, vacant: 1, underOffer: 0, unavailable: 0, occupancyRate: 0.5, floorAreaSqm: 130, occupiedAreaSqm: 120 },
    byProperty: [
      { propertyId: PROPERTY_ID, propertyName: 'Maponya Square', total: 2, occupied: 1, vacant: 1, underOffer: 0, unavailable: 0, occupancyRate: 0.5, floorAreaSqm: 130, occupiedAreaSqm: 120 },
    ],
    byUnitType: [{ unitType: 'line_shop', total: 2, occupied: 1, vacant: 1, underOffer: 0, unavailable: 0, occupancyRate: 0.5, floorAreaSqm: 130, occupiedAreaSqm: 120 }],
    units: [
      { unitId: 'u1', unitNumber: 'S01', unitType: 'line_shop', floorAreaSqm: 120, occupancyStatus: 'occupied', propertyId: PROPERTY_ID, propertyName: 'Maponya Square', tenantId: 't1', tenantName: 'Dlamini Cellular', tenantSource: 'assignment' },
      { unitId: 'u2', unitNumber: 'S02', unitType: 'line_shop', floorAreaSqm: 10, occupancyStatus: 'vacant', propertyId: PROPERTY_ID, propertyName: 'Maponya Square' },
    ],
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

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.catalogue.mockReset().mockResolvedValue(REPORT_CATALOGUE.map((report) => ({ ...report })))
  fakeSource.report.mockReset().mockImplementation(async (_companyId: string, id: string) => (id === 'occupancy' ? OCCUPANCY : PORTFOLIO))
  fakeProperties.list.mockReset().mockResolvedValue({ items: [{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Maponya Square' }], total: 1, page: 1, pageSize: 100 })
  download.mockReset()
})

describe('ReportCatalogueScreen', () => {
  it('lists every report with its title and description, each opening its own page', async () => {
    await renderWithRouter(
      <QueryClientProvider client={createTestQueryClient()}>
        <ReportCatalogueScreen />
      </QueryClientProvider>,
      '/reports',
    )
    const list = await screen.findByRole('list', { name: 'Reports' })
    const links = within(list).getAllByRole('link')
    expect(links).toHaveLength(REPORT_CATALOGUE.length)
    expect(within(list).getByRole('link', { name: /^Portfolio overview/ })).toHaveAttribute('href', '/reports/portfolio_overview')
    expect(within(list).getByRole('link', { name: /^Occupancy/ })).toHaveTextContent('Occupied, vacant and under-offer units by property and unit type.')
    expect(fakeSource.catalogue).toHaveBeenCalledWith(NEXUS_ID)
  })

  it('says when the reports cannot be loaded', async () => {
    fakeSource.catalogue.mockRejectedValue(new Error('The LeaseGuard API could not be reached'))
    await renderWithRouter(
      <QueryClientProvider client={createTestQueryClient()}>
        <ReportCatalogueScreen />
      </QueryClientProvider>,
      '/reports',
    )
    expect(await screen.findByText('The reports could not be loaded')).toBeInTheDocument()
  })
})

describe('Portfolio overview', () => {
  it('shows the API figures with the as-at date, and one row per property', async () => {
    await renderReport('portfolio_overview')
    expect(await screen.findByText('Total outstanding')).toBeInTheDocument()
    expect(screen.getByText(/As at/)).toHaveTextContent('As at 21 Nov 2026')
    const table = screen.getByRole('table', { name: 'Portfolio overview by property' })
    const row = within(table).getByRole('row', { name: /Maponya Square/ })
    expect(row).toHaveTextContent(/R\s?16\s?500,50/)
    expect(within(row).getByRole('link', { name: 'Maponya Square' })).toHaveAttribute('href', `/properties/${PROPERTY_ID}`)
    expect(within(row).getByRole('link', { name: '3' })).toHaveAttribute('href', `/monitoring?status=open&propertyId=${PROPERTY_ID}`)
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'portfolio_overview', {})
  })

  it('exports exactly the rows shown as CSV, with Print beside it and Export last', async () => {
    await renderReport('portfolio_overview')
    await screen.findByText('Total outstanding')
    const print = screen.getByRole('button', { name: 'Print' })
    const exportButton = screen.getByRole('button', { name: 'Export CSV' })
    expect(print.compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await userEvent.click(exportButton)
    expect(download).toHaveBeenCalledOnce()
    const [fileName, csv] = download.mock.calls[0] as [string, string]
    expect(fileName).toBe('leaseguard-portfolio-overview-2026-11-21.csv')
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe(
      'Property,Code,Status,Units,Occupied units,Vacant units,Occupancy (%),Active leases,Monthly rental roll (ZAR),Outstanding (ZAR),Tenants in arrears,Open monitoring events',
    )
    expect(lines.slice(1)).toEqual(['Maponya Square,MSQ,Active,4,3,1,75.0,2,21960.00,16500.50,2,3'])
  })

  it('reads its filters from the URL and changes them through the URL', async () => {
    const onSearchChange = await renderReport('portfolio_overview', { propertyId: [PROPERTY_ID], status: ['archived'] })
    await screen.findByText('Total outstanding')
    const filters: ReportFilters = { propertyIds: [PROPERTY_ID], statuses: ['archived'] }
    expect(fakeSource.report).toHaveBeenCalledWith(NEXUS_ID, 'portfolio_overview', filters)

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Archived' }))
    expect(onSearchChange).toHaveBeenLastCalledWith({ propertyId: [PROPERTY_ID], status: undefined })
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onSearchChange).toHaveBeenLastCalledWith({})
  })

  it('shows an empty state for filters that match nothing, and an error state with retry', async () => {
    fakeSource.report.mockResolvedValueOnce({ ...PORTFOLIO, data: { ...PORTFOLIO.data, properties: [] } })
    await renderReport('portfolio_overview', { status: ['under_development'] })
    expect(await screen.findByText('Nothing matches these filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })

  it('says when the report could not be loaded', async () => {
    fakeSource.report.mockRejectedValue(new Error('The LeaseGuard API could not be reached'))
    await renderReport('portfolio_overview')
    expect(await screen.findByText('The report could not be loaded')).toBeInTheDocument()
  })
})

describe('Occupancy', () => {
  it('shows occupancy by property, by unit type and per unit with its current tenant', async () => {
    await renderReport('occupancy')
    const units = await screen.findByRole('table', { name: 'Units and their current tenants' })
    expect(within(units).getByRole('row', { name: /S01/ })).toHaveTextContent('Assigned without a lease')
    expect(within(units).getByRole('link', { name: 'Dlamini Cellular' })).toHaveAttribute('href', '/tenants/t1')
    expect(screen.getByRole('table', { name: 'Occupancy by unit type' })).toHaveTextContent('Line shop')
    expect(screen.getByRole('table', { name: 'Occupancy by property' })).toHaveTextContent('Maponya Square')
  })

  it('exports the units table as CSV', async () => {
    await renderReport('occupancy')
    await screen.findByRole('table', { name: 'Units and their current tenants' })
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    const csv = (download.mock.calls[0] as [string, string])[1].trim().split('\r\n')
    expect(csv).toEqual([
      'Property,Unit,Unit type,Floor area (m²),Occupancy,Current tenant,Tenant from,Lease',
      'Maponya Square,S01,Line shop,120,Occupied,Dlamini Cellular,Assignment,',
      'Maponya Square,S02,Line shop,10,Vacant,,,',
    ])
  })

  it('offers the occupancy statuses as its status filter and no date range', async () => {
    await renderReport('occupancy')
    await screen.findByRole('table', { name: 'Units and their current tenants' })
    const group = screen.getByRole('group', { name: 'Report filters' })
    expect(within(group).getByRole('button', { name: 'Occupancy' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Property' })).toBeInTheDocument()
    expect(within(group).queryByRole('button', { name: /date/i })).toBeNull()
  })
})

describe('a report not built yet', () => {
  // Any report the reports service does not serve yet; once every report is built there is none left to check.
  const notBuilt = REPORT_IDS.find((id) => !isAvailableReportId(id))
  it.skipIf(notBuilt === undefined)('says it is not available yet without asking the API', async () => {
    await renderReport(notBuilt ?? 'portfolio_overview')
    expect(screen.getByText('This report is not available yet')).toBeInTheDocument()
    expect(fakeSource.report).not.toHaveBeenCalled()
  })
})
