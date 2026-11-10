import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import { isVerificationRunning } from '../api/queries'
import type { WhatsAppBusinessAccount, WhatsAppIntegrationSource, WhatsAppPhoneNumber } from '../api/source'
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

const BASE: WhatsAppPhoneNumber = {
  id: 'num-1',
  businessAccountId: '771001',
  phoneNumberId: '660001',
  displayName: '',
  displayNumber: '+27 11 555 0100',
  webhookConfigured: true,
  connectionStatus: 'pending_verification',
  verificationSteps: [],
  createdAt: '2026-11-10T09:00:00+02:00',
}

const NEEDS_PIN: WhatsAppPhoneNumber = {
  ...BASE,
  verificationSteps: [
    { step: 'token_scopes', status: 'passed', message: 'The business token is valid and covers WhatsApp Business Account 771001.' },
    { step: 'phone_number', status: 'passed' },
    { step: 'webhook_subscription', status: 'passed' },
    {
      step: 'registration',
      status: 'action_needed',
      message: 'The number must be registered for the WhatsApp Cloud API.',
      recovery: 'Click Register number and enter a 6-digit PIN.',
    },
    { step: 'message_templates', status: 'passed', message: '2 message template(s) synced from Meta, 1 approved.' },
  ],
}

const FAILED: WhatsAppPhoneNumber = {
  ...BASE,
  connectionStatus: 'error',
  verificationSteps: [
    { step: 'token_scopes', status: 'passed' },
    {
      step: 'phone_number',
      status: 'failed',
      message: 'Meta does not list number id 660001 in WhatsApp Business Account 771001.',
      recovery: 'Check the number in WhatsApp Manager, then connect it again.',
      metaErrorCode: '100',
    },
    { step: 'webhook_subscription', status: 'pending', message: 'Not checked: an earlier step did not pass.' },
    { step: 'registration', status: 'pending', message: 'Not checked: an earlier step did not pass.' },
    { step: 'message_templates', status: 'pending', message: 'Not checked: an earlier step did not pass.' },
  ],
}

const accounts = (number: WhatsAppPhoneNumber): WhatsAppBusinessAccount[] => [
  { id: 'acc-1', businessAccountId: '771001', name: 'Atlas Properties', createdAt: '2026-11-10T09:00:00+02:00', numbers: [number] },
]

async function renderScreen() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <WhatsAppIntegrationScreen />
    </QueryClientProvider>,
    '/settings/integrations/whatsapp',
  )
}

async function steps() {
  return screen.findByRole('list', { name: 'Verification steps' })
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  role.admin = true
  fakeSource.getCapabilities.mockReset().mockResolvedValue({
    embeddedSignupConfigured: true,
    webhookConfigured: true,
    agentRuntimeConfigured: true,
    workerReporting: true,
    missing: [],
  })
  fakeSource.listBusinessAccounts.mockReset().mockResolvedValue(accounts(NEEDS_PIN))
  fakeSource.listMessageTemplates.mockReset().mockResolvedValue([])
  fakeSource.verifyNumber.mockReset().mockResolvedValue({ numberId: 'num-1', status: 'queued', message: 'LeaseGuard is verifying the number with Meta.' })
  fakeSource.registerNumber.mockReset().mockResolvedValue({ numberId: 'num-1', status: 'queued', message: 'LeaseGuard is registering the number.' })
  fakeSource.disconnectNumber.mockReset().mockResolvedValue({ numberId: 'num-1', status: 'disconnected', tokenRemoved: true, message: 'Disconnected.' })
})

describe('number verification on the WhatsApp page', () => {
  it('shows every step in order, with the action Meta needs and how to do it', async () => {
    await renderScreen()
    const list = await steps()
    const items = within(list).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Access granted to LeaseGuardPassed'),
      expect.stringContaining('Number found in the WhatsApp Business AccountPassed'),
      expect.stringContaining('Messages and delivery updates (webhook)Passed'),
      expect.stringContaining('Registered for the WhatsApp Cloud APIAction needed'),
      expect.stringContaining('Message templates syncedPassed'),
    ])
    expect(items[3]).toHaveTextContent('How to fix: Click Register number and enter a 6-digit PIN.')
    expect(screen.getByText('Pending verification')).toBeInTheDocument()
  })

  it('says which step failed and why, and never shows a partially verified number as connected', async () => {
    fakeSource.listBusinessAccounts.mockResolvedValue(accounts(FAILED))
    await renderScreen()
    expect(await screen.findByText(/“Number found in the WhatsApp Business Account” failed/)).toBeInTheDocument()
    expect(screen.getByText('Meta error code 100')).toBeInTheDocument()
    expect(screen.getAllByText('Not checked yet')).toHaveLength(3)
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    // Nothing to register while an earlier step failed.
    expect(screen.queryByRole('button', { name: 'Register number' })).not.toBeInTheDocument()
  })

  it('registers the number with a 6-digit PIN, validated before it is sent', async () => {
    const user = userEvent.setup()
    await renderScreen()
    await user.click(await screen.findByRole('button', { name: 'Register number' }))
    const dialog = await screen.findByRole('dialog', { name: 'Register number' })
    expect(within(dialog).getByText(/never stores it/)).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText(/6-digit PIN/), '12a45')
    await user.click(within(dialog).getByRole('button', { name: 'Register number' }))
    expect(await within(dialog).findByText('Enter exactly 6 digits')).toBeInTheDocument()
    expect(fakeSource.registerNumber).not.toHaveBeenCalled()

    await user.clear(within(dialog).getByLabelText(/6-digit PIN/))
    await user.type(within(dialog).getByLabelText(/6-digit PIN/), '123456')
    await user.click(within(dialog).getByRole('button', { name: 'Register number' }))
    await waitFor(() => expect(fakeSource.registerNumber).toHaveBeenCalledWith(NEXUS_ID, 'num-1', '123456'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Register number' })).not.toBeInTheDocument())
  })

  it("shows Meta's registration lock from the API instead of retrying", async () => {
    fakeSource.registerNumber.mockRejectedValue(
      new ApiError(429, ['Meta has locked registration of this number after too many attempts, until 13 Nov 2026, 12:00.'], 'req-1'),
    )
    const user = userEvent.setup()
    await renderScreen()
    await user.click(await screen.findByRole('button', { name: 'Register number' }))
    const dialog = await screen.findByRole('dialog', { name: 'Register number' })
    await user.type(within(dialog).getByLabelText(/6-digit PIN/), '123456')
    await user.click(within(dialog).getByRole('button', { name: 'Register number' }))
    expect(await within(dialog).findByText(/locked registration of this number/)).toBeInTheDocument()
    expect(fakeSource.registerNumber).toHaveBeenCalledTimes(1)
  })

  it('offers Register number only once the run has finished, so the PIN is never sent to a run past that step', async () => {
    const stillSyncing: WhatsAppPhoneNumber = {
      ...NEEDS_PIN,
      verificationSteps: NEEDS_PIN.verificationSteps.map((s) =>
        s.step === 'message_templates' ? { step: s.step, status: 'pending', message: 'Checking with Meta…' } : s,
      ),
    }
    fakeSource.listBusinessAccounts.mockResolvedValue(accounts(stillSyncing))
    await renderScreen()
    expect(await screen.findByLabelText('Verification in progress')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Register number' })).not.toBeInTheDocument()
  })

  it('hides Register number while the lock lasts and says when it ends', async () => {
    fakeSource.listBusinessAccounts.mockResolvedValue(accounts({ ...NEEDS_PIN, registrationBlockedUntil: '2099-01-01T10:00:00+02:00' }))
    await renderScreen()
    expect(await screen.findByText(/registration lock ends/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Register number' })).not.toBeInTheDocument()
  })

  it('verifies again on request', async () => {
    const user = userEvent.setup()
    await renderScreen()
    await user.click(await screen.findByRole('button', { name: 'Verify again' }))
    await waitFor(() => expect(fakeSource.verifyNumber).toHaveBeenCalledWith(NEXUS_ID, 'num-1'))
  })

  it('disconnects only after confirmation', async () => {
    const user = userEvent.setup()
    await renderScreen()
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Disconnect +27 11 555 0100?' })
    expect(within(dialog).getByText(/deletes its stored access token/)).toBeInTheDocument()
    expect(fakeSource.disconnectNumber).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(fakeSource.disconnectNumber).toHaveBeenCalledWith(NEXUS_ID, 'num-1'))
  })

  it('shows a disconnected number without actions', async () => {
    fakeSource.listBusinessAccounts.mockResolvedValue(accounts({ ...BASE, connectionStatus: 'disconnected' }))
    await renderScreen()
    expect(await screen.findByText(/Disconnected\. Connect the number again/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
  })

  it('says when a number was disconnected in Meta, why, and how to connect again', async () => {
    fakeSource.listBusinessAccounts.mockResolvedValue(
      accounts({
        ...BASE,
        connectionStatus: 'disconnected',
        disconnectedAt: '2026-11-09T09:30:00+02:00',
        disconnectedReason: 'The business removed LeaseGuard from this WhatsApp Business Account in Meta.',
      }),
    )
    await renderScreen()
    expect(await screen.findByText(/The business removed LeaseGuard from this WhatsApp Business Account in Meta\./)).toBeInTheDocument()
    expect(screen.getByText(/09 Nov 2026/)).toBeInTheDocument()
    expect(screen.getByText(/LeaseGuard no longer has access to this number in Meta/)).toBeInTheDocument()
    // Whether the stored token was deleted is not known here (env-form token, or one still used elsewhere), so the page never claims it.
    expect(screen.queryByText(/deleted the stored access token/)).not.toBeInTheDocument()
    expect(screen.getByText(/company admin connects it with Connect WhatsApp Business/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
  })

  it("shows Meta's quality rating and messaging limit of a number", async () => {
    fakeSource.listBusinessAccounts.mockResolvedValue(accounts({ ...BASE, connectionStatus: 'connected', qualityRating: 'YELLOW', messagingLimitTier: 'TIER_1K' }))
    await renderScreen()
    const meta = await screen.findByText('YELLOW')
    expect(meta.closest('dl')).toHaveTextContent('QualityYELLOWMessaging limitTIER_1K')
  })

  it('shows steps but no actions to members who are not company admins', async () => {
    role.admin = false
    await renderScreen()
    await steps()
    expect(screen.queryByRole('button', { name: 'Register number' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
  })

  it('lists the synced templates with category, language and status', async () => {
    fakeSource.listMessageTemplates.mockResolvedValue([
      {
        id: 't1',
        businessAccountId: '771001',
        metaTemplateId: '9001',
        name: 'monthly_statement',
        language: 'en_ZA',
        category: 'UTILITY',
        status: 'APPROVED',
        syncedAt: '2026-11-10T10:00:00+02:00',
      },
      {
        id: 't2',
        businessAccountId: '771001',
        metaTemplateId: '9002',
        name: 'payment_reminder',
        language: 'en',
        category: 'UTILITY',
        status: 'REJECTED',
        rejectedReason: 'INVALID_FORMAT',
        syncedAt: '2026-11-10T10:00:00+02:00',
      },
    ])
    await renderScreen()
    const card = await screen.findByRole('region', { name: 'Message templates' })
    const rows = (await within(card).findAllByRole('row')).slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell').slice(0, 4).map((cell) => cell.textContent))).toEqual([
      ['monthly_statement', 'en_ZA', 'Utility', 'Approved'],
      ['payment_reminder', 'en', 'Utility', 'RejectedInvalid format'],
    ])
  })

  it("shows a status Meta changed after the sync, with when it changed", async () => {
    fakeSource.listMessageTemplates.mockResolvedValue([
      {
        id: 't3',
        businessAccountId: '771001',
        metaTemplateId: '9003',
        name: 'overdue_payment_reminder',
        language: 'en',
        category: 'UTILITY',
        status: 'PAUSED',
        rejectedReason: 'Low quality',
        syncedAt: '2026-11-08T10:00:00+02:00',
        statusUpdatedAt: '2026-11-10T10:00:00+02:00',
      },
    ])
    await renderScreen()
    const card = await screen.findByRole('region', { name: 'Message templates' })
    const [, row] = await within(card).findAllByRole('row')
    expect(within(card).getByRole('columnheader', { name: 'Last updated' })).toBeInTheDocument()
    expect(within(row!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'overdue_payment_reminder',
      'en',
      'Utility',
      'PausedLow quality',
      '10 Nov 2026',
    ])
  })

  it('says when no templates are synced yet', async () => {
    await renderScreen()
    const card = await screen.findByRole('region', { name: 'Message templates' })
    expect(await within(card).findByText(/No templates synced yet/)).toBeInTheDocument()
  })
})

describe('isVerificationRunning', () => {
  it('polls while a number is pending with steps still being checked, not while it waits for the PIN', () => {
    expect(isVerificationRunning(accounts(BASE))).toBe(true)
    expect(isVerificationRunning(accounts({ ...NEEDS_PIN, verificationSteps: [{ step: 'token_scopes', status: 'pending' }] }))).toBe(true)
    expect(isVerificationRunning(accounts(NEEDS_PIN))).toBe(false)
    expect(isVerificationRunning(accounts(FAILED))).toBe(false)
    expect(isVerificationRunning(undefined)).toBe(false)
  })
})
