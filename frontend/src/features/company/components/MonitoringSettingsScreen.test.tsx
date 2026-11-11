import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { CompanyProfile, CompanySource } from '../api/source'
import { MonitoringSettingsScreen } from './MonitoringSettingsScreen'

const fakeSource = vi.hoisted(() => ({
  get: vi.fn<CompanySource['get']>(),
  update: vi.fn<CompanySource['update']>(),
  configureWhatsApp: vi.fn<CompanySource['configureWhatsApp']>(),
  getOnboarding: vi.fn<CompanySource['getOnboarding']>(),
}))
vi.mock('../api/apiSource', () => ({ createApiCompanySource: () => fakeSource }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ admin: true }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyAdmin: () => viewer.admin }))

const COMPANY: CompanyProfile = {
  id: NEXUS_ID,
  name: 'Nexus Properties (Pty) Ltd',
  address: { line1: '12 Fredman Drive', suburb: 'Sandown', city: 'Sandton', province: 'Gauteng', postalCode: '2196', country: 'South Africa' },
  contactEmail: 'accounts@nexus.co.za',
  contactPhone: '+27 11 555 0100',
  status: 'active',
  initials: 'NP',
  whatsapp: { connectionStatus: 'not_configured', numberCount: 0, connectedNumberCount: 0 },
  settings: {
    leaseExpiryNoticeDays: [180, 90, 30],
    renewalDeadlineWarningDays: [90, 30],
    guaranteeExpiryNoticeDays: [60, 30],
    paymentReminderOffsetsDays: { initial: 7, overdue: 14, followUp: 21 },
    installmentReminderLeadDays: 3,
    ownerSummaryWeekday: 'monday',
    timezone: 'Africa/Johannesburg',
  },
  createdAt: '2026-10-01T08:00:00+02:00',
  updatedAt: '2026-10-01T08:00:00+02:00',
}

function renderScreen() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <MonitoringSettingsScreen />
      <Toaster />
    </QueryClientProvider>,
    '/settings/notifications',
  )
}

const findForm = () => screen.findByRole('form', { name: 'Notice periods and reminder timing' })

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.admin = true
  for (const fn of Object.values(fakeSource)) fn.mockReset()
  fakeSource.get.mockResolvedValue(COMPANY)
})

describe('MonitoringSettingsScreen', () => {
  it('lets a company admin change the notice periods and sends only what changed', async () => {
    fakeSource.update.mockResolvedValue({ ...COMPANY, settings: { ...COMPANY.settings, leaseExpiryNoticeDays: [365, 180, 90] } })
    await renderScreen()
    const form = await findForm()
    const leaseExpiry = within(form).getByLabelText(/Lease expiry notices/)
    expect(leaseExpiry).toHaveValue('180, 90, 30')
    await userEvent.clear(leaseExpiry)
    await userEvent.type(leaseExpiry, '90, 365, 180')
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Settings saved')).toBeInTheDocument()
    expect(fakeSource.update).toHaveBeenCalledWith(NEXUS_ID, { settings: { leaseExpiryNoticeDays: [365, 180, 90] } })
  })

  it('refuses reminders that are out of order', async () => {
    await renderScreen()
    const form = await findForm()
    const overdue = within(form).getByLabelText(/Overdue reminder/)
    await userEvent.clear(overdue)
    await userEvent.type(overdue, '5')
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await within(form).findByText(/Reminders must go out in order/)).toBeInTheDocument()
    expect(fakeSource.update).not.toHaveBeenCalled()
  })

  it('refuses a notice list that repeats a day', async () => {
    await renderScreen()
    const form = await findForm()
    const guarantee = within(form).getByLabelText(/Bank guarantee expiry notices/)
    await userEvent.clear(guarantee)
    await userEvent.type(guarantee, '60, 60')
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await within(form).findByText('60 days is listed more than once')).toBeInTheDocument()
    expect(fakeSource.update).not.toHaveBeenCalled()
  })

  it('shows the timing read-only to members who are not company admins', async () => {
    viewer.admin = false
    await renderScreen()
    expect(await screen.findByText('180, 90, 30 days before')).toBeInTheDocument()
    expect(screen.getByText('14 days after the statement date')).toBeInTheDocument()
    expect(screen.getByText('Every Monday')).toBeInTheDocument()
    expect(screen.getByText(/Only company admins can change them/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('says tenant-message approval cannot be switched off, and offers no such setting', async () => {
    await renderScreen()
    await findForm()
    expect(screen.getByText(/Every tenant message needs a property manager's approval/)).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
