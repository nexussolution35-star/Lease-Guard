import { ApiError } from '@leaseguard/api-client'
import type { Property } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'
import { sampleRecord } from '@/test/fakeApi'

import type { UnitSource } from '../api/source'
import { UnitFormDialog } from './UnitFormDialog'

const fakeUnits = vi.hoisted(() => ({
  list: vi.fn<UnitSource['list']>(),
  get: vi.fn<UnitSource['get']>(),
  create: vi.fn<UnitSource['create']>(),
  update: vi.fn<UnitSource['update']>(),
}))
const properties = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getUnitSource: () => fakeUnits }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => ({ list: properties.list, get: vi.fn() }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const property = (id: string, name: string, status: Property['status']): Property => ({ ...sampleRecord('properties'), id, name, status, companyId: NEXUS_ID })
const ACTIVE = property('f922b1e8-d0cd-5a20-8393-829bec4dbc49', 'Maponya Square', 'active')
const ARCHIVED = property('f922b1e8-d0cd-5a20-8393-829bec4dbc50', 'Old Mill', 'archived')

function renderDialog() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <UnitFormDialog open onOpenChange={() => undefined} />
      <Toaster />
    </QueryClientProvider>,
    '/units',
  )
}

async function choose(dialog: HTMLElement, label: RegExp, option: string) {
  await userEvent.click(within(dialog).getByRole('combobox', { name: label }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  for (const fn of [...Object.values(fakeUnits), properties.list]) fn.mockReset()
  properties.list.mockResolvedValue({ items: [ACTIVE, ARCHIVED], total: 2, page: 1, pageSize: 100 })
})

describe('UnitFormDialog', () => {
  it('offers only properties that are not archived and puts a taken unit number on its field', { timeout: 20_000 }, async () => {
    fakeUnits.create.mockRejectedValue(new ApiError(409, ['A unit numbered G12 already exists in this property'], null))
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add unit' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Property/ }))
    expect(await screen.findByRole('option', { name: 'Maponya Square' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Old Mill' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'Maponya Square' }))
    await userEvent.type(within(dialog).getByLabelText(/^Unit number/), 'G12')
    await choose(dialog, /^Unit type/, 'Kiosk')
    await userEvent.type(within(dialog).getByLabelText(/^Floor area/), '12.5')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add unit' }))
    expect(await within(dialog).findByText('A unit numbered G12 already exists in this property.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^Unit number/)).toHaveAttribute('aria-invalid', 'true')
    expect(fakeUnits.create).toHaveBeenCalledWith(NEXUS_ID, { propertyId: ACTIVE.id, unitNumber: 'G12', type: 'kiosk', floorAreaSqm: 12.5, occupancyStatus: 'vacant' })
  })

  it('asks for the required fields before sending anything', async () => {
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Add unit' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add unit' }))
    expect(await within(dialog).findByText('Choose the property')).toBeInTheDocument()
    expect(within(dialog).getByText('Enter the unit number')).toBeInTheDocument()
    expect(fakeUnits.create).not.toHaveBeenCalled()
  })
})
