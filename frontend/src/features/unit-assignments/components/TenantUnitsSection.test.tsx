import { ApiError } from '@leaseguard/api-client'
import type { Property, Tenant, UnitListItem, UnitTenantAssignmentListItem } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { UnitAssignmentSource } from '../api/source'
import { TenantUnitsSection } from './TenantUnitsSection'

const fakeAssignments = vi.hoisted(() => ({
  list: vi.fn<UnitAssignmentSource['list']>(),
  assign: vi.fn<UnitAssignmentSource['assign']>(),
  end: vi.fn<UnitAssignmentSource['end']>(),
}))
const fakes = vi.hoisted(() => ({ properties: vi.fn(), units: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getUnitAssignmentSource: () => fakeAssignments }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => ({ list: fakes.properties, get: vi.fn() }) }))
vi.mock('@/features/units/api/selectSource', () => ({ getUnitSource: () => ({ list: fakes.units, get: vi.fn() }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const PROPERTY: Property = { ...sampleRecord('properties'), id: 'f922b1e8-d0cd-5a20-8393-829bec4dbc49', companyId: NEXUS_ID, name: 'Maponya Square', status: 'active' }
const TENANT: Tenant = { ...sampleRecord('tenants'), id: 'c0000000-0000-4000-8000-000000000001', companyId: NEXUS_ID, tradingName: 'Soweto Spice' }
const { currentLeaseId: _lease, currentTenantId: _tenant, ...SAMPLE_UNIT } = sampleRecord('units')
const unit = (id: string, unitNumber: string, extra: Partial<UnitListItem> = {}): UnitListItem => ({
  ...SAMPLE_UNIT,
  id,
  companyId: NEXUS_ID,
  propertyId: PROPERTY.id,
  unitNumber,
  occupancyStatus: 'vacant',
  property: { id: PROPERTY.id, name: PROPERTY.name, code: 'MSQ' },
  ...extra,
})
const VACANT = unit('a0000000-0000-4000-8000-000000000001', 'S01')
const HELD = unit('a0000000-0000-4000-8000-000000000002', 'S02', {
  occupancyStatus: 'occupied',
  currentTenant: { id: 'c0000000-0000-4000-8000-000000000009', tradingName: 'Kasi Books' },
  currentAssignment: { id: 'b9', tenantId: 'c0000000-0000-4000-8000-000000000009', tenantName: 'Kasi Books', assignedAt: '2026-11-01T08:00:00Z' },
})
const ASSIGNMENT: UnitTenantAssignmentListItem = {
  id: 'b0000000-0000-4000-8000-000000000001',
  companyId: NEXUS_ID,
  propertyId: PROPERTY.id,
  unitId: 'a0000000-0000-4000-8000-000000000003',
  tenantId: TENANT.id,
  assignedAt: '2026-11-21T08:00:00Z',
  tenantName: TENANT.tradingName,
  unitNumber: 'S03',
  propertyName: PROPERTY.name,
  createdAt: '2026-11-21T08:00:00Z',
  updatedAt: '2026-11-21T08:00:00Z',
}

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 100 })

function renderSection(canWrite = true) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <TenantUnitsSection tenant={TENANT} canWrite={canWrite} />
      <Toaster />
    </QueryClientProvider>,
    `/tenants/${TENANT.id}`,
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  for (const fn of [...Object.values(fakeAssignments), ...Object.values(fakes)]) fn.mockReset()
  fakeAssignments.list.mockResolvedValue(page([ASSIGNMENT]))
  fakes.properties.mockResolvedValue(page([PROPERTY, { ...PROPERTY, id: 'f922b1e8-0000-5a20-8393-829bec4dbc40', name: 'Old Mill', status: 'archived' }]))
  fakes.units.mockResolvedValue(page([VACANT, HELD]))
})

describe('TenantUnitsSection', () => {
  it('lists the units the tenant is assigned to, with property and since', async () => {
    await renderSection()
    const table = await screen.findByRole('table', { name: 'Units assigned to Soweto Spice' })
    expect(within(table).getByRole('link', { name: 'S03' })).toHaveAttribute('href', `/units/${ASSIGNMENT.unitId}`)
    expect(within(table).getByRole('link', { name: 'Maponya Square' })).toHaveAttribute('href', `/properties/${PROPERTY.id}`)
    expect(within(table).getByText('21 Nov 2026')).toBeInTheDocument()
    expect(fakeAssignments.list).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ tenantId: TENANT.id, current: true }))
  })

  it('assigns the tenant to a unit, property then unit, with a unit someone else holds not choosable', async () => {
    fakeAssignments.assign.mockResolvedValue({ ...ASSIGNMENT, unitId: VACANT.id, unitNumber: 'S01' })
    await renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Assign to unit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign Soweto Spice to a unit' })
    expect(within(dialog).getByRole('combobox', { name: /^Unit/ })).toBeDisabled()

    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Property/ }))
    expect(screen.queryByRole('option', { name: 'Old Mill' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: 'Maponya Square' }))
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Unit/ }))
    expect(await screen.findByRole('option', { name: 'S02 · Assigned to Kasi Books' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getByRole('option', { name: 'S01 · Vacant' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign to unit' }))

    expect(await screen.findByText('Soweto Spice assigned to unit S01')).toBeInTheDocument()
    expect(fakeAssignments.assign).toHaveBeenCalledWith(NEXUS_ID, { tenantId: TENANT.id, unitId: VACANT.id })
  })

  it('shows the database’s refusal, naming who holds the unit, in the dialog', async () => {
    const message = 'Unit S01 is let to Kasi Books under lease MSQ-L009. It cannot be assigned to another tenant while that lease is in place.'
    fakeAssignments.assign.mockRejectedValue(new ApiError(409, [message], null))
    await renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Assign to unit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign Soweto Spice to a unit' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Property/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Maponya Square' }))
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Unit/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'S01 · Vacant' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign to unit' }))
    expect(await within(dialog).findByText(message)).toBeInTheDocument()
  })

  it('unassigns a unit after confirmation', async () => {
    fakeAssignments.end.mockResolvedValue({ ...ASSIGNMENT, endedAt: '2026-11-22T08:00:00Z' })
    await renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Unassign unit S03' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Unassign unit S03?' })
    expect(within(confirm).getByText(/returns to vacant unless a lease keeps it occupied/)).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: 'Unassign' }))
    expect(await screen.findByText('Soweto Spice unassigned from unit S03')).toBeInTheDocument()
    expect(fakeAssignments.end).toHaveBeenCalledWith(NEXUS_ID, ASSIGNMENT.id)
  })

  it('says when the tenant holds no unit', async () => {
    fakeAssignments.list.mockResolvedValue(page([]))
    await renderSection()
    expect(await screen.findByText('Not assigned to a unit')).toBeInTheDocument()
  })

  it('offers no changes to members who only read', async () => {
    await renderSection(false)
    expect(await screen.findByRole('table', { name: 'Units assigned to Soweto Spice' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign to unit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Unassign/ })).not.toBeInTheDocument()
  })
})
