import { ApiError } from '@leaseguard/api-client'
import type { MonitoringEvent, Property, Unit } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import type { CompanyMember } from '@/features/users/api/source'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'
import { sampleRecord } from '@/test/fakeApi'

import type { PropertySource } from '../api/source'
import { PropertyDetailScreen } from './PropertyDetailScreen'

const fakeProperties = vi.hoisted(() => ({
  list: vi.fn<PropertySource['list']>(),
  get: vi.fn<PropertySource['get']>(),
  create: vi.fn<PropertySource['create']>(),
  update: vi.fn<PropertySource['update']>(),
  archive: vi.fn<PropertySource['archive']>(),
  restore: vi.fn<PropertySource['restore']>(),
}))
const lists = vi.hoisted(() => ({ units: vi.fn(), leases: vi.fn(), events: vi.fn(), members: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
vi.mock('@/features/units/api/selectSource', () => ({ getUnitSource: () => ({ list: lists.units, get: vi.fn() }) }))
vi.mock('@/features/leases/api/selectSource', () => ({ getLeaseSource: () => ({ list: lists.leases, get: vi.fn() }) }))
vi.mock('@/features/monitoring/api/selectSource', () => ({ getMonitoringEventSource: () => ({ list: lists.events, get: vi.fn() }) }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => ({ listMembers: lists.members }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({
  useIsCompanyWriter: () => viewer.writer,
  useCurrentUserId: () => '7d9f3c2a-0000-5000-8000-000000000001',
}))

const MANAGER = '5b0c1d2e-0000-4000-8000-0000000000a2'

const PROPERTY: Property = {
  ...sampleRecord('properties'),
  id: 'f922b1e8-d0cd-5a20-8393-829bec4dbc49',
  companyId: NEXUS_ID,
  name: 'Maponya Square',
  code: 'MSQ',
  type: 'shopping_centre',
  status: 'active',
  grossLettableAreaSqm: 12000.5,
  managerUserId: MANAGER,
  accountingSystem: 'MRI',
  description: 'Community shopping centre',
}

const page = <T,>(items: T[], total = items.length) => ({ items, total, page: 1, pageSize: 25 })
const unit = (id: string, unitNumber: string): Unit => ({ ...sampleRecord('units'), id, unitNumber, propertyId: PROPERTY.id, occupancyStatus: 'vacant' })
const event: MonitoringEvent = { ...sampleRecord('monitoringEvents'), id: 'e0000000-0000-4000-8000-000000000001', title: 'Rental escalation not applied', priority: 'high', status: 'new' }
const member = { id: MANAGER, fullName: 'Naledi van der Merwe', status: 'active', memberships: [{ companyId: NEXUS_ID, role: 'property_manager' }] } as unknown as CompanyMember

function renderScreen(property: Property = PROPERTY) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <PropertyDetailScreen property={property} />
      <Toaster />
    </QueryClientProvider>,
    `/properties/${property.id}`,
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = true
  for (const fn of [...Object.values(fakeProperties), ...Object.values(lists)]) fn.mockReset()
  lists.units.mockImplementation(async (_company: string, params: { pageSize: number; occupancyStatus?: string }) =>
    params.pageSize === 1 ? page([], params.occupancyStatus === 'occupied' ? 7 : 12) : page([unit('u1', 'S01'), unit('u2', 'S02')], 12),
  )
  lists.leases.mockResolvedValue(page([], 6))
  lists.events.mockImplementation(async (_company: string, params: { pageSize: number }) => (params.pageSize === 1 ? page([], 3) : page([event], 3)))
  lists.members.mockResolvedValue(page([member]))
})

describe('PropertyDetailScreen', () => {
  it('shows the property, its headline counts and who manages it', async () => {
    await renderScreen()
    expect(screen.getByRole('heading', { level: 1, name: 'Maponya Square' })).toBeInTheDocument()
    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(await screen.findByText('Naledi van der Merwe')).toBeInTheDocument()
    expect(screen.getByText('12 000,5 m²')).toBeInTheDocument()
    expect(lists.events).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ propertyId: PROPERTY.id, open: true }))
    expect(lists.leases).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ propertyId: PROPERTY.id, status: 'active' }))
  })

  it('does not call the manager a former member when the member list cannot be loaded', async () => {
    lists.members.mockRejectedValue(new ApiError(500, [], null))
    await renderScreen()
    const details = await screen.findByRole('region', { name: 'Details' })
    expect((await within(details).findAllByText('Not available')).length).toBeGreaterThan(0)
    expect(within(details).queryByText('Former member')).not.toBeInTheDocument()
  })

  it('lists the units and the open monitoring events with links', async () => {
    await renderScreen()
    const units = await screen.findByRole('table', { name: 'Units in Maponya Square' })
    expect(within(units).getByRole('link', { name: 'S01' })).toHaveAttribute('href', '/units/u1')
    const events = await screen.findByRole('table', { name: 'Open monitoring events at Maponya Square' })
    expect(within(events).getByRole('link', { name: 'Rental escalation not applied' })).toHaveAttribute('href', `/monitoring/${event.id}`)
  })

  it('archives a property after confirmation', async () => {
    fakeProperties.archive.mockResolvedValue({ ...PROPERTY, status: 'archived' })
    await renderScreen()
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archive property' }))
    expect(await screen.findByText('Maponya Square archived')).toBeInTheDocument()
    expect(fakeProperties.archive).toHaveBeenCalledWith(NEXUS_ID, PROPERTY.id)
  })

  it('explains why a property with live leases cannot be archived', async () => {
    fakeProperties.archive.mockRejectedValue(
      new ApiError(409, ['This property still has leases that have not ended. End or terminate them before archiving the property.'], null),
    )
    await renderScreen()
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archive property' }))
    expect(await screen.findByText('The property was not archived')).toBeInTheDocument()
    expect(screen.getByText(/still has leases that have not ended/)).toBeInTheDocument()
  })

  it('shows an archived property read-only with a restore action', async () => {
    fakeProperties.restore.mockResolvedValue(PROPERTY)
    await renderScreen({ ...PROPERTY, status: 'archived' })
    expect(screen.getByText(/This property is archived/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Restore property' }))
    expect(await screen.findByText('Maponya Square restored')).toBeInTheDocument()
  })

  it('offers no changes to members who only read', async () => {
    viewer.writer = false
    await renderScreen()
    await screen.findByRole('table', { name: 'Units in Maponya Square' })
    for (const name of ['Edit', 'Archive', 'Restore']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  })

  it('edits the property and sends only what changed', async () => {
    fakeProperties.update.mockResolvedValue({ ...PROPERTY, name: 'Maponya Mall' })
    await renderScreen()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Maponya Square' })
    expect(within(dialog).getByLabelText(/^Code/)).toBeDisabled()
    const name = within(dialog).getByLabelText(/^Name/)
    await userEvent.clear(name)
    await userEvent.type(name, 'Maponya Mall')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Maponya Mall saved')).toBeInTheDocument()
    expect(fakeProperties.update).toHaveBeenCalledWith(NEXUS_ID, PROPERTY.id, { name: 'Maponya Mall' })
  })
})
