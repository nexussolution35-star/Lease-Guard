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
vi.mock('../api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
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
  members.list.mockResolvedValue({
    items: [person(ME, 'Sipho Dlamini', 'company_admin'), person(OWNER_ID, 'Pieter Botha', 'property_owner'), person(READER_ID, 'Kabelo Molefe', 'read_only')],
    total: 3,
    page: 1,
    pageSize: 100,
  })
})

describe('PropertyFormDialog', () => {
  it('adds a property with the signed-in user as manager and an owner', async () => {
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
})
