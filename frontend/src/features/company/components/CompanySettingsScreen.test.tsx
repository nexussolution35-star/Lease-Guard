import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { CompanyProfile, CompanySource } from '../api/source'
import { CompanySettingsScreen } from './CompanySettingsScreen'

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
  tradingName: 'Nexus Properties',
  registrationNumber: '2019/123456/07',
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
      <CompanySettingsScreen />
      <Toaster />
    </QueryClientProvider>,
    '/settings/company',
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.admin = true
  for (const fn of Object.values(fakeSource)) fn.mockReset()
  fakeSource.get.mockResolvedValue(COMPANY)
})

describe('CompanySettingsScreen', () => {
  it('lets a company admin change the details and sends only what changed', async () => {
    fakeSource.update.mockResolvedValue({ ...COMPANY, tradingName: 'Nexus Commercial' })
    await renderScreen()
    const form = await screen.findByRole('form', { name: 'Company details' })
    expect(within(form).getByLabelText(/Registered name/)).toHaveValue('Nexus Properties (Pty) Ltd')

    const tradingName = within(form).getByLabelText('Trading name')
    await userEvent.clear(tradingName)
    await userEvent.type(tradingName, 'Nexus Commercial')
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Company details saved')).toBeInTheDocument()
    expect(fakeSource.update).toHaveBeenCalledWith(NEXUS_ID, { tradingName: 'Nexus Commercial' })
  })

  it('validates before saving', async () => {
    await renderScreen()
    const form = await screen.findByRole('form', { name: 'Company details' })
    const postalCode = within(form).getByLabelText(/Postal code/)
    await userEvent.clear(postalCode)
    await userEvent.type(postalCode, '21')
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await within(form).findByText('Enter the four-digit postal code')).toBeInTheDocument()
    expect(fakeSource.update).not.toHaveBeenCalled()
  })

  it('does not call the API when nothing changed', async () => {
    await renderScreen()
    const form = await screen.findByRole('form', { name: 'Company details' })
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/Nothing to save/)).toBeInTheDocument()
    expect(fakeSource.update).not.toHaveBeenCalled()
  })

  it('shows why the API refused a change', async () => {
    fakeSource.update.mockRejectedValue(new ApiError(403, ['Only company admins can change the company'], null))
    await renderScreen()
    const form = await screen.findByRole('form', { name: 'Company details' })
    await userEvent.type(within(form).getByLabelText('VAT number'), '4123456789')
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await within(form).findByText('Only company admins can change the company.')).toBeInTheDocument()
  })

  it('shows the details read-only to members who are not company admins', async () => {
    viewer.admin = false
    await renderScreen()
    expect(await screen.findByText('Nexus Properties (Pty) Ltd')).toBeInTheDocument()
    expect(screen.getByText(/Only company admins can change them/)).toBeInTheDocument()
    expect(screen.getByText('accounts@nexus.co.za')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Company details' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('shows what Nexus Solution manages', async () => {
    await renderScreen()
    const managed = await screen.findByRole('region', { name: 'Managed by Nexus Solution' })
    expect(within(managed).getByText('Active')).toBeInTheDocument()
    expect(within(managed).getByText('NP')).toBeInTheDocument()
    expect(within(managed).getByText('Africa/Johannesburg')).toBeInTheDocument()
  })

  it('offers a retry when the company cannot be loaded', async () => {
    fakeSource.get.mockRejectedValue(new ApiError(500, [], null))
    await renderScreen()
    expect(await screen.findByText('Could not load the company')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again|Retry/ })).toBeInTheDocument()
  })
})
