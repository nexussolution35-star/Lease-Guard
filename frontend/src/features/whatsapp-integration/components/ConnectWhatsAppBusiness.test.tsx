import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { WhatsAppCapabilities, WhatsAppIntegrationSource, WhatsAppOnboardingSession } from '../api/source'
import type { FacebookLoginResponse, FacebookSdk } from '../embedded-signup/embeddedSignup'
import { WhatsAppIntegrationScreen } from './WhatsAppIntegrationScreen'

const fakeSource = vi.hoisted(() => ({
  getCapabilities: vi.fn<WhatsAppIntegrationSource['getCapabilities']>(),
  listBusinessAccounts: vi.fn<WhatsAppIntegrationSource['listBusinessAccounts']>(),
  startOnboarding: vi.fn<WhatsAppIntegrationSource['startOnboarding']>(),
  completeOnboarding: vi.fn<WhatsAppIntegrationSource['completeOnboarding']>(),
}))
vi.mock('../api/selectSource', () => ({ getWhatsAppIntegrationSource: () => fakeSource }))

const role = vi.hoisted(() => ({ admin: true }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyAdmin: () => role.admin }))

/** Meta's popup: posts `messages` to this window, then answers the login callback with `response`. Never facebook.com. */
const popup = vi.hoisted(() => ({ response: {} as FacebookLoginResponse, messages: [] as { origin: string; data: string }[] }))
const sdk = vi.hoisted(() => ({ init: vi.fn(), login: vi.fn() }))
const loadFacebookSdk = vi.hoisted(() => vi.fn())
vi.mock('../embedded-signup/facebookSdk', () => ({ loadFacebookSdk }))

const CONFIGURED: WhatsAppCapabilities = {
  embeddedSignupConfigured: true,
  webhookConfigured: false,
  agentRuntimeConfigured: false,
  workerReporting: false,
  appId: '1234567890',
  embeddedSignupConfigId: '987654321',
  missing: [],
}
const SESSION: WhatsAppOnboardingSession = {
  sessionId: '7a1d2c1e-0000-4000-8000-000000000009',
  state: 'c'.repeat(64),
  expiresAt: '2026-11-10T10:15:00+02:00',
  appId: '1234567890',
  configId: '987654321',
  graphApiVersion: 'v27.0',
  extras: { version: 'v5' },
}
const V5_FINISH = { phone_number_id: '106540352242922', messaging_account_ids: ['524126980791429'], business_id: '2729063490586005' }
const message = (event: string, data: Record<string, unknown>, origin = 'https://www.facebook.com') => ({
  origin,
  data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data, version: 5 }),
})

async function renderScreen() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <WhatsAppIntegrationScreen />
    </QueryClientProvider>,
    '/settings/integrations/whatsapp',
  )
}

async function connect() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Connect WhatsApp Business' }))
  const dialog = await screen.findByRole('dialog', { name: 'Continue in Meta’s window' })
  await user.click(within(dialog).getByRole('button', { name: 'Continue to Meta' }))
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  role.admin = true
  popup.response = { authResponse: { code: 'AQD-code' } }
  popup.messages = [message('FINISH', V5_FINISH)]
  sdk.login.mockReset().mockImplementation((callback: (response: FacebookLoginResponse) => void) => {
    for (const m of popup.messages) window.dispatchEvent(new MessageEvent('message', m))
    callback(popup.response)
  })
  loadFacebookSdk.mockReset().mockResolvedValue(sdk as FacebookSdk)
  fakeSource.getCapabilities.mockReset().mockResolvedValue(CONFIGURED)
  fakeSource.listBusinessAccounts.mockReset().mockResolvedValue([])
  fakeSource.startOnboarding.mockReset().mockResolvedValue(SESSION)
  fakeSource.completeOnboarding.mockReset()
})

describe('Connect WhatsApp Business', () => {
  it('runs Embedded Signup and shows the new number as pending verification', async () => {
    fakeSource.completeOnboarding.mockResolvedValue({
      sessionId: SESSION.sessionId,
      status: 'exchanged',
      message: 'WhatsApp Business is connected to LeaseGuard. The number is pending verification.',
      businessAccountIds: ['524126980791429'],
      phoneNumberIds: ['106540352242922'],
    })
    await renderScreen()
    await connect()

    expect(await screen.findByText('WhatsApp Business connected: pending verification')).toBeInTheDocument()
    expect(screen.getByText(/Number 106540352242922 now shows below as pending verification/)).toBeInTheDocument()
    expect(fakeSource.startOnboarding).toHaveBeenCalledWith(NEXUS_ID)
    expect(loadFacebookSdk).toHaveBeenCalledWith('1234567890', 'v27.0')
    expect(sdk.login).toHaveBeenCalledWith(expect.any(Function), {
      config_id: '987654321',
      response_type: 'code',
      override_default_response_type: true,
      extras: { version: 'v5' },
    })
    expect(fakeSource.completeOnboarding).toHaveBeenCalledWith(NEXUS_ID, SESSION.sessionId, {
      state: SESSION.state,
      event: 'FINISH',
      code: 'AQD-code',
      sessionInfo: V5_FINISH,
    })
    // The numbers are read again, so the new pending number appears.
    expect(fakeSource.listBusinessAccounts.mock.calls.length).toBeGreaterThan(1)
  })

  it('forwards a cancel (ignoring messages from other origins) and shows how to start again', async () => {
    popup.response = { authResponse: null }
    popup.messages = [message('FINISH', V5_FINISH, 'https://evil.example'), message('CANCEL', { current_step: 'PHONE_NUMBER_SETUP' })]
    fakeSource.completeOnboarding.mockResolvedValue({
      sessionId: SESSION.sessionId,
      status: 'cancelled',
      message: 'You closed Meta’s signup before it finished, so nothing was connected. Click Connect WhatsApp Business to start again.',
      businessAccountIds: [],
      phoneNumberIds: [],
    })
    await renderScreen()
    await connect()

    expect(await screen.findByText('Signup cancelled')).toBeInTheDocument()
    expect(screen.getByText(/Click Connect WhatsApp Business to start again/)).toBeInTheDocument()
    expect(fakeSource.completeOnboarding).toHaveBeenCalledWith(NEXUS_ID, SESSION.sessionId, {
      state: SESSION.state,
      event: 'CANCEL',
      sessionInfo: { current_step: 'PHONE_NUMBER_SETUP' },
    })
  })

  it('shows the API’s explanation when the session can no longer be completed', async () => {
    fakeSource.completeOnboarding.mockRejectedValue(new ApiError(409, ['This WhatsApp signup expired, or a newer one was started, before it was completed.'], 'req-1'))
    await renderScreen()
    await connect()
    expect(await screen.findByText('The signup could not be completed')).toBeInTheDocument()
    expect(screen.getByText(/newer one was started, before it was completed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect WhatsApp Business' })).toBeEnabled()
  })

  it('explains when Facebook’s script cannot load, without opening a popup', async () => {
    loadFacebookSdk.mockRejectedValue(new Error('Facebook’s sign-in script could not be loaded.'))
    await renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Connect WhatsApp Business' }))
    expect(await screen.findByText('The signup could not be started')).toBeInTheDocument()
    expect(sdk.login).not.toHaveBeenCalled()
  })

  it('is disabled with an explanation while Embedded Signup is not configured', async () => {
    fakeSource.getCapabilities.mockResolvedValue({ ...CONFIGURED, embeddedSignupConfigured: false })
    await renderScreen()
    const card = await screen.findByRole('region', { name: 'Connect WhatsApp Business' })
    expect(await within(card).findByText(/Requires Meta configuration/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Connect WhatsApp Business' })).toBeDisabled()
  })

  it('is not offered to members who are not company admins', async () => {
    role.admin = false
    await renderScreen()
    await screen.findByText(/Only company admins can connect/)
    expect(screen.queryByRole('region', { name: 'Connect WhatsApp Business' })).not.toBeInTheDocument()
  })
})
