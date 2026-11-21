import { ApiError } from '@leaseguard/api-client'
import type { Lease } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { LeaseSource } from '../api/source'
import { LeaseFormDialog } from './LeaseFormDialog'

const fakeLeases = vi.hoisted(() => ({
  list: vi.fn<LeaseSource['list']>(),
  get: vi.fn<LeaseSource['get']>(),
  create: vi.fn<LeaseSource['create']>(),
  update: vi.fn<LeaseSource['update']>(),
}))
const others = vi.hoisted(() => ({ tenants: vi.fn(), properties: vi.fn(), units: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getLeaseSource: () => fakeLeases }))
vi.mock('@/features/tenants/api/selectSource', () => ({ getTenantSource: () => ({ list: others.tenants, get: vi.fn() }) }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => ({ list: others.properties, get: vi.fn() }) }))
vi.mock('@/features/units/api/selectSource', () => ({ getUnitSource: () => ({ list: others.units, get: vi.fn() }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const TENANT_ID = '0b6f1f43-6d5c-4f8e-9d43-3f1a2b7c9e10'
const PROPERTY_ID = 'f922b1e8-d0cd-5a20-8393-829bec4dbc49'
const UNIT_ID = 'a1b2c3d4-0000-4000-8000-000000000001'

const LEASE: Lease = {
  ...sampleRecord('leases'),
  id: 'c0000000-0000-4000-8000-000000000001',
  companyId: NEXUS_ID,
  tenantId: TENANT_ID,
  propertyId: PROPERTY_ID,
  unitId: UNIT_ID,
}

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 100 })

function renderDialog(lease?: Lease) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <LeaseFormDialog open onOpenChange={() => undefined} {...(lease ? { lease } : {})} />
      <Toaster />
    </QueryClientProvider>,
    '/leases',
  )
}

async function replace(field: HTMLElement, text: string) {
  await userEvent.clear(field)
  await userEvent.type(field, text)
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  for (const fn of [...Object.values(fakeLeases), ...Object.values(others)]) fn.mockReset()
  others.tenants.mockResolvedValue(page([{ ...sampleRecord('tenants'), id: TENANT_ID, tradingName: 'Thrifty Foods' }]))
  others.properties.mockResolvedValue(page([{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Meadowlands Square', status: 'active' }]))
  others.units.mockResolvedValue(page([{ ...sampleRecord('units'), id: UNIT_ID, propertyId: PROPERTY_ID, unitNumber: 'A01', occupancyStatus: 'occupied' }]))
  fakeLeases.update.mockImplementation(async (_companyId, _id, changes) => ({ ...LEASE, ...changes, verified: false, status: 'pending_verification' }) as Lease)
})

describe('LeaseFormDialog', () => {
  it('asks for the required fields of a new lease before sending anything', async () => {
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add lease' })
    for (const section of ['Parties', 'Term', 'Rental and escalation', 'Renewal', 'Deposit and guarantee']) {
      expect(within(dialog).getByRole('group', { name: section })).toBeInTheDocument()
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add lease' }))
    expect(await within(dialog).findByText('Enter the lease reference')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose the tenant')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose the commencement date')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose the escalation type')).toBeInTheDocument()
    expect(fakeLeases.create).not.toHaveBeenCalled()
  })

  it('shows the saved terms in South African dates and rand', async () => {
    await renderDialog(LEASE)
    const dialog = await screen.findByRole('dialog', { name: `Edit lease ${LEASE.reference}` })
    expect(within(dialog).getByRole('button', { name: /^Commencement/ })).toHaveTextContent('01 Mar 2023')
    expect(within(dialog).getByLabelText(/^Rental at commencement/)).toHaveValue('185 000,00')
  })

  it('warns before a term change returns a verified lease to pending verification, then saves only the change', async () => {
    await renderDialog(LEASE)
    const dialog = await screen.findByRole('dialog', { name: `Edit lease ${LEASE.reference}` })
    expect(within(dialog).getByRole('note')).toHaveTextContent('These terms are verified')
    await replace(within(dialog).getByLabelText(/^Rental due day/), '7')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    const warning = await screen.findByRole('alertdialog', { name: `Change the verified terms of ${LEASE.reference}?` })
    expect(warning).toHaveTextContent('This changes the rental or due day.')
    expect(warning).toHaveTextContent('returns to pending verification')
    expect(fakeLeases.update).not.toHaveBeenCalled()
    await userEvent.click(within(warning).getByRole('button', { name: 'Save and re-verify later' }))
    await waitFor(() => expect(fakeLeases.update).toHaveBeenCalledWith(NEXUS_ID, LEASE.id, { paymentDueDay: 7 }))
    expect(await screen.findByText('Lease MSQ-L001 saved; its terms need verifying again')).toBeInTheDocument()
  })

  it('saves a note on a verified lease without the warning', async () => {
    fakeLeases.update.mockResolvedValue({ ...LEASE, notes: 'Filed in cabinet 3' })
    await renderDialog(LEASE)
    const dialog = await screen.findByRole('dialog', { name: `Edit lease ${LEASE.reference}` })
    await userEvent.type(within(dialog).getByLabelText(/^Lease notes/), 'Filed in cabinet 3')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(fakeLeases.update).toHaveBeenCalledWith(NEXUS_ID, LEASE.id, { notes: 'Filed in cabinet 3' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('places API refusals on the fields they name', async () => {
    const unverified: Lease = { ...LEASE, verified: false, status: 'pending_verification' }
    fakeLeases.update.mockRejectedValue(new ApiError(409, ['A lease with the reference MSQ-L002 already exists in this workspace'], null))
    await renderDialog(unverified)
    const dialog = await screen.findByRole('dialog', { name: `Edit lease ${LEASE.reference}` })
    expect(within(dialog).queryByRole('note')).not.toBeInTheDocument()
    await replace(within(dialog).getByLabelText(/^Lease reference/), 'msq-l002')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('A lease with the reference MSQ-L002 already exists in this workspace.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^Lease reference/)).toHaveAttribute('aria-invalid', 'true')
    expect(fakeLeases.update).toHaveBeenCalledWith(NEXUS_ID, LEASE.id, { reference: 'MSQ-L002' })

    fakeLeases.update.mockRejectedValue(new ApiError(400, ['escalation.percentage: must be at most 1000'], null))
    await replace(within(dialog).getByLabelText(/^Escalation percentage/), '9')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('Must be at most 1000.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^Escalation percentage/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('offers the units of the chosen property and clears the unit when the property changes', async () => {
    const OTHER = 'f922b1e8-d0cd-5a20-8393-829bec4dbc50'
    others.properties.mockResolvedValue(
      page([
        { ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Meadowlands Square', status: 'active' },
        { ...sampleRecord('properties'), id: OTHER, name: 'Acacia Park', status: 'active' },
        { ...sampleRecord('properties'), id: 'f922b1e8-d0cd-5a20-8393-829bec4dbc51', name: 'Old Mill', status: 'archived' },
      ]),
    )
    await renderDialog(LEASE)
    const dialog = await screen.findByRole('dialog', { name: `Edit lease ${LEASE.reference}` })
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /^Unit/ })).toHaveTextContent('A01 · Occupied'))
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Property/ }))
    expect(screen.queryByRole('option', { name: 'Old Mill' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: 'Acacia Park' }))
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /^Unit/ })).toHaveTextContent('Choose a unit'))
    expect(others.units).toHaveBeenLastCalledWith(NEXUS_ID, expect.objectContaining({ propertyId: OTHER }))
  })
})
