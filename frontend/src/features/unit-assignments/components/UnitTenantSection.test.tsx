import type { Tenant, TenantListItem, Unit } from '@leaseguard/domain'
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
import { UnitTenantSection } from './UnitTenantSection'

const fakeAssignments = vi.hoisted(() => ({
  list: vi.fn<UnitAssignmentSource['list']>(),
  assign: vi.fn<UnitAssignmentSource['assign']>(),
  end: vi.fn<UnitAssignmentSource['end']>(),
}))
const fakes = vi.hoisted(() => ({ tenants: vi.fn(), tenant: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getUnitAssignmentSource: () => fakeAssignments }))
vi.mock('@/features/tenants/api/selectSource', () => ({ getTenantSource: () => ({ list: fakes.tenants, get: fakes.tenant }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const TENANT: Tenant = { ...sampleRecord('tenants'), id: 'c0000000-0000-4000-8000-000000000001', companyId: NEXUS_ID, tradingName: 'Soweto Spice' }
const listed = (tenant: Tenant): TenantListItem => ({ ...tenant, leaseCount: 0, currentUnits: [] })
const { currentLeaseId: _lease, currentTenantId: _tenant, ...SAMPLE_UNIT } = sampleRecord('units')
const VACANT: Unit = { ...SAMPLE_UNIT, id: 'a0000000-0000-4000-8000-000000000001', companyId: NEXUS_ID, unitNumber: 'S01', occupancyStatus: 'vacant' }
const ASSIGNED: Unit = {
  ...VACANT,
  occupancyStatus: 'occupied',
  currentTenantId: TENANT.id,
  currentAssignment: { id: 'b0000000-0000-4000-8000-000000000001', tenantId: TENANT.id, tenantName: TENANT.tradingName, assignedAt: '2026-11-21T08:00:00Z' },
}
const LEASED: Unit = { ...VACANT, occupancyStatus: 'occupied', currentTenantId: TENANT.id, currentLeaseId: 'd0000000-0000-4000-8000-000000000001' }

function renderSection(unit: Unit, canWrite = true) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <UnitTenantSection unit={unit} propertyStatus="active" canWrite={canWrite} />
      <Toaster />
    </QueryClientProvider>,
    `/units/${unit.id}`,
  )
}

const assignmentOf = (unitNumber: string) => ({
  id: 'b0000000-0000-4000-8000-000000000001',
  companyId: NEXUS_ID,
  propertyId: VACANT.propertyId,
  unitId: VACANT.id,
  tenantId: TENANT.id,
  assignedAt: '2026-11-21T08:00:00Z',
  tenantName: TENANT.tradingName,
  unitNumber,
  propertyName: 'Maponya Square',
  createdAt: '2026-11-21T08:00:00Z',
  updatedAt: '2026-11-21T08:00:00Z',
})

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  for (const fn of [...Object.values(fakeAssignments), ...Object.values(fakes)]) fn.mockReset()
  fakes.tenants.mockResolvedValue({ items: [listed(TENANT)], total: 1, page: 1, pageSize: 100 })
  fakes.tenant.mockResolvedValue(TENANT)
})

describe('UnitTenantSection', () => {
  it('shows the assigned tenant since when, and unassigns after confirmation', async () => {
    fakeAssignments.end.mockResolvedValue({ ...assignmentOf('S01'), endedAt: '2026-11-22T08:00:00Z' })
    await renderSection(ASSIGNED)
    const section = screen.getByRole('region', { name: 'Tenant' })
    expect(within(section).getByRole('link', { name: 'Soweto Spice' })).toHaveAttribute('href', `/tenants/${TENANT.id}`)
    expect(within(section).getByText(/Assigned without a lease since/)).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Unassign' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Unassign Soweto Spice?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Unassign' }))
    expect(await screen.findByText('Soweto Spice unassigned from unit S01')).toBeInTheDocument()
    expect(fakeAssignments.end).toHaveBeenCalledWith(NEXUS_ID, ASSIGNED.currentAssignment?.id)
  })

  it('assigns a tenant to a vacant unit', async () => {
    fakeAssignments.assign.mockResolvedValue(assignmentOf('S01'))
    await renderSection(VACANT)
    await userEvent.click(screen.getByRole('button', { name: 'Assign tenant' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign a tenant to unit S01' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Tenant/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Soweto Spice' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign tenant' }))
    expect(await screen.findByText('Soweto Spice assigned to unit S01')).toBeInTheDocument()
    expect(fakeAssignments.assign).toHaveBeenCalledWith(NEXUS_ID, { tenantId: TENANT.id, unitId: VACANT.id })
  })

  it('shows the lease’s tenant for a let unit and offers no assignment', async () => {
    await renderSection(LEASED)
    const section = screen.getByRole('region', { name: 'Tenant' })
    expect(await within(section).findByRole('link', { name: 'Soweto Spice' })).toBeInTheDocument()
    expect(within(section).getByText(/by the current lease/)).toBeInTheDocument()
    expect(within(section).queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers no changes to members who only read', async () => {
    await renderSection(ASSIGNED, false)
    expect(screen.queryByRole('button', { name: 'Unassign' })).not.toBeInTheDocument()
    await renderSection(VACANT, false)
    expect(screen.queryByRole('button', { name: 'Assign tenant' })).not.toBeInTheDocument()
  })
})
