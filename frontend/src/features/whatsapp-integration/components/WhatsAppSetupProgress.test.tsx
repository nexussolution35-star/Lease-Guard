import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { WhatsAppBusinessAccount, WhatsAppIntegrationSource, WhatsAppSetup, WhatsAppSetupStepStatus } from '../api/source'
import { WhatsAppSetupProgress } from './WhatsAppSetupProgress'
import { WhatsAppSetupSummary } from './WhatsAppSetupSummary'

const fakeSource = vi.hoisted(() => ({
  getSetup: vi.fn<WhatsAppIntegrationSource['getSetup']>(),
  sendTestMessage: vi.fn<WhatsAppIntegrationSource['sendTestMessage']>(),
  activate: vi.fn<WhatsAppIntegrationSource['activate']>(),
  deactivate: vi.fn<WhatsAppIntegrationSource['deactivate']>(),
  listBusinessAccounts: vi.fn<WhatsAppIntegrationSource['listBusinessAccounts']>(),
  listMessageTemplates: vi.fn<WhatsAppIntegrationSource['listMessageTemplates']>(),
}))
vi.mock('../api/selectSource', () => ({ getWhatsAppIntegrationSource: () => fakeSource }))

const role = vi.hoisted(() => ({ admin: true }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyAdmin: () => role.admin }))

const TITLES: Record<WhatsAppSetupStepStatus['step'], string> = {
  business_profile: 'Business profile',
  meta_account: 'Meta account connected',
  business_account: 'WhatsApp Business Account connected',
  phone_number: 'Phone number verified',
  webhook: 'Webhook connected',
  message_templates: 'Message templates ready',
  ai_agent: 'AI agent configured',
  knowledge_base: 'Knowledge base configured',
  test_message: 'Test message successful',
  ready_for_activation: 'Ready for activation',
}

function setupWith(states: Partial<Record<WhatsAppSetupStepStatus['step'], WhatsAppSetupStepStatus['state']>>, extra: Partial<WhatsAppSetup> = {}): WhatsAppSetup {
  const steps = (Object.keys(TITLES) as WhatsAppSetupStepStatus['step'][]).map((step) => ({
    step,
    required: step !== 'ai_agent' && step !== 'knowledge_base',
    state: states[step] ?? 'done',
    title: TITLES[step],
    guidance: `Guidance for ${step}`,
  }))
  const ready = steps.every((s) => !s.required || s.state === 'done')
  return {
    steps,
    completedSteps: steps.filter((s) => s.state === 'done').length,
    totalSteps: 10,
    readyForActivation: ready,
    activation: { active: false },
    ...extra,
  }
}

const NOT_TESTED = setupWith({ test_message: 'action_needed', ready_for_activation: 'blocked', ai_agent: 'action_needed' })

const ACCOUNTS: WhatsAppBusinessAccount[] = [
  {
    id: 'acc-1',
    businessAccountId: '102938475610',
    createdAt: '2026-11-01T08:00:00+02:00',
    numbers: [
      {
        id: 'num-1',
        businessAccountId: '102938475610',
        phoneNumberId: '564738291045',
        displayName: 'Nexus Leasing',
        displayNumber: '+27 11 555 0100',
        verifiedName: 'Nexus Leasing (Pty) Ltd',
        webhookConfigured: true,
        connectionStatus: 'connected',
        verificationSteps: [],
        createdAt: '2026-11-01T09:00:00+02:00',
      },
    ],
  },
]

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  role.admin = true
  fakeSource.getSetup.mockReset().mockResolvedValue(NOT_TESTED)
  fakeSource.sendTestMessage.mockReset()
  fakeSource.activate.mockReset()
  fakeSource.deactivate.mockReset()
  fakeSource.listBusinessAccounts.mockReset().mockResolvedValue(ACCOUNTS)
  fakeSource.listMessageTemplates.mockReset().mockResolvedValue([
    { id: 'tpl-ok', businessAccountId: '102938475610', metaTemplateId: '1', name: 'hello_world', language: 'en_US', category: 'UTILITY', status: 'APPROVED', syncedAt: '2026-11-01T09:00:00+02:00' },
    { id: 'tpl-pending', businessAccountId: '102938475610', metaTemplateId: '2', name: 'statement', language: 'en_ZA', category: 'UTILITY', status: 'PENDING', syncedAt: '2026-11-01T09:00:00+02:00' },
  ])
})

async function render(ui: React.ReactElement) {
  return renderWithRouter(<QueryClientProvider client={createTestQueryClient()}>{ui}</QueryClientProvider>, '/settings/integrations/whatsapp')
}

describe('WhatsAppSetupProgress', () => {
  it('shows the ten steps in order with their state, guidance and progress', async () => {
    await render(<WhatsAppSetupProgress isAdmin />)
    const region = await screen.findByRole('region', { name: 'WhatsApp setup' })
    const items = within(region).getAllByRole('listitem')
    expect(items).toHaveLength(10)
    Object.values(TITLES).forEach((title, index) => expect(items[index]).toHaveTextContent(`Step ${index + 1}: ${title}`))
    expect(within(items[8]!).getByText('Action needed')).toBeInTheDocument()
    expect(within(items[8]!).getByText('Guidance for test_message')).toBeInTheDocument()
    expect(within(items[6]!).getByText('Recommended')).toBeInTheDocument()
    expect(within(items[6]!).getByRole('link', { name: 'Configure the AI agent' })).toHaveAttribute('href', '/settings/integrations/whatsapp/agent')
    expect(within(items[9]!).getByText('Blocked')).toBeInTheDocument()
    expect(within(region).getByRole('progressbar', { name: '7 of 10 steps done' })).toBeInTheDocument()
  })

  it('never offers activation before every required step is verified', async () => {
    await render(<WhatsAppSetupProgress isAdmin />)
    expect(await screen.findByRole('button', { name: 'Activate WhatsApp' })).toBeDisabled()
    expect(screen.getByText('WhatsApp can be activated once every required step is verified.')).toBeInTheDocument()
  })

  it('activates once the API reports every required step verified', async () => {
    fakeSource.getSetup.mockResolvedValue(setupWith({}))
    fakeSource.activate.mockResolvedValue({ active: true, activatedAt: '2026-11-11T09:00:00+02:00' })
    await render(<WhatsAppSetupProgress isAdmin />)
    const activate = await screen.findByRole('button', { name: 'Activate WhatsApp' })
    expect(activate).toBeEnabled()
    fakeSource.getSetup.mockResolvedValue(setupWith({}, { activation: { active: true, activatedAt: '2026-11-11T09:00:00+02:00' } }))
    await userEvent.click(activate)
    expect(fakeSource.activate).toHaveBeenCalledWith(NEXUS_ID)
    expect(await screen.findByText(/WhatsApp is active since/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument()
  })

  it('sends a test message from a connected number with an approved template to the admin’s number in E.164', async () => {
    fakeSource.sendTestMessage.mockResolvedValue({
      id: 't-1',
      numberId: 'num-1',
      templateName: 'hello_world',
      templateLanguage: 'en_US',
      toNumber: '+27829990001',
      status: 'queued',
      mayHaveBeenSent: false,
      createdAt: '2026-11-11T09:00:00+02:00',
    })
    const user = userEvent.setup()
    await render(<WhatsAppSetupProgress isAdmin />)
    await user.click(await screen.findByRole('button', { name: 'Send test message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send a test message' })

    await user.click(within(dialog).getByRole('combobox', { name: /Send from/ }))
    await user.click(await screen.findByRole('option', { name: /\+27 11 555 0100/ }))
    await user.click(within(dialog).getByRole('combobox', { name: /Approved template/ }))
    expect(screen.queryByRole('option', { name: /statement/ })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: /hello_world/ }))
    await user.type(within(dialog).getByRole('textbox', { name: /Your WhatsApp number/ }), '082 999 0001')
    await user.click(within(dialog).getByRole('button', { name: 'Send test message' }))

    expect(fakeSource.sendTestMessage).toHaveBeenCalledWith(NEXUS_ID, { numberId: 'num-1', templateId: 'tpl-ok', to: '+27829990001' })
  })

  it('validates the recipient and shows the API’s refusal (e.g. a tenant’s number)', async () => {
    fakeSource.sendTestMessage.mockRejectedValue(new ApiError(422, ['This is a tenant’s WhatsApp number.'], 'req-1'))
    const user = userEvent.setup()
    await render(<WhatsAppSetupProgress isAdmin />)
    await user.click(await screen.findByRole('button', { name: 'Send test message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send a test message' })
    await user.type(within(dialog).getByRole('textbox', { name: /Your WhatsApp number/ }), '12345')
    await user.click(within(dialog).getByRole('button', { name: 'Send test message' }))
    expect(await within(dialog).findByText(/Enter a WhatsApp number/)).toBeInTheDocument()
    expect(fakeSource.sendTestMessage).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('combobox', { name: /Send from/ }))
    await user.click(await screen.findByRole('option', { name: /\+27 11 555 0100/ }))
    await user.click(within(dialog).getByRole('combobox', { name: /Approved template/ }))
    await user.click(await screen.findByRole('option', { name: /hello_world/ }))
    await user.clear(within(dialog).getByRole('textbox', { name: /Your WhatsApp number/ }))
    await user.type(within(dialog).getByRole('textbox', { name: /Your WhatsApp number/ }), '+27821110001')
    await user.click(within(dialog).getByRole('button', { name: 'Send test message' }))
    expect(await within(dialog).findByText('This is a tenant’s WhatsApp number.')).toBeInTheDocument()
  })

  it('shows the latest test message and why it failed', async () => {
    fakeSource.getSetup.mockResolvedValue({
      ...NOT_TESTED,
      latestTestMessage: {
        id: 't-1',
        numberId: 'num-1',
        templateName: 'hello_world',
        templateLanguage: 'en_US',
        toNumber: '+27829990001',
        status: 'failed',
        failureReason: '(#132000) Number of parameters does not match',
        mayHaveBeenSent: false,
        createdAt: '2026-11-11T09:00:00+02:00',
      },
    })
    await render(<WhatsAppSetupProgress isAdmin />)
    expect(await screen.findByText('Latest test message: Failed')).toBeInTheDocument()
    expect(screen.getByText('(#132000) Number of parameters does not match')).toBeInTheDocument()
  })

  it('is read-only for members who are not admins', async () => {
    role.admin = false
    await render(<WhatsAppSetupProgress isAdmin={false} />)
    await screen.findByRole('region', { name: 'WhatsApp setup' })
    expect(screen.queryByRole('button', { name: 'Send test message' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activate WhatsApp' })).not.toBeInTheDocument()
  })

  it('shows an API error with a retry', async () => {
    fakeSource.getSetup.mockRejectedValueOnce(new ApiError(503, ['The database is not available'], 'req-2'))
    await render(<WhatsAppSetupProgress isAdmin />)
    expect(await screen.findByText('The database is not available')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Business profile')).toBeInTheDocument()
  })
})

describe('WhatsAppSetupSummary (dashboard)', () => {
  it('shows company admins the progress and the next step, with a link to the setup', async () => {
    await render(<WhatsAppSetupSummary />)
    const region = await screen.findByRole('region', { name: 'WhatsApp setup' })
    expect(await within(region).findByText('Next: test message successful.')).toBeInTheDocument()
    expect(within(region).getByRole('link', { name: 'Open the WhatsApp setup' })).toHaveAttribute('href', '/settings/integrations/whatsapp')
  })

  it('says when WhatsApp is active', async () => {
    fakeSource.getSetup.mockResolvedValue(setupWith({}, { activation: { active: true } }))
    await render(<WhatsAppSetupSummary />)
    expect(await screen.findByText('WhatsApp is active.')).toBeInTheDocument()
  })

  it('is not shown, nor loaded, for members who are not admins', async () => {
    role.admin = false
    await render(<WhatsAppSetupSummary />)
    expect(screen.queryByRole('region', { name: 'WhatsApp setup' })).not.toBeInTheDocument()
    expect(fakeSource.getSetup).not.toHaveBeenCalled()
  })
})
