import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import type { LeaseListItem } from '@leaseguard/domain'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { useAppStore } from '@/store/appStore'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'
import { sampleRecord } from '@/test/fakeApi'

import type { LeaseSource } from '../api/source'
import { LEASE_LIST_DEFAULTS, leaseListSearchSchema, type LeaseListSearch } from '../listSearch'
import { LeaseListScreen } from './LeaseListScreen'

const PROPERTY_ID = 'a1b2c3d4-0000-5000-8000-0000000000aa'
const VERIFIER_ID = '7d9f3c2a-0000-5000-8000-0000000000bb'

const fakeSource = vi.hoisted(() => ({
  list: vi.fn<LeaseSource['list']>(),
  get: vi.fn<LeaseSource['get']>(),
}))

vi.mock('../api/selectSource', () => ({ getLeaseSource: () => fakeSource }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))
vi.mock('@/features/properties/api/selectSource', () => ({
  getPropertySource: () => ({
    list: async () => ({ items: [{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Acacia Park' }], total: 1, page: 1, pageSize: 100 }),
  }),
}))
const viewer = vi.hoisted(() => ({ writer: false }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyWriter: () => viewer.writer }))
vi.mock('@/features/users/api/apiSource', () => ({
  createApiUserSource: () => ({
    listMembers: async () => ({ items: [{ id: VERIFIER_ID, fullName: 'Thandi Mokoena' }], total: 1, page: 1, pageSize: 100 }),
  }),
}))

const BASE: LeaseListSearch = leaseListSearchSchema.parse({})

function lease(id: string, reference: string, overrides: Partial<LeaseListItem> = {}): LeaseListItem {
  return {
    ...sampleRecord('leases'),
    id,
    reference,
    tenantName: 'Umoya Coffee',
    propertyName: 'Acacia Park',
    unitNumber: 'ACP-001',
    ...overrides,
  }
}

async function renderScreen(params: LeaseListSearch = BASE) {
  const onParamsChange = vi.fn<(next: LeaseListSearch) => void>()
  const result = await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <LeaseListScreen params={params} onParamsChange={onParamsChange} />
    </QueryClientProvider>,
    '/leases',
  )
  return { ...result, onParamsChange }
}

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = false
  for (const fn of Object.values(fakeSource)) fn.mockReset()
})

describe('LeaseListScreen', () => {
  it('shows a loading state, with the page name for screen readers only', async () => {
    fakeSource.list.mockReturnValue(new Promise(() => undefined))
    await renderScreen()
    expect(await screen.findByRole('status')).toHaveTextContent('Loading records…')
    expect(screen.getByRole('heading', { level: 1, name: 'Leases' })).toHaveClass('sr-only')
  })

  it('shows the API error with a working retry', async () => {
    fakeSource.list.mockRejectedValueOnce(new ApiError(503, ['The database is unavailable'], 'req-1'))
    await renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is unavailable')

    fakeSource.list.mockResolvedValueOnce({ items: [lease('l1', 'ACP-001')], total: 1, page: 1, pageSize: 25 })
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('link', { name: 'ACP-001' })).toBeInTheDocument()
  })

  it('marks the verification of every row: unverified with the open ring, verified with the verifier', async () => {
    fakeSource.list.mockResolvedValue({
      items: [
        lease('l1', 'ACP-001', { verified: true, verifiedByUserId: VERIFIER_ID, verifiedAt: '2026-03-02T08:00:00+02:00' }),
        lease('l2', 'BOT-002', { verified: false, status: 'pending_verification', tenantName: 'Ilanga Pharmacy' }),
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    })
    await renderScreen()

    const verifiedRow = (await screen.findByRole('link', { name: 'ACP-001' })).closest('tr') as HTMLElement
    expect(within(verifiedRow).getByText('Verified')).toBeInTheDocument()
    expect(within(verifiedRow).getByText('Umoya Coffee')).toBeInTheDocument()
    await waitFor(() => expect(within(verifiedRow).getByText('TM')).toBeInTheDocument())

    const unverifiedRow = screen.getByRole('link', { name: 'BOT-002' }).closest('tr') as HTMLElement
    expect(within(unverifiedRow).getByText('Unverified')).toBeInTheDocument()
    expect(within(unverifiedRow).getByText('Pending verification')).toBeInTheDocument()
    expect(within(unverifiedRow).getByText('Ilanga Pharmacy')).toBeInTheDocument()
    expect(screen.getByText(/Unverified terms are not used for financial monitoring/)).toBeInTheDocument()
  })

  it('sends the URL filters to the source, the verification filter as the API verified flag', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderScreen({ ...BASE, search: 'umoya', status: 'active', verification: 'unverified', propertyId: PROPERTY_ID, expiresWithinDays: 90 })

    expect(await screen.findByText('No matching records')).toBeInTheDocument()
    expect(fakeSource.list).toHaveBeenCalledWith(NEXUS_ID, {
      ...LEASE_LIST_DEFAULTS,
      search: 'umoya',
      status: 'active',
      verified: false,
      propertyId: PROPERTY_ID,
      expiresWithinDays: 90,
    })
  })

  it('shows a filtered empty state that clears search and every filter', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    const { onParamsChange } = await renderScreen({ ...BASE, page: 3, search: 'zzz', verification: 'verified', expiresWithinDays: 30 })
    expect(await screen.findByText('No matching records')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Clear filters' })
    await userEvent.click(buttons[1] as HTMLElement)
    expect(onParamsChange).toHaveBeenLastCalledWith({
      ...BASE,
      page: 1,
      search: undefined,
      status: undefined,
      verification: undefined,
      propertyId: undefined,
      expiresWithinDays: undefined,
    })
  })

  it('shows an empty workspace state', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderScreen()
    expect(await screen.findByText('No leases yet')).toBeInTheDocument()
  })

  it('pages, sorts and opens a lease from its row', async () => {
    fakeSource.list.mockResolvedValue({ items: [lease('l1', 'ACP-001'), lease('l2', 'ACP-002')], total: 27, page: 1, pageSize: 25 })
    const { onParamsChange, router } = await renderScreen()

    expect(await screen.findByRole('link', { name: 'ACP-001' })).toHaveAttribute('href', '/leases/l1')
    const pagination = screen.getByRole('navigation', { name: 'Pagination' })
    await userEvent.click(within(pagination).getByRole('button', { name: 'Next page' }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 2 })

    await userEvent.click(screen.getByRole('button', { name: /^expires/i }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, sort: 'expiryDate', direction: 'asc' })

    const row = screen.getByRole('link', { name: 'ACP-002' }).closest('tr') as HTMLElement
    await userEvent.click(within(row).getByText('Umoya Coffee'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/leases/l2'))
  })

  it('moves a page past the end to the last page', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 10, page: 3, pageSize: 25 })
    const { onParamsChange } = await renderScreen({ ...BASE, page: 3 })
    await waitFor(() => expect(onParamsChange).toHaveBeenCalledWith({ ...BASE, page: 1 }))
    expect(screen.queryByText('No leases yet')).not.toBeInTheDocument()
  })

  it('asks for a workspace instead of loading when none is selected', async () => {
    useAppStore.setState({ activeCompanyId: '' })
    await renderScreen()
    expect(await screen.findByText('No workspace selected')).toBeInTheDocument()
    expect(fakeSource.list).not.toHaveBeenCalled()
  })

  it('hides "Add lease" from people who cannot write', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderScreen()
    expect(await screen.findByText('No leases yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add lease' })).not.toBeInTheDocument()
  })

  it('opens the lease form from "Add lease" for writers', async () => {
    viewer.writer = true
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderScreen()
    expect(await screen.findByText('Add the first lease of this workspace.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add lease' }))
    expect(await screen.findByRole('dialog', { name: 'Add lease' })).toBeInTheDocument()
  })
})
