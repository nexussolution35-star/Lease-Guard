import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { ArrangementSource } from '../api/source'
import { arrangementListSearchSchema, type ArrangementListSearch } from '../listSearch'
import { arrangementFixture, PROPERTY_ID, TENANT_ID } from '../test/arrangementFixtures'
import { ArrangementListScreen } from './ArrangementListScreen'

const fakeSource = vi.hoisted(() => ({ list: vi.fn<ArrangementSource['list']>(), get: vi.fn<ArrangementSource['get']>() }))
vi.mock('../api/selectSource', () => ({ getArrangementSource: () => fakeSource }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))
vi.mock('@/features/properties/api/selectSource', () => ({
  getPropertySource: () => ({
    list: async () => ({ items: [{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Meadowlands Square' }], total: 1, page: 1, pageSize: 100 }),
  }),
}))
vi.mock('@/features/tenants/api/selectSource', () => ({
  getTenantSource: () => ({
    list: async () => ({ items: [{ ...sampleRecord('tenants'), id: TENANT_ID, tradingName: 'Dlamini Cellular' }], total: 1, page: 1, pageSize: 100 }),
  }),
}))
const viewer = vi.hoisted(() => ({ writer: false }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyWriter: () => viewer.writer }))

const BASE: ArrangementListSearch = arrangementListSearchSchema.parse({})
const TODAY = new Date('2026-11-21T10:00:00+02:00')

async function renderScreen(params: ArrangementListSearch = BASE) {
  const onParamsChange = vi.fn<(next: ArrangementListSearch) => void>()
  const result = await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <ArrangementListScreen params={params} onParamsChange={onParamsChange} />
    </QueryClientProvider>,
    '/arrangements',
  )
  return { ...result, onParamsChange }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = false
  fakeSource.list.mockReset().mockResolvedValue({ items: [arrangementFixture()], total: 1, page: 1, pageSize: 25 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ArrangementListScreen', () => {
  it('lists the workspace arrangements with names, rand amounts, progress and the domain-worked next instalment', async () => {
    await renderScreen()
    const table = await screen.findByRole('table', { name: 'Payment arrangements in this workspace' })
    const row = within(table).getAllByRole('row')[1]!
    expect(within(row).getByRole('rowheader')).toHaveTextContent('Dlamini Cellular')
    expect(row).toHaveTextContent('Meadowlands Square · S03')
    expect(row).toHaveTextContent('MSQ-L003')
    expect(row).toHaveTextContent('Active')
    expect(row).toHaveTextContent('Arrears reminders paused')
    expect(row).toHaveTextContent('R 31 000,00')
    expect(row).toHaveTextContent('1 of 5')
    // 15 Sep, Oct and Nov are past with nothing confirmed; 15 Dec is next.
    expect(row).toHaveTextContent('3 past due, not confirmed')
    expect(row).toHaveTextContent('15 Dec 2026')
    expect(fakeSource.list).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ sort: 'agreedOn', direction: 'desc', page: 1 }))
  })

  it('says it records agreements and offers no payment action', async () => {
    viewer.writer = true
    await renderScreen()
    await screen.findByRole('table')
    expect(screen.getByText(/it never takes or processes a payment/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record arrangement' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument()
  })

  it('hides recording from read-only members', async () => {
    await renderScreen()
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Record arrangement' })).not.toBeInTheDocument()
  })

  it('filters by status, back to page one', async () => {
    const { onParamsChange } = await renderScreen({ ...BASE, page: 2 })
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Defaulted' }))
    await waitFor(() => expect(onParamsChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'defaulted', page: 1 })))
  })

  it('explains an empty workspace', async () => {
    viewer.writer = true
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderScreen()
    expect(await screen.findByText('No payment arrangements yet')).toBeInTheDocument()
    expect(screen.getByText(/Normal arrears reminders pause while it is active/)).toBeInTheDocument()
  })
})
