import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Property, TenantListItem } from '@leaseguard/domain'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { useAppStore } from '@/store/appStore'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { TenantListParams, TenantSource } from '../api/source'
import { TenantListScreen } from './TenantListScreen'

const fakeTenants = vi.hoisted(() => ({ list: vi.fn<TenantSource['list']>(), get: vi.fn<TenantSource['get']>() }))
const fakeProperties = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }))

vi.mock('../api/selectSource', () => ({ getTenantSource: () => fakeTenants }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ writer: false }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyWriter: () => viewer.writer }))

const BASE: TenantListParams = { page: 1, pageSize: 25, sort: 'tradingName', direction: 'asc' }
const PROPERTY_ID = '0b6f1f43-6d5c-4f8e-9d43-3f1a2b7c9e10'

function tenant(id: string, tradingName: string, overrides: Partial<TenantListItem> = {}): TenantListItem {
  return {
    id,
    companyId: NEXUS_ID,
    createdAt: '2026-01-01T08:00:00+02:00',
    updatedAt: '2026-01-01T08:00:00+02:00',
    legalName: `${tradingName} (Pty) Ltd`,
    tradingName,
    businessType: 'pty_ltd',
    primaryContact: { fullName: 'Ayanda Nkosi', role: 'Owner', phone: '+27825550101' },
    whatsappNumber: '+27825550101',
    whatsappVerified: true,
    whatsappOptedOut: false,
    status: 'active',
    industry: 'Food and beverage',
    leaseCount: 1,
    currentLease: {
      leaseId: 'lease-1',
      reference: 'ACP-001',
      status: 'active',
      verified: true,
      unitId: 'unit-1',
      unitNumber: '001',
      propertyId: PROPERTY_ID,
      propertyName: 'Acacia Park',
    },
    ...overrides,
  }
}

const acaciaPark = { id: PROPERTY_ID, name: 'Acacia Park' } as Property

async function renderScreen(params: TenantListParams = BASE) {
  const onParamsChange = vi.fn<(next: TenantListParams) => void>()
  const result = await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <TenantListScreen params={params} onParamsChange={onParamsChange} />
    </QueryClientProvider>,
    '/tenants',
  )
  return { ...result, onParamsChange }
}

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = false
  fakeTenants.list.mockReset()
  fakeTenants.get.mockReset()
  fakeProperties.list.mockReset().mockResolvedValue({ items: [acaciaPark], total: 1, page: 1, pageSize: 100 })
})

describe('TenantListScreen', () => {
  it('shows a loading state while the first page loads', async () => {
    fakeTenants.list.mockReturnValue(new Promise(() => undefined))
    await renderScreen()
    expect(await screen.findByRole('status')).toHaveTextContent('Loading records…')
  })

  it('shows the API error with a working retry', async () => {
    fakeTenants.list.mockRejectedValueOnce(new ApiError(503, ['The database is unavailable'], 'req-1'))
    await renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is unavailable')

    fakeTenants.list.mockResolvedValueOnce({ items: [tenant('t1', 'Ubuntu Coffee')], total: 1, page: 1, pageSize: 25 })
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('link', { name: 'Ubuntu Coffee' })).toBeInTheDocument()
  })

  it('shows contact person, unit, lease reference, WhatsApp validation and status in words', async () => {
    fakeTenants.list.mockResolvedValue({
      items: [
        tenant('t1', 'Ubuntu Coffee', { status: 'in_arrears' }),
        tenant('t2', 'Kasi Books', { whatsappVerified: false, currentLease: undefined as never, leaseCount: 0 }),
        tenant('t3', 'Mzansi Optics', { whatsappOptedOut: true }),
      ],
      total: 3,
      page: 1,
      pageSize: 25,
    })
    await renderScreen()

    const ubuntu = (await screen.findByRole('link', { name: 'Ubuntu Coffee' })).closest('tr') as HTMLElement
    expect(within(ubuntu).getByRole('link', { name: 'Ubuntu Coffee' })).toHaveAttribute('href', '/tenants/t1')
    expect(within(ubuntu).getByText('Ayanda Nkosi')).toBeInTheDocument()
    expect(within(ubuntu).getByText('001')).toBeInTheDocument()
    expect(within(ubuntu).getByText('Acacia Park')).toBeInTheDocument()
    expect(within(ubuntu).getByRole('link', { name: 'ACP-001' })).toHaveAttribute('href', '/leases/lease-1')
    expect(within(ubuntu).getByText('Validated')).toBeInTheDocument()
    // Arrears is written out, not only coloured.
    expect(within(ubuntu).getByText('In arrears')).toBeInTheDocument()

    const kasi = screen.getByRole('link', { name: 'Kasi Books' }).closest('tr') as HTMLElement
    expect(within(kasi).getByText('Not validated')).toBeInTheDocument()
    expect(within(kasi).getAllByText('None')).toHaveLength(2)

    const optics = screen.getByRole('link', { name: 'Mzansi Optics' }).closest('tr') as HTMLElement
    expect(within(optics).getByText('Opted out')).toBeInTheDocument()
  })

  it('shows the units a tenant holds now, by lease or assignment', async () => {
    fakeTenants.list.mockResolvedValue({
      items: [
        tenant('t4', 'Soweto Spice', {
          currentLease: undefined as never,
          leaseCount: 0,
          currentUnits: [
            { unitId: 'u1', unitNumber: 'S01', propertyId: 'p1', propertyName: 'Maponya Square' },
            { unitId: 'u2', unitNumber: 'S02', propertyId: 'p1', propertyName: 'Maponya Square' },
          ],
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    })
    await renderScreen()
    const row = (await screen.findByRole('link', { name: 'Soweto Spice' })).closest('tr') as HTMLElement
    expect(within(row).getByText('S01')).toBeInTheDocument()
    expect(within(row).getByText('+1 more')).toBeInTheDocument()
    expect(within(row).getByText('Maponya Square')).toBeInTheDocument()
  })

  it('pages, sorts and opens a tenant', async () => {
    fakeTenants.list.mockResolvedValue({ items: [tenant('t1', 'Ubuntu Coffee')], total: 27, page: 1, pageSize: 25 })
    const { onParamsChange, router } = await renderScreen()
    expect(await screen.findByRole('link', { name: 'Ubuntu Coffee' })).toBeInTheDocument()
    expect(fakeTenants.list).toHaveBeenCalledWith(NEXUS_ID, BASE)

    const pagination = screen.getByRole('navigation', { name: 'Pagination' })
    await userEvent.click(within(pagination).getByRole('button', { name: 'Next page' }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 2 })

    await userEvent.click(screen.getByRole('button', { name: /^status/i }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, sort: 'status', direction: 'asc' })

    await userEvent.click(screen.getByText('Ayanda Nkosi'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tenants/t1'))
  })

  it('filters by property from the workspace properties', async () => {
    fakeTenants.list.mockResolvedValue({ items: [tenant('t1', 'Ubuntu Coffee')], total: 1, page: 1, pageSize: 25 })
    const { onParamsChange } = await renderScreen({ ...BASE, page: 2 })
    expect(await screen.findByRole('link', { name: 'Ubuntu Coffee' })).toBeInTheDocument()
    expect(fakeProperties.list).toHaveBeenCalledWith(NEXUS_ID, { page: 1, pageSize: 100, sort: 'name', direction: 'asc' })

    await userEvent.click(screen.getByRole('combobox', { name: 'Property' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Acacia Park' }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, propertyId: PROPERTY_ID })
  })

  it('passes search and filters to the API and clears them from the filtered empty state', async () => {
    fakeTenants.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    const params = { ...BASE, search: 'zzz', status: 'in_arrears', propertyId: PROPERTY_ID } as const
    const { onParamsChange } = await renderScreen(params)
    expect(await screen.findByText('No matching records')).toBeInTheDocument()
    expect(fakeTenants.list).toHaveBeenCalledWith(NEXUS_ID, params)

    const buttons = screen.getAllByRole('button', { name: 'Clear filters' })
    await userEvent.click(buttons[1] as HTMLElement)
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, search: undefined, status: undefined, propertyId: undefined })
  })

  it('shows an empty workspace state', async () => {
    fakeTenants.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderScreen()
    expect(await screen.findByText('No tenants yet')).toBeInTheDocument()
  })

  it('moves a page past the end to the last page', async () => {
    fakeTenants.list.mockResolvedValue({ items: [], total: 10, page: 3, pageSize: 25 })
    const { onParamsChange } = await renderScreen({ ...BASE, page: 3 })
    await waitFor(() => expect(onParamsChange).toHaveBeenCalledWith({ ...BASE, page: 1 }))
    expect(screen.queryByText('No tenants yet')).not.toBeInTheDocument()
  })

  it('asks for a workspace instead of loading when none is selected', async () => {
    useAppStore.setState({ activeCompanyId: '' })
    await renderScreen()
    expect(await screen.findByText('No workspace selected')).toBeInTheDocument()
    expect(fakeTenants.list).not.toHaveBeenCalled()
  })

  it('offers writers, and only writers, to add a tenant', async () => {
    fakeTenants.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderScreen()
    expect(await screen.findByText('No tenants yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add tenant' })).not.toBeInTheDocument()

    viewer.writer = true
    await renderScreen()
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add tenant' }))[0]!)
    expect(await screen.findByRole('dialog', { name: 'Add tenant' })).toBeInTheDocument()
  })
})
