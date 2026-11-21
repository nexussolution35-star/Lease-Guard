import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import type { MonitoringEventListItem } from '@leaseguard/domain'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { useAppStore } from '@/store/appStore'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'
import { sampleRecord } from '@/test/fakeApi'

import type { MonitoringEventSource } from '../api/source'
import { monitoringListSearchSchema, type MonitoringListSearch } from '../listSearch'
import { MonitoringEventListScreen } from './MonitoringEventListScreen'

const PROPERTY_ID = 'a1b2c3d4-0000-5000-8000-0000000000aa'
const UNIT_ID = 'a1b2c3d4-0000-5000-8000-0000000000ab'
const TENANT_ID = 'a1b2c3d4-0000-5000-8000-0000000000ac'
const LEASE_ID = 'a1b2c3d4-0000-5000-8000-0000000000ad'
const MEMBER_ID = '7d9f3c2a-0000-5000-8000-0000000000bb'

const fakeSource = vi.hoisted(() => ({
  list: vi.fn<MonitoringEventSource['list']>(),
  get: vi.fn<MonitoringEventSource['get']>(),
}))

vi.mock('../api/selectSource', () => ({ getMonitoringEventSource: () => fakeSource }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))
const onePage = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 100 })
const unitLists = vi.hoisted(() => ({ calls: [] as unknown[] }))
vi.mock('@/features/properties/api/selectSource', () => ({
  getPropertySource: () => ({ list: async () => onePage([{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Acacia Park' }]) }),
}))
vi.mock('@/features/units/api/selectSource', () => ({
  getUnitSource: () => ({
    list: async (_companyId: string, params: unknown) => {
      unitLists.calls.push(params)
      return onePage([{ ...sampleRecord('units'), id: UNIT_ID, unitNumber: 'G12', property: { id: PROPERTY_ID, name: 'Acacia Park', code: 'ACP' } }])
    },
  }),
}))
vi.mock('@/features/tenants/api/selectSource', () => ({
  getTenantSource: () => ({ list: async () => onePage([{ ...sampleRecord('tenants'), id: TENANT_ID, tradingName: 'Umoya Coffee', leaseCount: 1 }]) }),
}))
vi.mock('@/features/leases/api/selectSource', () => ({
  getLeaseSource: () => ({ list: async () => onePage([{ ...sampleRecord('leases'), id: LEASE_ID, reference: 'ACP-G12', tenantName: 'Umoya Coffee' }]) }),
}))
vi.mock('@/features/users/api/apiSource', () => ({
  createApiUserSource: () => ({ listMembers: async () => onePage([{ id: MEMBER_ID, fullName: 'Thandi Mokoena' }]) }),
}))

const BASE: MonitoringListSearch = monitoringListSearchSchema.parse({})

function event(id: string, title: string, overrides: Partial<MonitoringEventListItem> = {}): MonitoringEventListItem {
  const base = sampleRecord('monitoringEvents')
  return {
    ...base,
    id,
    title,
    type: 'rental_escalation_discrepancy',
    description: 'October rental does not include the 8% escalation.',
    recommendedAction: 'Ask the accountant to correct the rental charge.',
    priority: 'high',
    status: 'action_required',
    propertyId: PROPERTY_ID,
    unitId: UNIT_ID,
    tenantId: TENANT_ID,
    leaseId: LEASE_ID,
    leaseReference: 'ACP-G12',
    identifiedOn: '2026-11-03',
    dueDate: '2026-11-30',
    assignedToUserId: MEMBER_ID,
    propertyName: 'Acacia Park',
    unitNumber: 'G12',
    tenantName: 'Umoya Coffee',
    assigneeName: 'Thandi Mokoena',
    ...overrides,
  }
}

const page = (items: MonitoringEventListItem[], total = items.length) => ({ items, total, page: 1, pageSize: 25 })

async function renderScreen(params: MonitoringListSearch = BASE) {
  const onParamsChange = vi.fn<(next: MonitoringListSearch) => void>()
  const result = await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <MonitoringEventListScreen params={params} onParamsChange={onParamsChange} />
    </QueryClientProvider>,
    '/monitoring',
  )
  return { ...result, onParamsChange }
}

/** Tests that open several selects take longer than the default 5 s when the whole suite runs at once. */
const MANY_INTERACTIONS = 20_000

const rowOf = async (title: string) => (await screen.findByRole('link', { name: title })).closest('tr') as HTMLElement

async function choose(filter: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: filter }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  unitLists.calls = []
  for (const fn of Object.values(fakeSource)) fn.mockReset()
})

describe('MonitoringEventListScreen', () => {
  it('shows a loading state, with the page name for screen readers only', async () => {
    fakeSource.list.mockReturnValue(new Promise(() => undefined))
    await renderScreen()
    expect(await screen.findByRole('status')).toHaveTextContent('Loading records…')
    expect(screen.getByRole('heading', { level: 1, name: 'Monitoring' })).toHaveClass('sr-only')
  })

  it('shows the API error with a working retry', async () => {
    fakeSource.list.mockRejectedValueOnce(new ApiError(503, ['The database is unavailable'], 'req-1'))
    await renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is unavailable')

    fakeSource.list.mockResolvedValueOnce(page([event('e1', 'Escalation not applied')]))
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('link', { name: 'Escalation not applied' })).toBeInTheDocument()
  })

  it('explains where events come from when the workspace has none', async () => {
    fakeSource.list.mockResolvedValue(page([]))
    await renderScreen()
    expect(await screen.findByText('No monitoring events yet')).toBeInTheDocument()
    expect(screen.getByText(/raises events from verified leases and verified statements/)).toBeInTheDocument()
  })

  it('shows every PRD field of an event: type, description, property, unit, tenant, lease, action, dates, assignee', async () => {
    fakeSource.list.mockResolvedValue(page([event('e1', 'Escalation not applied')]))
    await renderScreen()
    const row = await rowOf('Escalation not applied')
    expect(within(row).getByRole('link', { name: 'Escalation not applied' })).toHaveAttribute('href', '/monitoring/e1')
    expect(within(row).getByText('Rental escalation discrepancy')).toBeInTheDocument()
    expect(within(row).getByText('October rental does not include the 8% escalation.')).toBeInTheDocument()
    expect(within(row).getByText('Acacia Park')).toBeInTheDocument()
    expect(within(row).getByText('G12')).toBeInTheDocument()
    expect(within(row).getByText('Umoya Coffee')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'ACP-G12' })).toHaveAttribute('href', `/leases/${LEASE_ID}`)
    expect(within(row).getByText('Ask the accountant to correct the rental charge.')).toBeInTheDocument()
    expect(within(row).getByText('03 Nov 2026')).toBeInTheDocument()
    expect(within(row).getByText('30 Nov 2026')).toBeInTheDocument()
    expect(within(row).getByText('Thandi Mokoena')).toBeInTheDocument()
  })

  it('shows priority and status as a mark with text and a tone', async () => {
    fakeSource.list.mockResolvedValue(page([event('e1', 'Escalation not applied', { priority: 'critical', status: 'action_required' })]))
    await renderScreen()
    const row = await rowOf('Escalation not applied')
    const priority = within(row).getByText('Critical')
    expect(priority).toHaveAttribute('data-tone', 'danger')
    expect(priority).toHaveAttribute('title', 'Critical priority')
    const status = within(row).getByText('Action required')
    expect(status.closest('[data-tone]')).toHaveAttribute('data-tone', 'danger')
  })

  it('says when an event has no unit, tenant, lease, due date or assignee', async () => {
    fakeSource.list.mockResolvedValue(
      page([
        event('e1', 'Statement needs review', {
          unitId: undefined,
          unitNumber: undefined,
          tenantId: undefined,
          tenantName: undefined,
          leaseId: undefined,
          leaseReference: undefined,
          dueDate: undefined,
          assignedToUserId: undefined,
          assigneeName: undefined,
        }),
      ]),
    )
    await renderScreen()
    const row = await rowOf('Statement needs review')
    expect(within(row).getByText('No due date')).toBeInTheDocument()
    expect(within(row).getByText('Unassigned')).toBeInTheDocument()
    expect(within(row).queryByText('G12')).not.toBeInTheDocument()
  })

  it('sends the URL state to the API, reading open and closed as its open flag', async () => {
    fakeSource.list.mockResolvedValue(page([]))
    await renderScreen({ ...BASE, status: 'open', type: 'arrears', priority: 'high', assignee: 'unassigned', due: 'overdue' })
    await waitFor(() => expect(fakeSource.list).toHaveBeenCalled())
    const params = fakeSource.list.mock.calls[0]![1]
    expect(params).toMatchObject({ open: true, type: 'arrears', priority: 'high', assignee: 'unassigned', due: 'overdue' })
    expect(params).not.toHaveProperty('status')
  })

  it('filters by each field and returns to page 1', async () => {
    fakeSource.list.mockResolvedValue(page([event('e1', 'Escalation not applied')]))
    const { onParamsChange } = await renderScreen({ ...BASE, page: 3 })
    await screen.findByRole('link', { name: 'Escalation not applied' })

    await choose('Event type', 'Lease expiry')
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, type: 'lease_expiry' })
    await choose('Priority', 'Critical')
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, priority: 'critical' })
    await choose('Status', 'Open (needs attention)')
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, status: 'open' })
    await choose('Unit', 'Acacia Park · G12')
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, unitId: UNIT_ID })
    await choose('Tenant', 'Umoya Coffee')
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, tenantId: TENANT_ID })
    await choose('Lease', 'ACP-G12 · Umoya Coffee')
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, leaseId: LEASE_ID })
    await choose('Due date', 'Due within 30 days')
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, due: 'next_30_days' })
    await choose('Assigned to', 'Thandi Mokoena')
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, assignee: MEMBER_ID })
    await choose('Assigned to', 'Unassigned')
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, assignee: 'unassigned' })
  }, MANY_INTERACTIONS)

  it('choosing a property drops unit, tenant and lease choices and lists the units of that property', async () => {
    fakeSource.list.mockResolvedValue(page([event('e1', 'Escalation not applied')]))
    const { onParamsChange } = await renderScreen({ ...BASE, unitId: UNIT_ID, tenantId: TENANT_ID, leaseId: LEASE_ID })
    await screen.findByRole('link', { name: 'Escalation not applied' })
    await choose('Property', 'Acacia Park')
    expect(onParamsChange).toHaveBeenLastCalledWith({
      ...BASE,
      page: 1,
      propertyId: PROPERTY_ID,
      unitId: undefined,
      tenantId: undefined,
      leaseId: undefined,
    })

    await renderScreen({ ...BASE, propertyId: PROPERTY_ID })
    await waitFor(() => expect(unitLists.calls).toContainEqual(expect.objectContaining({ propertyId: PROPERTY_ID })))
  }, MANY_INTERACTIONS)

  it('shows a filtered empty state whose clear removes search and every filter', async () => {
    fakeSource.list.mockResolvedValue(page([]))
    const { onParamsChange } = await renderScreen({ ...BASE, page: 2, search: 'zzz', status: 'closed', due: 'overdue', assignee: MEMBER_ID })
    expect(await screen.findByText('No matching records')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Clear filters' })
    await userEvent.click(buttons[0] as HTMLElement)
    expect(onParamsChange).toHaveBeenLastCalledWith({
      ...BASE,
      page: 1,
      search: undefined,
      type: undefined,
      priority: undefined,
      status: undefined,
      propertyId: undefined,
      unitId: undefined,
      tenantId: undefined,
      leaseId: undefined,
      assignee: undefined,
      due: undefined,
    })
  })

  it('pages, sorts by priority and due date, and opens an event from its row', async () => {
    fakeSource.list.mockResolvedValue(page([event('e1', 'One'), event('e2', 'Two')], 27))
    const { onParamsChange, router } = await renderScreen()

    expect(await screen.findByRole('link', { name: 'One' })).toHaveAttribute('href', '/monitoring/e1')
    const pagination = screen.getByRole('navigation', { name: 'Pagination' })
    await userEvent.click(within(pagination).getByRole('button', { name: 'Next page' }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 2 })

    await userEvent.click(screen.getByRole('button', { name: /^priority/i }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, sort: 'priority', direction: 'asc' })
    await userEvent.click(screen.getByRole('button', { name: /^due/i }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, sort: 'dueDate', direction: 'asc' })

    const row = await rowOf('Two')
    await userEvent.click(within(row).getByText('Thandi Mokoena'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/monitoring/e2'))
  }, MANY_INTERACTIONS)

  it('asks for a workspace instead of loading when none is selected', async () => {
    useAppStore.setState({ activeCompanyId: '' })
    await renderScreen()
    expect(await screen.findByText('No workspace selected')).toBeInTheDocument()
    expect(fakeSource.list).not.toHaveBeenCalled()
  })
})
