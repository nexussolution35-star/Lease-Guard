import { ApiError } from '@leaseguard/api-client'
import type { MonitoringEventListItem } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import type { CompanyMember } from '@/features/users/api/source'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { ArrangementSource } from '../api/source'
import { ARRANGEMENT_ID, arrangementFixture, LEASE_ID, MANAGER_ID } from '../test/arrangementFixtures'
import { ArrangementDetailScreen } from './ArrangementDetailScreen'

const fakeSource = vi.hoisted(() => ({
  list: vi.fn<ArrangementSource['list']>(),
  get: vi.fn<ArrangementSource['get']>(),
  update: vi.fn<ArrangementSource['update']>(),
  close: vi.fn<ArrangementSource['close']>(),
  cancel: vi.fn<ArrangementSource['cancel']>(),
  recordInstallmentOutcome: vi.fn<ArrangementSource['recordInstallmentOutcome']>(),
}))
const others = vi.hoisted(() => ({ events: vi.fn(), members: vi.fn() }))
vi.mock('../api/selectSource', () => ({ getArrangementSource: () => fakeSource }))
vi.mock('@/features/monitoring/api/selectSource', () => ({ getMonitoringEventSource: () => ({ list: others.events, get: vi.fn() }) }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => ({ listMembers: others.members }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))
const viewer = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyWriter: () => viewer.writer }))

const TODAY = new Date('2026-11-21T10:00:00+02:00')
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 100 })
const member = { id: MANAGER_ID, fullName: 'Naledi van der Merwe', status: 'active' } as unknown as CompanyMember
const flag: MonitoringEventListItem = {
  ...sampleRecord('monitoringEvents'),
  id: 'e0000000-0000-4000-8000-000000000001',
  type: 'arrangement_attention',
  leaseId: LEASE_ID,
  arrangementId: ARRANGEMENT_ID,
  title: 'Instalment 2 not covered on the October statement',
  status: 'new',
  propertyName: 'Meadowlands Square',
}

function renderScreen(arrangement = arrangementFixture()) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <ArrangementDetailScreen arrangement={arrangement} />
      <Toaster />
    </QueryClientProvider>,
    `/arrangements/${arrangement.id}`,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = true
  for (const fn of [...Object.values(fakeSource), ...Object.values(others)]) fn.mockReset()
  others.events.mockResolvedValue(page([flag]))
  others.members.mockResolvedValue(page([member]))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ArrangementDetailScreen', () => {
  it('shows the agreement, its progress and the schedule with outcomes, and says no payment is taken', async () => {
    await renderScreen()
    expect(screen.getByRole('note')).toHaveTextContent('it never takes, processes or verifies a payment')
    expect(screen.getByRole('note')).toHaveTextContent('normal arrears reminders to the tenant are paused')
    // A verified statement never confirms an instalment: it flags one for the property manager to confirm.
    expect(screen.getByRole('note')).toHaveTextContent(
      'Instalments are confirmed by a property manager; a verified statement only flags an instalment for the manager to confirm.',
    )
    expect(screen.getByRole('note')).not.toHaveTextContent('confirmed from verified statements')

    const schedule = screen.getByRole('table', { name: 'Instalment schedule of the arrangement with Dlamini Cellular' })
    const rows = within(schedule).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toHaveTextContent('15 Aug 2026')
    expect(rows[0]).toHaveTextContent('Confirmed paid')
    expect(await within(rows[0]!).findByText('Naledi van der Merwe')).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('Past due, not confirmed')
    expect(rows[4]).toHaveTextContent('15 Dec 2026')
    expect(rows[4]).toHaveTextContent('Scheduled')

    // Progress is `arrangementProgress`: one instalment of R 6 200 confirmed, R 24 800 still to pay.
    expect(screen.getByText('1 of 5 instalments')).toBeInTheDocument()
    expect(screen.getByText('R 24 800,00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument()

    const flagged = screen.getByRole('region', { name: 'Flagged by monitoring' })
    expect(await within(flagged).findByText('Instalment 2 not covered on the October statement')).toBeInTheDocument()
    // The findings are asked for this arrangement on the server, not every finding on the lease filtered here.
    expect(others.events).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ type: 'arrangement_attention', arrangementId: ARRANGEMENT_ID }))
    expect(others.events.mock.calls[0]?.[1]).not.toHaveProperty('leaseId')
  })

  it('offers an active arrangement edit, cancel and close, with close as the one primary action last', async () => {
    await renderScreen()
    const buttons = ['Cancel arrangement', 'Edit', 'Close arrangement'].map((name) => screen.getByRole('button', { name }))
    expect(buttons[2]!.compareDocumentPosition(buttons[1]!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Make active' })).not.toBeInTheDocument()
  })

  it('records an instalment outcome, never letting one not yet due be missed', async () => {
    fakeSource.recordInstallmentOutcome.mockResolvedValue(arrangementFixture())
    await renderScreen()
    await userEvent.click(screen.getByRole('button', { name: 'Record the outcome of instalment 5' }))
    let dialog = await screen.findByRole('dialog', { name: 'Instalment 5' })
    expect(within(dialog).getByRole('radio', { name: 'Missed' })).toBeDisabled()
    expect(dialog).toHaveTextContent('Instalment 5 is due on 15 Dec 2026, so it cannot be missed yet.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await userEvent.click(screen.getByRole('button', { name: 'Record the outcome of instalment 2' }))
    dialog = await screen.findByRole('dialog', { name: 'Instalment 2' })
    expect(dialog).toHaveTextContent('it does not see or verify payments')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Missed' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record outcome' }))
    await waitFor(() =>
      expect(fakeSource.recordInstallmentOutcome).toHaveBeenCalledWith(NEXUS_ID, ARRANGEMENT_ID, 'b0000000-0000-4000-8000-000000000002', { outcome: 'missed' }),
    )
  })

  it('closes as completed or defaulted, and cancelling asks for the reason and shows a refusal inside the dialog', async () => {
    fakeSource.close.mockResolvedValue(arrangementFixture({ status: 'defaulted', closedOn: '2026-11-21' }))
    await renderScreen()
    await userEvent.click(screen.getByRole('button', { name: 'Close arrangement' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close the arrangement with Dlamini Cellular?' })
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Defaulted' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close arrangement' }))
    await waitFor(() => expect(fakeSource.close).toHaveBeenCalledWith(NEXUS_ID, ARRANGEMENT_ID, { outcome: 'defaulted' }))

    fakeSource.cancel.mockRejectedValue(new ApiError(409, ['This arrangement is defaulted and can no longer change.'], null))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel arrangement' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Cancel the arrangement with Dlamini Cellular?' })
    expect(within(confirm).getByRole('button', { name: 'Cancel arrangement' })).toBeDisabled()
    await userEvent.type(within(confirm).getByLabelText('Reason for cancelling'), 'Tenant vacated')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel arrangement' }))
    expect(await within(confirm).findByText('This arrangement is defaulted and can no longer change.')).toBeInTheDocument()
    expect(fakeSource.cancel).toHaveBeenCalledWith(NEXUS_ID, ARRANGEMENT_ID, { reason: 'Tenant vacated' })
  })

  it('makes a proposal active as its one primary action', async () => {
    fakeSource.update.mockResolvedValue(arrangementFixture())
    await renderScreen(arrangementFixture({ status: 'proposed', installments: [] }))
    expect(screen.getByRole('note')).toHaveTextContent('Normal arrears reminders carry on until it is made active.')
    expect(screen.queryByRole('button', { name: 'Close arrangement' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Make active' }))
    const confirm = await screen.findByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Make active' }))
    await waitFor(() => expect(fakeSource.update).toHaveBeenCalledWith(NEXUS_ID, ARRANGEMENT_ID, { status: 'active' }))
  })

  it('is read-only for a closed arrangement or a read-only member', async () => {
    await renderScreen(arrangementFixture({ status: 'completed', closedOn: '2026-11-20', closedByUserId: MANAGER_ID, closeReason: 'Paid in full' }))
    expect(screen.queryByRole('button', { name: /arrangement|Edit|outcome/ })).not.toBeInTheDocument()
    expect(screen.getByText('Paid in full')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Normal arrears reminders apply again.')
  })

  it('hides every write from a read-only member', async () => {
    viewer.writer = false
    await renderScreen()
    expect(screen.queryByRole('button', { name: /arrangement|Edit|outcome/ })).not.toBeInTheDocument()
  })
})
