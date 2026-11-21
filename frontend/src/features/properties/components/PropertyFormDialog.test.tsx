import { ApiError } from '@leaseguard/api-client'
import type { Property } from '@leaseguard/domain'
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
import { PropertyFormDialog } from './PropertyFormDialog'

const fakeProperties = vi.hoisted(() => ({
  list: vi.fn<PropertySource['list']>(),
  get: vi.fn<PropertySource['get']>(),
  create: vi.fn<PropertySource['create']>(),
  update: vi.fn<PropertySource['update']>(),
  archive: vi.fn<PropertySource['archive']>(),
  restore: vi.fn<PropertySource['restore']>(),
}))
const members = vi.hoisted(() => ({ list: vi.fn() }))
const fakeUnits = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
vi.mock('../../units/api/selectSource', () => ({ getUnitSource: () => fakeUnits }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => ({ listMembers: members.list }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const ME = '7d9f3c2a-0000-5000-8000-000000000001'
vi.mock('@/features/account/useActiveRole', () => ({ useCurrentUserId: () => '7d9f3c2a-0000-5000-8000-000000000001' }))

const person = (id: string, fullName: string, role: string) =>
  ({ id, fullName, status: 'active', memberships: [{ companyId: NEXUS_ID, role }] }) as unknown as CompanyMember
const OWNER_ID = '5b0c1d2e-0000-4000-8000-0000000000a5'
const READER_ID = '5b0c1d2e-0000-4000-8000-0000000000a6'

const onSaved = vi.fn()

function renderDialog() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <PropertyFormDialog open onOpenChange={() => undefined} onSaved={onSaved} />
      <Toaster />
    </QueryClientProvider>,
    '/properties',
  )
}

async function choose(dialog: HTMLElement, label: RegExp, option: string) {
  await userEvent.click(within(dialog).getByRole('combobox', { name: label }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

async function fillRequired(dialog: HTMLElement) {
  await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Rosebank Corner')
  await userEvent.type(within(dialog).getByLabelText(/^Code/), 'rbc')
  await choose(dialog, /^Type/, 'Office')
  await userEvent.type(within(dialog).getByLabelText(/^Gross lettable area/), '4200')
  await userEvent.type(within(dialog).getByLabelText(/^Street address/), '1 Cradock Avenue')
  await userEvent.type(within(dialog).getByLabelText(/^Suburb/), 'Rosebank')
  await userEvent.type(within(dialog).getByLabelText(/^City or town/), 'Johannesburg')
  await choose(dialog, /^Province/, 'Gauteng')
  await userEvent.type(within(dialog).getByLabelText(/^Postal code/), '2196')
  await choose(dialog, /^Accounting system/, 'Sage')
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  onSaved.mockReset()
  for (const fn of Object.values(fakeProperties)) fn.mockReset()
  fakeUnits.create.mockReset()
  members.list.mockResolvedValue({
    items: [person(ME, 'Sipho Dlamini', 'company_admin'), person(OWNER_ID, 'Pieter Botha', 'property_owner'), person(READER_ID, 'Kabelo Molefe', 'read_only')],
    total: 3,
    page: 1,
    pageSize: 100,
  })
})

describe('PropertyFormDialog', () => {
  // Many select interactions: allow more than the default 5 s when the whole workspace's suites run at once.
  it('adds a property with the signed-in user as manager and an owner', { timeout: 20_000 }, async () => {
    const created: Property = { ...sampleRecord('properties'), name: 'Rosebank Corner', code: 'RBC' }
    fakeProperties.create.mockResolvedValue(created)
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add property' })
    await fillRequired(dialog)
    await choose(dialog, /^Property owner/, 'Pieter Botha (Property owner)')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add property' }))

    expect(await screen.findByText('Rosebank Corner added')).toBeInTheDocument()
    expect(fakeProperties.create).toHaveBeenCalledWith(NEXUS_ID, {
      name: 'Rosebank Corner',
      code: 'RBC',
      type: 'office',
      status: 'active',
      address: { line1: '1 Cradock Avenue', line2: null, suburb: 'Rosebank', city: 'Johannesburg', province: 'Gauteng', postalCode: '2196' },
      grossLettableAreaSqm: 4200,
      managerUserId: ME,
      ownerUserId: OWNER_ID,
      accountingSystem: 'Sage',
    })
    expect(onSaved).toHaveBeenCalledWith(created)
  })

  it('offers only company admins and property managers as manager, and property owners as owner', async () => {
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add property' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Property manager/ }))
    expect(await screen.findByRole('option', { name: 'Sipho Dlamini (Company admin)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Kabelo Molefe/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Pieter Botha/ })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Property owner/ }))
    expect(await screen.findByRole('option', { name: 'No owner' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Pieter Botha (Property owner)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Kabelo Molefe/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Sipho Dlamini/ })).not.toBeInTheDocument()
  })

  it('keeps the current manager selectable when they are no longer an active manager', async () => {
    const SUSPENDED = '5b0c1d2e-0000-4000-8000-0000000000a9'
    members.list.mockResolvedValue({
      items: [person(ME, 'Sipho Dlamini', 'company_admin'), { ...person(SUSPENDED, 'Thandi Mokoena', 'property_manager'), status: 'suspended' }],
      total: 2,
      page: 1,
      pageSize: 100,
    })
    await renderWithRouter(
      <QueryClientProvider client={createTestQueryClient()}>
        <PropertyFormDialog open onOpenChange={() => undefined} property={{ ...sampleRecord('properties'), name: 'Maponya Square', managerUserId: SUSPENDED }} />
      </QueryClientProvider>,
      '/properties',
    )
    const dialog = await screen.findByRole('dialog', { name: 'Edit Maponya Square' })
    expect(await within(dialog).findByRole('combobox', { name: /^Property manager/ })).toHaveTextContent('Thandi Mokoena (Property manager)')
  })

  it('shows a duplicate code on the code field', async () => {
    fakeProperties.create.mockRejectedValue(new ApiError(409, ['A property with the code RBC already exists in this workspace'], null))
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add property' })
    await fillRequired(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add property' }))
    expect(await within(dialog).findByText('A property with the code RBC already exists in this workspace.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^Code/)).toHaveAttribute('aria-invalid', 'true')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('validates before calling the API', async () => {
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add property' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add property' }))
    expect(await within(dialog).findByText('Enter the property name')).toBeInTheDocument()
    expect(within(dialog).getByText('Enter the four-digit postal code')).toBeInTheDocument()
    expect(fakeProperties.create).not.toHaveBeenCalled()
  })
  it('adds units of a type that suits the property together with it', { timeout: 30_000 }, async () => {
    const created: Property = { ...sampleRecord('properties'), name: 'Rosebank Corner', code: 'RBC' }
    fakeProperties.create.mockResolvedValue(created)
    fakeUnits.create.mockImplementation(async (_companyId: string, unit: { unitNumber: string }) => ({ id: unit.unitNumber, ...unit }))
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add property' })
    await fillRequired(dialog)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Add unit' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add unit' }))
    const rows = within(within(dialog).getByRole('list', { name: 'Units to add' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    // An office building suggests office suites and never offers shops.
    expect(within(rows[0]!).getByRole('combobox', { name: /^Unit type/ })).toHaveTextContent('Office suite')
    await userEvent.click(within(rows[1]!).getByRole('combobox', { name: /^Unit type/ }))
    expect(screen.queryByRole('option', { name: 'Line shop' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: 'Storage' }))

    await userEvent.type(within(rows[0]!).getByLabelText(/^Unit number/), '101')
    await userEvent.type(within(rows[0]!).getByLabelText(/^Floor area/), '250')
    await userEvent.type(within(rows[0]!).getByLabelText(/^Floor$/), 'First')
    await userEvent.type(within(rows[1]!).getByLabelText(/^Unit number/), 'S1')
    await userEvent.type(within(rows[1]!).getByLabelText(/^Floor area/), '12')
    expect(within(dialog).getByText('2 units, 262 m² of 4 200 m² lettable')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add property' }))

    expect(await screen.findByText('Rosebank Corner added with 2 units')).toBeInTheDocument()
    expect(fakeUnits.create.mock.calls).toEqual([
      [NEXUS_ID, { propertyId: created.id, unitNumber: '101', type: 'office_suite', floorAreaSqm: 250, occupancyStatus: 'vacant', floor: 'First' }],
      [NEXUS_ID, { propertyId: created.id, unitNumber: 'S1', type: 'storage', floorAreaSqm: 12, occupancyStatus: 'vacant' }],
    ])
    expect(onSaved).toHaveBeenCalledWith(created)
  })

  it('stops a unit number listed twice before calling the API', { timeout: 20_000 }, async () => {
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add property' })
    await fillRequired(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add unit' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add unit' }))
    const rows = within(within(dialog).getByRole('list', { name: 'Units to add' })).getAllByRole('listitem')
    for (const row of rows) {
      await userEvent.type(within(row).getByLabelText(/^Unit number/), 'G01')
      await userEvent.type(within(row).getByLabelText(/^Floor area/), '80')
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add property' }))
    expect(await within(dialog).findByText('This unit number is already in the list')).toBeInTheDocument()
    expect(fakeProperties.create).not.toHaveBeenCalled()
  })

  it('keeps the property and the other units when one unit is refused', { timeout: 20_000 }, async () => {
    const created: Property = { ...sampleRecord('properties'), name: 'Rosebank Corner', code: 'RBC' }
    fakeProperties.create.mockResolvedValue(created)
    fakeUnits.create
      .mockResolvedValueOnce({ id: 'u1' })
      .mockRejectedValueOnce(new ApiError(409, ['Unit number 102 is already used in this property'], null))
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add property' })
    await fillRequired(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add unit' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add unit' }))
    const rows = within(within(dialog).getByRole('list', { name: 'Units to add' })).getAllByRole('listitem')
    await userEvent.type(within(rows[0]!).getByLabelText(/^Unit number/), '101')
    await userEvent.type(within(rows[0]!).getByLabelText(/^Floor area/), '250')
    await userEvent.type(within(rows[1]!).getByLabelText(/^Unit number/), '102')
    await userEvent.type(within(rows[1]!).getByLabelText(/^Floor area/), '300')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add property' }))

    expect(await screen.findByText('Rosebank Corner added with 1 unit; 1 unit was not added')).toBeInTheDocument()
    expect(screen.getByText('102: the number is already used. Add it from the property page.')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledWith(created)
  })
})
