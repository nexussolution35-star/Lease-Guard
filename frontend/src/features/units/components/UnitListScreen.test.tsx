import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import type { UnitListItem } from '@leaseguard/domain'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { useAppStore } from '@/store/appStore'
import { NEXUS_ID, openWorkspace, resetWorkspace, SECOND_ID } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { UnitListParams, UnitSource } from '../api/source'
import { UnitListScreen } from './UnitListScreen'

const fakeSource = vi.hoisted(() => ({ list: vi.fn<UnitSource['list']>(), get: vi.fn<UnitSource['get']>() }))
const propertyList = vi.hoisted(() => vi.fn())

vi.mock('../api/selectSource', () => ({ getUnitSource: () => fakeSource }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => ({ list: propertyList }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const BASE: UnitListParams = { page: 1, pageSize: 25, sort: 'unitNumber', direction: 'asc' }
const PROPERTY = { id: 'a1b2c3d4-0000-4000-8000-0000000000aa', name: 'Maponya Square', code: 'MSQ' }

function unit(id: string, unitNumber: string, overrides: Partial<UnitListItem> = {}): UnitListItem {
  return {
    id,
    companyId: NEXUS_ID,
    createdAt: '2026-01-01T08:00:00+02:00',
    updatedAt: '2026-01-01T08:00:00+02:00',
    propertyId: PROPERTY.id,
    property: PROPERTY,
    unitNumber,
    type: 'line_shop',
    floorAreaSqm: 145.5,
    occupancyStatus: 'vacant',
    ...overrides,
  }
}

const LET = unit('u1', 'G12', {
  occupancyStatus: 'occupied',
  currentTenantId: 't1',
  currentLeaseId: 'l1',
  currentTenant: { id: 't1', tradingName: 'Thrifty Foods' },
  currentLease: { id: 'l1', reference: 'MSQ-G12', commencementDate: '2025-03-01', expiryDate: '2030-02-28' },
})

async function renderScreen(params: UnitListParams = BASE) {
  const onParamsChange = vi.fn<(next: UnitListParams) => void>()
  const client = createTestQueryClient()
  const result = await renderWithRouter(
    <QueryClientProvider client={client}>
      <UnitListScreen params={params} onParamsChange={onParamsChange} />
    </QueryClientProvider>,
    '/units',
  )
  return { ...result, onParamsChange }
}

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.list.mockReset()
  fakeSource.get.mockReset()
  propertyList.mockReset().mockResolvedValue({ items: [{ ...PROPERTY }], total: 1, page: 1, pageSize: 100 })
})

describe('UnitListScreen', () => {
  it('shows a loading state while the first page loads', async () => {
    fakeSource.list.mockReturnValue(new Promise(() => undefined))
    await renderScreen()
    expect(await screen.findByRole('status')).toHaveTextContent('Loading records…')
    expect(screen.getByRole('heading', { level: 1, name: 'Units' })).toBeInTheDocument()
  })

  it('shows the API error with a working retry', async () => {
    fakeSource.list.mockRejectedValueOnce(new ApiError(503, ['The database is unavailable'], 'req-1'))
    await renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is unavailable')

    fakeSource.list.mockResolvedValueOnce({ items: [LET], total: 1, page: 1, pageSize: 25 })
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('link', { name: 'G12' })).toBeInTheDocument()
  })

  it('shows an empty workspace state', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderScreen()
    expect(await screen.findByText('No units yet')).toBeInTheDocument()
  })

  it('shows a filtered empty state that clears search and every filter', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    const { onParamsChange } = await renderScreen({ ...BASE, page: 2, search: 'zzz', propertyId: PROPERTY.id, type: 'kiosk', occupancyStatus: 'vacant' })
    expect(await screen.findByText('No matching records')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Clear filters' })
    expect(buttons).toHaveLength(2)
    await userEvent.click(buttons[1] as HTMLElement)
    expect(onParamsChange).toHaveBeenLastCalledWith({
      ...BASE,
      page: 1,
      search: undefined,
      propertyId: undefined,
      type: undefined,
      occupancyStatus: undefined,
    })
  })

  it('shows the tenant and lease of an occupied unit, and dashes for a vacant one', async () => {
    fakeSource.list.mockResolvedValue({ items: [LET, unit('u2', 'G13')], total: 2, page: 1, pageSize: 25 })
    await renderScreen()

    expect(await screen.findByRole('link', { name: 'G12' })).toHaveAttribute('href', '/units/u1')
    const let_ = screen.getByRole('link', { name: 'G12' }).closest('tr') as HTMLElement
    expect(within(let_).getByRole('link', { name: 'Thrifty Foods' })).toHaveAttribute('href', '/tenants/t1')
    expect(within(let_).getByRole('link', { name: 'MSQ-G12' })).toHaveAttribute('href', '/leases/l1')
    expect(within(let_).getByText('28 Feb 2030')).toBeInTheDocument()
    expect(within(let_).getByRole('link', { name: 'Maponya Square' })).toHaveAttribute('href', `/properties/${PROPERTY.id}`)
    expect(within(let_).getByText('Occupied')).toBeInTheDocument()

    const vacant = screen.getByRole('link', { name: 'G13' }).closest('tr') as HTMLElement
    expect(within(vacant).getAllByText('—')).toHaveLength(2)
    expect(within(vacant).getByText('Vacant')).toBeInTheDocument()
    expect(within(vacant).getByText('145,5')).toBeInTheDocument()
  })

  it('rows open the unit, with paging and sorting', async () => {
    fakeSource.list.mockResolvedValue({ items: [LET, unit('u2', 'G13')], total: 27, page: 1, pageSize: 25 })
    const { onParamsChange, router } = await renderScreen()
    await screen.findByRole('link', { name: 'G12' })
    expect(fakeSource.list).toHaveBeenCalledWith(NEXUS_ID, BASE)

    const pagination = screen.getByRole('navigation', { name: 'Pagination' })
    expect(within(pagination).getByText('Page 1 of 2')).toBeInTheDocument()
    await userEvent.click(within(pagination).getByRole('button', { name: 'Next page' }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 2 })

    await userEvent.click(screen.getByRole('button', { name: /^occupancy/i }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, sort: 'occupancyStatus', direction: 'asc' })

    const row = screen.getByRole('link', { name: 'G13' }).closest('tr') as HTMLElement
    await userEvent.click(within(row).getByText('Line shop'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/units/u2'))
  })

  it('filters by property, unit type and occupancy from the toolbar', async () => {
    fakeSource.list.mockResolvedValue({ items: [LET], total: 1, page: 1, pageSize: 25 })
    const { onParamsChange } = await renderScreen({ ...BASE, page: 2 })
    await screen.findByRole('link', { name: 'G12' })
    await waitFor(() => expect(propertyList).toHaveBeenCalledWith(NEXUS_ID, { page: 1, pageSize: 100, sort: 'name', direction: 'asc' }))

    await userEvent.click(screen.getByRole('combobox', { name: 'Property' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Maponya Square' }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, propertyId: PROPERTY.id })

    await userEvent.click(screen.getByRole('combobox', { name: 'Unit type' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Kiosk' }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, type: 'kiosk' })

    await userEvent.click(screen.getByRole('combobox', { name: 'Occupancy' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Under offer' }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, occupancyStatus: 'under_offer' })
  })

  it('shows loading, not the previous workspace’s rows, after a workspace switch', async () => {
    fakeSource.list.mockImplementation((companyId) =>
      companyId === NEXUS_ID ? Promise.resolve({ items: [LET], total: 1, page: 1, pageSize: 25 }) : new Promise(() => undefined),
    )
    await renderScreen()
    expect(await screen.findByRole('link', { name: 'G12' })).toBeInTheDocument()

    act(() => useAppStore.getState().setActiveCompany(SECOND_ID))

    await waitFor(() => expect(fakeSource.list).toHaveBeenLastCalledWith(SECOND_ID, BASE))
    expect(screen.getByRole('status')).toHaveTextContent('Loading records…')
    expect(screen.queryByRole('link', { name: 'G12' })).not.toBeInTheDocument()
  })

  it('moves a page past the end to the last page instead of showing an empty list', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 10, page: 3, pageSize: 25 })
    const { onParamsChange } = await renderScreen({ ...BASE, page: 3 })
    await waitFor(() => expect(onParamsChange).toHaveBeenCalledWith({ ...BASE, page: 1 }))
    expect(screen.queryByText('No units yet')).not.toBeInTheDocument()
  })

  it('asks for a workspace instead of loading when none is selected', async () => {
    useAppStore.setState({ activeCompanyId: '' })
    await renderScreen()
    expect(await screen.findByText('No workspace selected')).toBeInTheDocument()
    expect(fakeSource.list).not.toHaveBeenCalled()
  })
})
