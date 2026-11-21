import { ApiError } from '@leaseguard/api-client'
import type { Lease, LeaseListItem, Property, Tenant, Unit } from '@leaseguard/domain'
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

import type { UnitSource } from '../api/source'
import { UnitDetailScreen } from './UnitDetailScreen'

const fakeUnits = vi.hoisted(() => ({
  list: vi.fn<UnitSource['list']>(),
  get: vi.fn<UnitSource['get']>(),
  create: vi.fn<UnitSource['create']>(),
  update: vi.fn<UnitSource['update']>(),
}))
const fakes = vi.hoisted(() => ({ property: vi.fn(), lease: vi.fn(), leases: vi.fn(), tenant: vi.fn(), members: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getUnitSource: () => fakeUnits }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => ({ list: vi.fn(), get: fakes.property }) }))
vi.mock('@/features/leases/api/selectSource', () => ({ getLeaseSource: () => ({ list: fakes.leases, get: fakes.lease }) }))
vi.mock('@/features/tenants/api/selectSource', () => ({ getTenantSource: () => ({ list: vi.fn(), get: fakes.tenant }) }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => ({ listMembers: fakes.members }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({
  useIsCompanyWriter: () => viewer.writer,
  useCurrentUserId: () => '7d9f3c2a-0000-5000-8000-000000000001',
}))

const MANAGER = '5b0c1d2e-0000-4000-8000-0000000000a2'

const PROPERTY: Property = { ...sampleRecord('properties'), id: 'f922b1e8-d0cd-5a20-8393-829bec4dbc49', companyId: NEXUS_ID, name: 'Maponya Square', status: 'active' }
const TENANT: Tenant = { ...sampleRecord('tenants'), id: 'c0000000-0000-4000-8000-000000000001', companyId: NEXUS_ID, tradingName: 'Soweto Spice' }
const LEASE: Lease = {
  ...sampleRecord('leases'),
  id: 'd0000000-0000-4000-8000-000000000001',
  companyId: NEXUS_ID,
  reference: 'MSQ-L001',
  propertyId: PROPERTY.id,
  tenantId: TENANT.id,
  commencementDate: '2024-03-01',
  expiryDate: '2029-02-28',
  status: 'active',
  verified: true,
  verifiedByUserId: MANAGER,
  verifiedAt: '2024-02-20T09:00:00Z',
}
const PAST_LEASE: LeaseListItem = {
  ...LEASE,
  id: 'd0000000-0000-4000-8000-000000000002',
  reference: 'MSQ-L000',
  tenantId: 'c0000000-0000-4000-8000-000000000002',
  tenantName: 'Kasi Books',
  propertyName: PROPERTY.name,
  unitNumber: 'S01',
  commencementDate: '2019-03-01',
  expiryDate: '2024-02-29',
  status: 'expired',
  verified: false,
  verifiedByUserId: undefined,
  verifiedAt: undefined,
} as LeaseListItem
const { currentLeaseId: _lease, currentTenantId: _tenant, ...SAMPLE_UNIT } = sampleRecord('units')
const VACANT: Unit = { ...SAMPLE_UNIT, id: 'a0000000-0000-4000-8000-000000000001', companyId: NEXUS_ID, propertyId: PROPERTY.id, unitNumber: 'S01', type: 'line_shop', floorAreaSqm: 85.5, occupancyStatus: 'vacant' }
const OCCUPIED: Unit = { ...VACANT, occupancyStatus: 'occupied', currentLeaseId: LEASE.id, currentTenantId: TENANT.id }
const member = { id: MANAGER, fullName: 'Naledi van der Merwe', status: 'active', memberships: [{ companyId: NEXUS_ID, role: 'property_manager' }] } as unknown as CompanyMember

const page = <T,>(items: T[], total = items.length) => ({ items, total, page: 1, pageSize: 25 })

function renderScreen(unit: Unit) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <UnitDetailScreen unit={unit} />
      <Toaster />
    </QueryClientProvider>,
    `/units/${unit.id}`,
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = true
  for (const fn of [...Object.values(fakeUnits), ...Object.values(fakes)]) fn.mockReset()
  fakes.property.mockResolvedValue(PROPERTY)
  fakes.lease.mockResolvedValue(LEASE)
  fakes.tenant.mockResolvedValue(TENANT)
  fakes.leases.mockResolvedValue(page([{ ...LEASE, tenantName: TENANT.tradingName, propertyName: PROPERTY.name, unitNumber: 'S01' }, PAST_LEASE]))
  fakes.members.mockResolvedValue(page([member]))
})

describe('UnitDetailScreen', () => {
  it('shows the unit, its property, current tenant and lease, linked to their screens', async () => {
    await renderScreen(OCCUPIED)
    expect(screen.getByRole('heading', { level: 1, name: 'Unit S01' })).toBeInTheDocument()
    const current = await screen.findByRole('region', { name: 'Current lease' })
    expect(await within(current).findByRole('link', { name: 'Soweto Spice' })).toHaveAttribute('href', `/tenants/${TENANT.id}`)
    expect(within(current).getByRole('link', { name: 'MSQ-L001' })).toHaveAttribute('href', `/leases/${LEASE.id}`)
    expect(await within(current).findByText('Naledi van der Merwe')).toBeInTheDocument()
    const details = screen.getByRole('region', { name: 'Details' })
    expect(await within(details).findByRole('link', { name: 'Maponya Square' })).toHaveAttribute('href', `/properties/${PROPERTY.id}`)
    expect(within(details).getByText('85,5 m²')).toBeInTheDocument()
    expect(fakes.lease).toHaveBeenCalledWith(NEXUS_ID, LEASE.id)
    expect(fakes.tenant).toHaveBeenCalledWith(NEXUS_ID, TENANT.id)
  })

  it('lists every lease of the unit, newest first, with its tenant and verification', async () => {
    await renderScreen(OCCUPIED)
    const history = await screen.findByRole('table', { name: 'Leases of unit S01' })
    expect(within(history).getByRole('link', { name: 'MSQ-L000' })).toHaveAttribute('href', `/leases/${PAST_LEASE.id}`)
    expect(within(history).getByRole('link', { name: 'Kasi Books' })).toHaveAttribute('href', `/tenants/${PAST_LEASE.tenantId}`)
    expect(within(history).getByText('Terms not verified')).toBeInTheDocument()
    expect(fakes.leases).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ unitId: OCCUPIED.id, sort: 'commencementDate', direction: 'desc' }))
  })

  it('says a vacant unit has no current lease and does not look one up', async () => {
    fakes.leases.mockResolvedValue(page([]))
    await renderScreen(VACANT)
    const current = screen.getByRole('region', { name: 'Current lease' })
    expect(within(current).getByText('No current lease')).toBeInTheDocument()
    expect(await screen.findByText('No leases yet')).toBeInTheDocument()
    expect(fakes.lease).not.toHaveBeenCalled()
    expect(fakes.tenant).not.toHaveBeenCalled()
  })

  it('shows an error with a retry when the lease history cannot be loaded', async () => {
    fakes.leases.mockRejectedValue(new ApiError(500, [], null))
    await renderScreen(VACANT)
    expect(await screen.findByText('Could not load the lease history')).toBeInTheDocument()
  })

  it('edits the unit with its property fixed and sends only what changed', async () => {
    fakeUnits.update.mockResolvedValue({ ...VACANT, occupancyStatus: 'under_offer' })
    await renderScreen(VACANT)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit unit S01' })
    expect(within(dialog).getByRole('combobox', { name: /^Property/ })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Occupancy/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Under offer' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Unit S01 saved')).toBeInTheDocument()
    expect(fakeUnits.update).toHaveBeenCalledWith(NEXUS_ID, VACANT.id, { occupancyStatus: 'under_offer' })
  })

  it('places the refusal to vacate a leased unit on the occupancy field', async () => {
    fakeUnits.update.mockRejectedValue(new ApiError(422, ['This unit has a current lease, so it stays occupied until the lease ends.'], null))
    await renderScreen(OCCUPIED)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit unit S01' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Occupancy/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Vacant' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    const errors = await within(dialog).findAllByText('This unit has a current lease, so it stays occupied until the lease ends.')
    expect(errors.some((element) => element.closest('[role="alert"]'))).toBe(true)
  })

  it('keeps a unit of an archived property read-only', async () => {
    fakes.property.mockResolvedValue({ ...PROPERTY, status: 'archived' })
    await renderScreen(VACANT)
    expect(await screen.findByText(/property is archived/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('offers no changes to members who only read', async () => {
    viewer.writer = false
    await renderScreen(VACANT)
    expect((await screen.findAllByRole('link', { name: 'Maponya Square' })).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
