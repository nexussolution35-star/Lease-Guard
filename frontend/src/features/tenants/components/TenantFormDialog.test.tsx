import { ApiError } from '@leaseguard/api-client'
import type { Tenant } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'
import { sampleRecord } from '@/test/fakeApi'

import type { TenantSource } from '../api/source'
import { TenantFormDialog } from './TenantFormDialog'

const fakeTenants = vi.hoisted(() => ({
  list: vi.fn<TenantSource['list']>(),
  get: vi.fn<TenantSource['get']>(),
  create: vi.fn<TenantSource['create']>(),
  update: vi.fn<TenantSource['update']>(),
  validateWhatsApp: vi.fn<TenantSource['validateWhatsApp']>(),
}))
vi.mock('../api/selectSource', () => ({ getTenantSource: () => fakeTenants }))
const fakes = vi.hoisted(() => ({ properties: vi.fn(), units: vi.fn(), assign: vi.fn() }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => ({ list: fakes.properties, get: vi.fn() }) }))
vi.mock('@/features/units/api/selectSource', () => ({ getUnitSource: () => ({ list: fakes.units, get: vi.fn() }) }))
vi.mock('@/features/unit-assignments/api/selectSource', () => ({ getUnitAssignmentSource: () => ({ list: vi.fn(), assign: fakes.assign, end: vi.fn() }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const TENANT: Tenant = {
  ...sampleRecord('tenants'),
  id: 'f922b1e8-d0cd-5a20-8393-829bec4dbc49',
  companyId: NEXUS_ID,
  legalName: 'Soweto Shoes (Pty) Ltd',
  tradingName: 'Soweto Shoes',
  businessType: 'pty_ltd',
  primaryContact: { fullName: 'Sizwe Mabena', role: 'Owner', phone: '+27825550199' },
  whatsappNumber: '+27825550199',
  whatsappVerified: true,
  status: 'active',
  industry: 'Retail',
}

const PROPERTY = { ...sampleRecord('properties'), id: '0b6f1f43-6d5c-4f8e-9d43-3f1a2b7c9e10', companyId: NEXUS_ID, name: 'Maponya Square', status: 'active' as const }
const { currentLeaseId: _lease, currentTenantId: _tenant, ...SAMPLE_UNIT } = sampleRecord('units')
const UNIT = {
  ...SAMPLE_UNIT,
  id: '0b6f1f43-6d5c-4f8e-9d43-3f1a2b7c9e11',
  companyId: NEXUS_ID,
  propertyId: PROPERTY.id,
  unitNumber: 'S07',
  occupancyStatus: 'vacant' as const,
  property: { id: PROPERTY.id, name: PROPERTY.name, code: 'MSQ' },
}

const onSaved = vi.fn()

function renderDialog(tenant?: Tenant) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <TenantFormDialog open onOpenChange={() => undefined} onSaved={onSaved} {...(tenant ? { tenant } : {})} />
      <Toaster />
    </QueryClientProvider>,
    '/tenants',
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  onSaved.mockReset()
  for (const fn of [...Object.values(fakeTenants), ...Object.values(fakes)]) fn.mockReset()
  fakes.properties.mockResolvedValue({ items: [PROPERTY], total: 1, page: 1, pageSize: 100 })
  fakes.units.mockResolvedValue({ items: [UNIT], total: 1, page: 1, pageSize: 100 })
})

describe('TenantFormDialog', () => {
  it('adds a tenant with its WhatsApp number in E.164', { timeout: 20_000 }, async () => {
    const created: Tenant = { ...TENANT, whatsappVerified: false }
    fakeTenants.create.mockResolvedValue(created)
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add tenant' })
    await userEvent.type(within(dialog).getByLabelText(/^Registered name/), 'Soweto Shoes (Pty) Ltd')
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Business type/ }))
    await userEvent.click(await screen.findByRole('option', { name: '(Pty) Ltd' }))
    await userEvent.type(within(dialog).getByLabelText(/^WhatsApp number/), '082 555 0199')
    await userEvent.type(within(dialog).getByLabelText(/^Full name/), 'Sizwe Mabena')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add tenant' }))

    expect(await screen.findByText('Soweto Shoes added')).toBeInTheDocument()
    expect(fakeTenants.create).toHaveBeenCalledWith(NEXUS_ID, {
      legalName: 'Soweto Shoes (Pty) Ltd',
      businessType: 'pty_ltd',
      primaryContact: { fullName: 'Sizwe Mabena' },
      whatsappNumber: '+27825550199',
      status: 'prospective',
    })
    expect(onSaved).toHaveBeenCalledWith(created)
  })

  it('assigns the new tenant to the chosen unit, property then unit', { timeout: 20_000 }, async () => {
    fakeTenants.create.mockResolvedValue(TENANT)
    fakes.assign.mockResolvedValue({ id: 'a1', tenantId: TENANT.id, unitId: UNIT.id, unitNumber: 'S07', propertyName: PROPERTY.name })
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add tenant' })
    await userEvent.type(within(dialog).getByLabelText(/^Registered name/), 'Soweto Shoes (Pty) Ltd')
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Business type/ }))
    await userEvent.click(await screen.findByRole('option', { name: '(Pty) Ltd' }))
    await userEvent.type(within(dialog).getByLabelText(/^WhatsApp number/), '082 555 0199')
    await userEvent.type(within(dialog).getByLabelText(/^Full name/), 'Sizwe Mabena')
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Property/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Maponya Square' }))
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Unit/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'S07 · Vacant' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add tenant' }))

    expect(await screen.findByText('Soweto Shoes assigned to unit S07')).toBeInTheDocument()
    expect(fakes.assign).toHaveBeenCalledWith(NEXUS_ID, { tenantId: TENANT.id, unitId: UNIT.id })
  })

  it('keeps the tenant added and says why when the unit cannot be assigned', { timeout: 20_000 }, async () => {
    fakeTenants.create.mockResolvedValue(TENANT)
    fakes.assign.mockRejectedValue(new ApiError(409, ['Unit S07 is assigned to Kasi Books. Unassign it before assigning it to another tenant.'], null))
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add tenant' })
    await userEvent.type(within(dialog).getByLabelText(/^Registered name/), 'Soweto Shoes (Pty) Ltd')
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Business type/ }))
    await userEvent.click(await screen.findByRole('option', { name: '(Pty) Ltd' }))
    await userEvent.type(within(dialog).getByLabelText(/^WhatsApp number/), '082 555 0199')
    await userEvent.type(within(dialog).getByLabelText(/^Full name/), 'Sizwe Mabena')
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Property/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Maponya Square' }))
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Unit/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'S07 · Vacant' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add tenant' }))

    expect(await screen.findByText('Soweto Shoes was added but not assigned to the unit')).toBeInTheDocument()
    expect(screen.getByText('Unit S07 is assigned to Kasi Books. Unassign it before assigning it to another tenant.')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledWith(TENANT)
  })

  it('refuses an invalid WhatsApp number before calling the API, with the format to use', async () => {
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add tenant' })
    await userEvent.type(within(dialog).getByLabelText(/^WhatsApp number/), '12345')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add tenant' }))
    expect(await within(dialog).findByText('Enter the WhatsApp number with its country code, for example +27 82 123 4567')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^WhatsApp number/)).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByText('Enter the registered business name')).toBeInTheDocument()
    expect(fakeTenants.create).not.toHaveBeenCalled()
  })

  it('saves only what changed and says that a new number must be validated', async () => {
    fakeTenants.update.mockResolvedValue({ ...TENANT, whatsappNumber: '+27825550111', whatsappVerified: false })
    await renderDialog(TENANT)
    const dialog = await screen.findByRole('dialog', { name: 'Edit Soweto Shoes' })
    expect(within(dialog).getByText('Changing the number turns automated reminders off until the new number is validated.')).toBeInTheDocument()
    const number = within(dialog).getByLabelText(/^WhatsApp number/)
    await userEvent.clear(number)
    await userEvent.type(number, '+27 82 555 0111')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Soweto Shoes saved')).toBeInTheDocument()
    expect(screen.getByText('The new WhatsApp number must be validated before reminders are sent.')).toBeInTheDocument()
    expect(fakeTenants.update).toHaveBeenCalledWith(NEXUS_ID, TENANT.id, { whatsappNumber: '+27825550111' })
  })

  it('does not call the API when nothing changed', async () => {
    await renderDialog(TENANT)
    const dialog = await screen.findByRole('dialog', { name: 'Edit Soweto Shoes' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Nothing to save: the tenant is unchanged.')).toBeInTheDocument()
    expect(fakeTenants.update).not.toHaveBeenCalled()
  })

  it('puts an API refusal of the number on the number field', async () => {
    fakeTenants.update.mockRejectedValue(
      new ApiError(400, ['whatsappNumber: A South African WhatsApp number has nine digits after +27, for example +27 82 123 4567'], null),
    )
    await renderDialog(TENANT)
    const dialog = await screen.findByRole('dialog', { name: 'Edit Soweto Shoes' })
    await userEvent.type(within(dialog).getByLabelText(/^Notes/), 'Prefers mornings')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('A South African WhatsApp number has nine digits after +27, for example +27 82 123 4567')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^WhatsApp number/)).toHaveAttribute('aria-invalid', 'true')
    expect(onSaved).not.toHaveBeenCalled()
  })
})
