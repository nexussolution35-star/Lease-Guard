import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Property } from '@leaseguard/domain'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { useAppStore } from '@/store/appStore'
import { NEXUS_ID, openWorkspace, resetWorkspace, SECOND_ID } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { PropertyListParams, PropertySource } from '../api/source'
import { PropertyListScreen } from './PropertyListScreen'

const fakeSource = vi.hoisted(() => ({
  list: vi.fn<PropertySource['list']>(),
  get: vi.fn<PropertySource['get']>(),
}))

vi.mock('../api/selectSource', () => ({ getPropertySource: () => fakeSource }))

const BASE: PropertyListParams = { page: 1, pageSize: 25, sort: 'name', direction: 'asc' }

function property(id: string, name: string, overrides: Partial<Property> = {}): Property {
  return {
    id,
    companyId: NEXUS_ID,
    createdAt: '2026-01-01T08:00:00+02:00',
    updatedAt: '2026-01-01T08:00:00+02:00',
    name,
    code: id.toUpperCase(),
    type: 'shopping_centre',
    address: { line1: '1 Main Rd', suburb: 'Pimville', city: 'Soweto', province: 'Gauteng', postalCode: '1809', country: 'South Africa' },
    description: '',
    status: 'active',
    grossLettableAreaSqm: 42000,
    managerUserId: 'usr_1',
    accountingSystem: 'MRI',
    ...overrides,
  }
}

async function renderScreen(params: PropertyListParams = BASE) {
  const onParamsChange = vi.fn<(next: PropertyListParams) => void>()
  const client = createTestQueryClient()
  const result = await renderWithRouter(
    <QueryClientProvider client={client}>
      <PropertyListScreen params={params} onParamsChange={onParamsChange} />
    </QueryClientProvider>,
    '/properties',
  )
  return { ...result, onParamsChange }
}

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.list.mockReset()
  fakeSource.get.mockReset()
})

describe('PropertyListScreen', () => {
  it('shows a loading state while the first page loads', async () => {
    fakeSource.list.mockReturnValue(new Promise(() => undefined))
    await renderScreen()
    expect(await screen.findByRole('status')).toHaveTextContent('Loading records…')
    expect(screen.getByRole('heading', { level: 1, name: 'Properties' })).toBeInTheDocument()
  })

  it('shows the API error with a working retry', async () => {
    fakeSource.list.mockRejectedValueOnce(new ApiError(503, ['The database is unavailable'], 'req-1'))
    await renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is unavailable')

    fakeSource.list.mockResolvedValueOnce({ items: [property('msq', 'Mall of Soweto')], total: 1, page: 1, pageSize: 25 })
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('link', { name: 'Mall of Soweto' })).toBeInTheDocument()
  })

  it('shows an empty workspace state', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderScreen()
    expect(await screen.findByText('No properties yet')).toBeInTheDocument()
  })

  it('shows a filtered empty state that clears search and filters', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    const { onParamsChange } = await renderScreen({ ...BASE, page: 3, search: 'zzz', status: 'archived' })
    expect(await screen.findByText('No matching records')).toBeInTheDocument()
    // Offered both in the toolbar and in the empty state; each clears search and filters.
    const buttons = screen.getAllByRole('button', { name: 'Clear filters' })
    expect(buttons).toHaveLength(2)
    await userEvent.click(buttons[1] as HTMLElement)
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, search: undefined, status: undefined, type: undefined })
  })

  it('renders rows that link to the detail screen, with paging and sorting', async () => {
    fakeSource.list.mockResolvedValue({
      items: [property('msq', 'Mall of Soweto'), property('uop', 'Umhlanga Office Park', { type: 'office', status: 'under_development' })],
      total: 27,
      page: 1,
      pageSize: 25,
    })
    const { onParamsChange, router } = await renderScreen()

    expect(await screen.findByRole('link', { name: 'Mall of Soweto' })).toHaveAttribute('href', '/properties/msq')
    expect(screen.getByText('Under development')).toBeInTheDocument()
    expect(screen.getAllByText('42 000')).toHaveLength(2)
    expect(fakeSource.list).toHaveBeenCalledWith(NEXUS_ID, BASE)

    const pagination = screen.getByRole('navigation', { name: 'Pagination' })
    expect(within(pagination).getByText('Page 1 of 2')).toBeInTheDocument()
    await userEvent.click(within(pagination).getByRole('button', { name: 'Next page' }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 2 })

    await userEvent.click(screen.getByRole('button', { name: /^code/i }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, sort: 'code', direction: 'asc' })

    const row = screen.getByText('Umhlanga Office Park').closest('tr')
    await userEvent.click(within(row as HTMLElement).getByText('Office'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/properties/uop'))
  })

  it('shows loading, not the previous workspace’s rows, after a workspace switch', async () => {
    fakeSource.list.mockImplementation((companyId) =>
      companyId === NEXUS_ID
        ? Promise.resolve({ items: [property('msq', 'Mall of Soweto')], total: 1, page: 1, pageSize: 25 })
        : new Promise(() => undefined),
    )
    await renderScreen()
    expect(await screen.findByRole('link', { name: 'Mall of Soweto' })).toBeInTheDocument()

    act(() => useAppStore.getState().setActiveCompany(SECOND_ID))

    await waitFor(() => expect(fakeSource.list).toHaveBeenLastCalledWith(SECOND_ID, BASE))
    expect(screen.getByRole('status')).toHaveTextContent('Loading records…')
    expect(screen.queryByRole('link', { name: 'Mall of Soweto' })).not.toBeInTheDocument()
  })

  it('moves a page past the end to the last page instead of showing an empty list', async () => {
    // The API answers a page past the end with no items but the real total.
    fakeSource.list.mockResolvedValue({ items: [], total: 10, page: 3, pageSize: 25 })
    const { onParamsChange } = await renderScreen({ ...BASE, page: 3 })

    await waitFor(() => expect(onParamsChange).toHaveBeenCalledWith({ ...BASE, page: 1 }))
    expect(screen.getByRole('status')).toHaveTextContent('Loading records…')
    expect(screen.queryByText('No properties yet')).not.toBeInTheDocument()
    expect(screen.queryByText('No matching records')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
  })

  it('moves to the last page when a source clamps a page past the end', async () => {
    fakeSource.list.mockResolvedValue({ items: [property('msq', 'Mall of Soweto')], total: 30, page: 2, pageSize: 25 })
    const { onParamsChange } = await renderScreen({ ...BASE, page: 5 })

    expect(await screen.findByRole('link', { name: 'Mall of Soweto' })).toBeInTheDocument()
    await waitFor(() => expect(onParamsChange).toHaveBeenCalledWith({ ...BASE, page: 2 }))
  })

  it('leaves an in-range page and an empty list where they are', async () => {
    fakeSource.list.mockResolvedValue({ items: [property('msq', 'Mall of Soweto')], total: 27, page: 2, pageSize: 25 })
    const { onParamsChange } = await renderScreen({ ...BASE, page: 2 })
    expect(await screen.findByRole('link', { name: 'Mall of Soweto' })).toBeInTheDocument()
    expect(onParamsChange).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only search as unfiltered', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderScreen({ ...BASE, search: '   ' })
    expect(await screen.findByText('No properties yet')).toBeInTheDocument()
  })

  it('caps the search box at the API search limit', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderScreen()
    expect(await screen.findByRole('searchbox', { name: 'Search properties' })).toHaveAttribute('maxLength', '100')
  })

  it('asks for a workspace instead of loading when none is selected', async () => {
    useAppStore.setState({ activeCompanyId: '' })
    await renderScreen()
    expect(await screen.findByText('No workspace selected')).toBeInTheDocument()
    expect(fakeSource.list).not.toHaveBeenCalled()
  })
})
