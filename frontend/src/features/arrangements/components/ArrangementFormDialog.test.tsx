import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { ArrangementSource } from '../api/source'
import { arrangementFixture, LEASE_ID, PROPERTY_ID, TENANT_ID, UNIT_ID } from '../test/arrangementFixtures'
import { ArrangementFormDialog } from './ArrangementFormDialog'

const fakeSource = vi.hoisted(() => ({
  list: vi.fn<ArrangementSource['list']>(),
  get: vi.fn<ArrangementSource['get']>(),
  create: vi.fn<ArrangementSource['create']>(),
  update: vi.fn<ArrangementSource['update']>(),
}))
const others = vi.hoisted(() => ({ tenants: vi.fn(), leases: vi.fn(), arrears: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getArrangementSource: () => fakeSource }))
vi.mock('@/features/tenants/api/selectSource', () => ({ getTenantSource: () => ({ list: others.tenants, get: vi.fn() }) }))
vi.mock('@/features/leases/api/selectSource', () => ({ getLeaseSource: () => ({ list: others.leases, get: vi.fn() }) }))
vi.mock('@/features/statements/api/arrearsSource', () => ({ createApiStatementArrearsSource: () => ({ summary: others.arrears }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const TODAY = new Date('2026-11-21T10:00:00+02:00')
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 100 })

function renderDialog(props: Partial<Parameters<typeof ArrangementFormDialog>[0]> = {}) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <ArrangementFormDialog open onOpenChange={() => undefined} {...props} />
      <Toaster />
    </QueryClientProvider>,
    '/arrangements',
  )
}

async function chooseTenantAndLease(dialog: HTMLElement) {
  await userEvent.click(within(dialog).getByRole('combobox', { name: /^Tenant/ }))
  await userEvent.click(await screen.findByRole('option', { name: 'Dlamini Cellular' }))
  await userEvent.click(within(dialog).getByRole('combobox', { name: /^Lease/ }))
  await userEvent.click(await screen.findByRole('option', { name: 'MSQ-L003 · Meadowlands Square · S03 · Active' }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  for (const fn of [...Object.values(fakeSource), ...Object.values(others)]) fn.mockReset()
  others.tenants.mockResolvedValue(page([{ ...sampleRecord('tenants'), id: TENANT_ID, tradingName: 'Dlamini Cellular' }]))
  others.leases.mockResolvedValue(
    page([
      {
        ...sampleRecord('leases'),
        id: LEASE_ID,
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        unitId: UNIT_ID,
        reference: 'MSQ-L003',
        status: 'active',
        tenantName: 'Dlamini Cellular',
        propertyName: 'Meadowlands Square',
        unitNumber: 'S03',
      },
    ]),
  )
  others.arrears.mockResolvedValue({
    asOf: '2026-11-21',
    ageingBuckets: [30, 60, 90],
    totalOutstanding: 18_600,
    tenantsInArrears: 1,
    tenantsUnderArrangement: 0,
    buckets: [],
    entries: [
      {
        tenantId: TENANT_ID,
        propertyId: PROPERTY_ID,
        leaseId: LEASE_ID,
        statementId: 's1',
        statementDate: '2026-11-01',
        outstanding: 18_600,
        ageDays: 20,
        bucket: 'current',
        underArrangement: false,
        remindersSuppressed: false,
      },
    ],
  })
  fakeSource.create.mockImplementation(async (_company, body) => arrangementFixture({ ...body, id: 'a1b2c3d4-0000-4000-8000-0000000000a9' }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ArrangementFormDialog', () => {
  it('says LeaseGuard records the agreement and never takes a payment', async () => {
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Record payment arrangement' })
    expect(dialog).toHaveTextContent('it never takes or processes a payment')
    for (const section of ['Tenant and lease', 'Terms', 'Schedule', 'Status', 'Notes']) {
      expect(within(dialog).getByRole('group', { name: section })).toBeInTheDocument()
    }
    expect(within(dialog).queryByRole('button', { name: /pay/i })).not.toBeInTheDocument()
  })

  it('asks for the required fields before sending anything', async () => {
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Record payment arrangement' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record arrangement' }))
    expect(await within(dialog).findByText('Choose the tenant')).toBeInTheDocument()
    expect(within(dialog).getByText('Enter the instalment amount')).toBeInTheDocument()
    expect(fakeSource.create).not.toHaveBeenCalled()
  })

  it("fills the balance from the lease's latest verified statement, previews the domain schedule and records it", async () => {
    await renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Record payment arrangement' })
    await chooseTenantAndLease(dialog)
    await waitFor(() => expect(within(dialog).getByLabelText(/^Outstanding balance agreed/)).toHaveValue('18 600,00'))
    expect(dialog).toHaveTextContent('The latest verified statement (01 Nov 2026) shows R 18 600,00 outstanding on this lease.')

    await userEvent.type(within(dialog).getByLabelText(/^Instalment amount/), '5000')
    await userEvent.click(within(dialog).getByRole('button', { name: /^First instalment due/ }))
    const calendar = await screen.findByRole('dialog', { name: 'Choose First instalment due' })
    await userEvent.click(within(calendar).getByRole('button', { name: /November 28th, 2026/ }))
    // The preview is `previewInstallmentSchedule`: three of R 5 000 and the remainder.
    const preview = await within(dialog).findByRole('table', { name: 'Instalment schedule preview' })
    expect(within(preview).getAllByRole('row')).toHaveLength(5)
    expect(preview).toHaveTextContent('R 3 600,00')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Record arrangement' }))
    await waitFor(() =>
      expect(fakeSource.create).toHaveBeenCalledWith(
        NEXUS_ID,
        expect.objectContaining({
          firstInstallmentDate: '2026-11-28',
          tenantId: TENANT_ID,
          propertyId: PROPERTY_ID,
          leaseId: LEASE_ID,
          outstandingBalance: 18_600,
          installmentAmount: 5_000,
          frequency: 'monthly',
          agreedOn: '2026-11-21',
          status: 'active',
        }),
      ),
    )
    expect(await screen.findByText(/recorded; normal arrears reminders are paused/)).toBeInTheDocument()
  })

  it('shows the domain rules across the terms and does not send them while they fail', async () => {
    const arrangement = arrangementFixture({ installments: arrangementFixture().installments.map((i) => ({ ...i, status: 'scheduled' as const })) })
    await renderDialog({ arrangement })
    const dialog = await screen.findByRole('dialog', { name: 'Edit arrangement with Dlamini Cellular' })
    const amount = within(dialog).getByLabelText(/^Instalment amount/)
    await userEvent.clear(amount)
    await userEvent.type(amount, '40000')
    await userEvent.tab()
    expect(await within(dialog).findByText('The instalment amount cannot be more than the outstanding balance.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('The terms cannot be saved yet. The schedule below says why.')).toBeInTheDocument()
    expect(fakeSource.update).not.toHaveBeenCalled()
  })

  it('fixes the schedule once an outcome is recorded and shows a database refusal in words', async () => {
    fakeSource.update.mockRejectedValue(new ApiError(409, ['This arrangement is completed and can no longer change.'], null))
    await renderDialog({ arrangement: arrangementFixture() })
    const dialog = await screen.findByRole('dialog', { name: 'Edit arrangement with Dlamini Cellular' })
    expect(within(dialog).getByRole('note')).toHaveTextContent('the schedule is fixed')
    expect(within(dialog).getByLabelText(/^Instalment amount/)).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/^Notes/), 'Called the tenant')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(fakeSource.update).toHaveBeenCalledWith(NEXUS_ID, arrangementFixture().id, { notes: 'Called the tenant' }),
    )
    expect(await within(dialog).findByText('This arrangement is completed and can no longer change.')).toBeInTheDocument()
  })
})
