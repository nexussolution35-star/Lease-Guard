import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { WhatsAppBusinessAccount, WhatsAppCapabilities, WhatsAppIntegrationSource } from '../api/source'
import { WhatsAppIntegrationScreen } from './WhatsAppIntegrationScreen'

const fakeSource = vi.hoisted(() => ({
  getCapabilities: vi.fn<WhatsAppIntegrationSource['getCapabilities']>(),
  listBusinessAccounts: vi.fn<WhatsAppIntegrationSource['listBusinessAccounts']>(),
  listMessageTemplates: vi.fn<WhatsAppIntegrationSource['listMessageTemplates']>(),
  verifyNumber: vi.fn<WhatsAppIntegrationSource['verifyNumber']>(),
  registerNumber: vi.fn<WhatsAppIntegrationSource['registerNumber']>(),
  disconnectNumber: vi.fn<WhatsAppIntegrationSource['disconnectNumber']>(),
}))
vi.mock('../api/selectSource', () => ({ getWhatsAppIntegrationSource: () => fakeSource }))

const role = vi.hoisted(() => ({ admin: true }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyAdmin: () => role.admin }))

const NOT_CONFIGURED: WhatsAppCapabilities = {
  embeddedSignupConfigured: false,
  webhookConfigured: false,
  agentRuntimeConfigured: false,
  workerReporting: true,
  workerReportedAt: '2026-11-10T08:00:00.000Z',
  missing: [
    { capability: 'embedded_signup', setting: 'WHATSAPP_APP_ID', process: 'api' },
    { capability: 'embedded_signup', setting: 'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID', process: 'api' },
    { capability: 'embedded_signup', setting: 'WHATSAPP_APP_SECRET', process: 'api' },
    { capability: 'webhook', setting: 'WHATSAPP_APP_SECRET', process: 'api' },
    { capability: 'webhook', setting: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', process: 'api' },
    { capability: 'agent_runtime', setting: 'ANTHROPIC_API_KEY', process: 'worker' },
  ],
}

const CONFIGURED: WhatsAppCapabilities = {
  embeddedSignupConfigured: true,
  webhookConfigured: true,
  agentRuntimeConfigured: true,
  workerReporting: true,
  appId: '1234567890',
  embeddedSignupConfigId: '987654321',
  workerReportedAt: '2026-11-10T08:00:00.000Z',
  missing: [],
}

const ACCOUNTS: WhatsAppBusinessAccount[] = [
  {
    id: 'acc-1',
    businessAccountId: '102938475610',
    name: 'Nexus Leasing',
    createdAt: '2026-11-01T08:00:00+02:00',
    numbers: [
      {
        id: 'num-1',
        businessAccountId: '102938475610',
        phoneNumberId: '564738291045',
        displayName: 'Nexus Leasing',
        displayNumber: '+27 11 555 0100',
        verifiedName: 'Nexus Leasing (Pty) Ltd',
        qualityRating: 'GREEN',
        webhookConfigured: true,
        connectionStatus: 'connected',
        lastVerifiedAt: '2026-11-04T10:00:00+02:00',
        verificationSteps: (['token_scopes', 'phone_number', 'webhook_subscription', 'registration', 'message_templates'] as const).map((step) => ({
          step,
          status: 'passed' as const,
        })),
        createdAt: '2026-11-01T09:00:00+02:00',
      },
      {
        id: 'num-2',
        businessAccountId: '102938475610',
        phoneNumberId: '564738291046',
        displayName: 'Nexus Collections',
        displayNumber: '+27 11 555 0101',
        webhookConfigured: false,
        connectionStatus: 'pending_verification',
        verificationSteps: [
          { step: 'token_scopes', status: 'passed', message: 'The business token is valid.' },
          { step: 'phone_number', status: 'passed' },
          { step: 'webhook_subscription', status: 'passed' },
          { step: 'registration', status: 'action_needed', message: 'The number must be registered.', recovery: 'Click Register number and enter a 6-digit PIN.' },
          { step: 'message_templates', status: 'passed' },
        ],
        createdAt: '2026-11-02T09:00:00+02:00',
      },
    ],
  },
  { id: 'acc-2', businessAccountId: '200300400500', createdAt: '2026-11-03T08:00:00+02:00', numbers: [] },
]

async function renderScreen() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <WhatsAppIntegrationScreen />
    </QueryClientProvider>,
    '/settings/integrations/whatsapp',
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  role.admin = true
  fakeSource.getCapabilities.mockReset().mockResolvedValue(CONFIGURED)
  fakeSource.listBusinessAccounts.mockReset().mockResolvedValue(ACCOUNTS)
  fakeSource.listMessageTemplates.mockReset().mockResolvedValue([])
  fakeSource.verifyNumber.mockReset()
  fakeSource.registerNumber.mockReset()
  fakeSource.disconnectNumber.mockReset()
})

describe('WhatsAppIntegrationScreen', () => {
  it('shows a loading state while the numbers load', async () => {
    fakeSource.listBusinessAccounts.mockReturnValue(new Promise(() => undefined))
    await renderScreen()
    expect(screen.getByRole('heading', { level: 1, name: 'WhatsApp' })).toBeInTheDocument()
    expect((await screen.findAllByRole('status')).length).toBeGreaterThan(0)
  })

  it("lists the company's accounts and numbers with the status LeaseGuard verified", async () => {
    await renderScreen()

    const account = await screen.findByRole('region', { name: 'Nexus Leasing' })
    expect(within(account).getByText('Meta account id 102938475610')).toBeInTheDocument()
    // Each number has its row and a row with its verification steps.
    const rows = within(account).getAllByRole('row').slice(1).filter((_, i) => i % 2 === 0)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('+27 11 555 0100')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Nexus Leasing (Pty) Ltd')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Connected')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('GREEN')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('04 Nov 2026')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Pending verification')).toBeInTheDocument()
    expect(within(rows[1]!).queryByText('Connected')).not.toBeInTheDocument()

    const empty = screen.getByRole('region', { name: 'WhatsApp Business Account 200300400500' })
    expect(within(empty).getByText('No numbers in this account yet.')).toBeInTheDocument()
    expect(fakeSource.listBusinessAccounts).toHaveBeenCalledWith(NEXUS_ID)
  })

  it('says exactly what is missing and that Meta configuration or approval is required, never that it is connected', async () => {
    fakeSource.getCapabilities.mockResolvedValue(NOT_CONFIGURED)
    fakeSource.listBusinessAccounts.mockResolvedValue([])
    await renderScreen()

    const banner = await screen.findByRole('alert', { name: 'Requires Meta configuration or approval' })
    expect(within(banner).getByText(/WHATSAPP_APP_ID/)).toBeInTheDocument()
    expect(within(banner).getByText(/WHATSAPP_WEBHOOK_VERIFY_TOKEN/)).toBeInTheDocument()
    expect(within(banner).getByText(/ANTHROPIC_API_KEY \(worker\)/)).toBeInTheDocument()

    const setup = screen.getByRole('region', { name: 'Meta setup' })
    expect(within(setup).getAllByText('Requires configuration')).toHaveLength(3)
    expect(within(setup).queryByText('Configured')).not.toBeInTheDocument()

    expect(await screen.findByText('No WhatsApp numbers yet')).toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
  })

  it('says the worker is not reporting instead of blaming ANTHROPIC_API_KEY when no worker has reported', async () => {
    const { workerReportedAt: _reported, ...rest } = CONFIGURED
    fakeSource.getCapabilities.mockResolvedValue({ ...rest, agentRuntimeConfigured: false, workerReporting: false, missing: [] })
    await renderScreen()

    const banner = await screen.findByRole('alert', { name: 'Requires Meta configuration or approval' })
    expect(within(banner).getByText(/worker has not reported in the last five minutes/)).toBeInTheDocument()
    expect(within(banner).queryByText(/ANTHROPIC_API_KEY/)).not.toBeInTheDocument()

    const setup = screen.getByRole('region', { name: 'Meta setup' })
    expect(within(setup).getByText('Worker not reporting')).toBeInTheDocument()
    expect(within(setup).queryByText('Requires configuration')).not.toBeInTheDocument()
    expect(within(setup).queryByText(/The worker last reported/)).not.toBeInTheDocument()
  })

  it('shows when the worker last reported', async () => {
    await renderScreen()
    const setup = await screen.findByRole('region', { name: 'Meta setup' })
    expect(await within(setup).findByText(/The worker last reported/)).toHaveTextContent(/10 Nov 2026/)
  })

  it('still explains that Meta must approve the app when LeaseGuard is fully configured', async () => {
    await renderScreen()
    const setup = await screen.findByRole('region', { name: 'Meta setup' })
    expect(await within(setup).findAllByText('Configured')).toHaveLength(3)
    expect(screen.queryByRole('alert', { name: 'Requires Meta configuration or approval' })).not.toBeInTheDocument()
    expect(within(setup).getByText(/App Review/)).toBeInTheDocument()
  })

  it('is read-only for members who are not company admins', async () => {
    role.admin = false
    await renderScreen()
    expect(await screen.findByText(/Only company admins can connect or change WhatsApp numbers/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument()
  })

  it('does not show the read-only notice to company admins', async () => {
    await renderScreen()
    await screen.findByRole('region', { name: 'Nexus Leasing' })
    expect(screen.queryByText(/Only company admins can connect or change WhatsApp numbers/)).not.toBeInTheDocument()
  })

  it('shows an API error with a working retry', async () => {
    fakeSource.listBusinessAccounts.mockRejectedValueOnce(new ApiError(503, ['The database is not available'], 'req-1'))
    await renderScreen()
    expect(await screen.findByText('The database is not available')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('region', { name: 'Nexus Leasing' })).toBeInTheDocument()
  })

  it('shows when the setup status cannot be loaded', async () => {
    fakeSource.getCapabilities.mockRejectedValue(new ApiError(503, ['Service unavailable'], 'req-2'))
    await renderScreen()
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument()
  })
})
