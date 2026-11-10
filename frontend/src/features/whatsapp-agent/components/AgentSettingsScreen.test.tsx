import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { KnowledgeFaq, WhatsAppAgentConfig } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { AgentSource } from '../api/source'
import { AgentSettingsScreen } from './AgentSettingsScreen'

const fakeSource = vi.hoisted(() => ({
  getConfig: vi.fn<AgentSource['getConfig']>(),
  saveConfig: vi.fn<AgentSource['saveConfig']>(),
  listFaqs: vi.fn<AgentSource['listFaqs']>(),
  listEntries: vi.fn<AgentSource['listEntries']>(),
  createText: vi.fn<AgentSource['createText']>(),
  updateText: vi.fn<AgentSource['updateText']>(),
  listDocuments: vi.fn<AgentSource['listDocuments']>(),
  uploadDocument: vi.fn<AgentSource['uploadDocument']>(),
  documentDownloadUrl: vi.fn<AgentSource['documentDownloadUrl']>(),
  review: vi.fn<AgentSource['review']>(),
  remove: vi.fn<AgentSource['remove']>(),
}))
vi.mock('../api/selectSource', () => ({ getAgentSource: () => fakeSource }))

const role = vi.hoisted(() => ({ admin: true }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyAdmin: () => role.admin }))

const MANAGER_ID = '5b0c1d2e-0000-4000-8000-0000000000a2'
vi.mock('@/features/users/api/queries', () => ({
  useMemberList: () => ({
    data: {
      items: [
        {
          id: '5b0c1d2e-0000-4000-8000-0000000000a2',
          fullName: 'Naledi van der Merwe',
          email: 'naledi@example.co.za',
          status: 'active',
          memberships: [{ companyId: '01JC0000000000000000000NEX', role: 'property_manager' }],
          createdAt: '2026-11-01T08:00:00+02:00',
          updatedAt: '2026-11-01T08:00:00+02:00',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    },
  }),
}))

const DEFAULTS: WhatsAppAgentConfig = {
  companyId: NEXUS_ID,
  configured: false,
  agentName: '',
  businessDescription: '',
  tone: '',
  timezone: 'Africa/Johannesburg',
  operatingHours: [],
  languages: ['en'],
  policies: '',
  supportInstructions: '',
  escalationRules: '',
  permittedActions: [],
  autoReplyEnabled: false,
  handoverContacts: [],
}

const FAQ: KnowledgeFaq = {
  id: 'f1',
  companyId: NEXUS_ID,
  question: 'Where do visitors park?',
  answer: 'Basement level P2.',
  status: 'draft',
  createdAt: '2026-11-10T08:00:00+02:00',
  updatedAt: '2026-11-10T08:00:00+02:00',
}

async function renderScreen() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <AgentSettingsScreen />
    </QueryClientProvider>,
    '/settings/integrations/whatsapp/agent',
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  role.admin = true
  for (const fn of Object.values(fakeSource)) fn.mockReset()
  fakeSource.getConfig.mockResolvedValue(DEFAULTS)
  fakeSource.listFaqs.mockResolvedValue([FAQ])
  fakeSource.listEntries.mockResolvedValue([])
  fakeSource.listDocuments.mockResolvedValue([])
})

describe('AgentSettingsScreen', () => {
  it('explains the safeguards: tenants are never answered automatically', async () => {
    await renderScreen()
    const safeguards = await screen.findByRole('region', { name: 'Safeguards that always apply' })
    expect(within(safeguards).getByText(/Tenants are never answered automatically/)).toBeInTheDocument()
    expect(within(safeguards).getByText(/only uses this company’s approved/)).toBeInTheDocument()
    expect(within(safeguards).getByText(/never shares banking details/)).toBeInTheDocument()
    expect(await screen.findByText(/Not set up yet/)).toBeInTheDocument()
  })

  it('shows loading and then an error with a retry', async () => {
    fakeSource.getConfig.mockRejectedValueOnce(new ApiError(500, ['boom'], null))
    await renderScreen()
    expect(await screen.findByText('The AI agent settings could not be loaded')).toBeInTheDocument()
    fakeSource.getConfig.mockResolvedValue(DEFAULTS)
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByRole('form', { name: 'AI agent settings' })).toBeInTheDocument()
  })

  it('lets a company admin save the settings', async () => {
    fakeSource.saveConfig.mockImplementation(async (_companyId, input) => ({ ...DEFAULTS, ...input, configured: true, handoverContacts: [] }))
    await renderScreen()
    const form = await screen.findByRole('form', { name: 'AI agent settings' })
    await userEvent.type(within(form).getByLabelText(/Agent name/), 'Nexus assistant')
    await userEvent.click(within(form).getByRole('button', { name: 'Add opening period' }))
    await userEvent.click(within(form).getByLabelText('Answer frequently asked questions'))
    await userEvent.click(within(form).getByRole('switch', { name: 'Reply to contacts automatically' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Save AI agent settings' }))

    await vi.waitFor(() => expect(fakeSource.saveConfig).toHaveBeenCalled())
    expect(fakeSource.saveConfig.mock.calls[0]).toEqual([
      NEXUS_ID,
      {
        agentName: 'Nexus assistant',
        businessDescription: '',
        tone: '',
        timezone: 'Africa/Johannesburg',
        operatingHours: [{ day: 'monday', opens: '08:00', closes: '17:00' }],
        languages: ['en'],
        policies: '',
        supportInstructions: '',
        escalationRules: '',
        permittedActions: ['answer_faq'],
        autoReplyEnabled: true,
        handoverContactUserIds: [],
      },
    ])
  })

  it('refuses a blank name and warns when auto-reply cannot answer anyone', async () => {
    await renderScreen()
    const form = await screen.findByRole('form', { name: 'AI agent settings' })
    await userEvent.click(within(form).getByRole('switch', { name: 'Reply to contacts automatically' }))
    expect(within(form).getByText(/no action lets the agent answer contacts/)).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: 'Save AI agent settings' }))
    expect((await within(form).findAllByText('Give the agent a name')).length).toBeGreaterThan(0)
    expect(fakeSource.saveConfig).not.toHaveBeenCalled()
  })

  it('shows the API refusal when a handover contact is not allowed', async () => {
    fakeSource.getConfig.mockResolvedValue({ ...DEFAULTS, configured: true, agentName: 'Nexus assistant', handoverContacts: [{ userId: MANAGER_ID, name: 'Naledi van der Merwe' }] })
    fakeSource.saveConfig.mockRejectedValue(new ApiError(422, ['Handover contacts must be active company admins or property managers of this company'], null))
    await renderScreen()
    const form = await screen.findByRole('form', { name: 'AI agent settings' })
    await userEvent.click(within(form).getByRole('button', { name: 'Save AI agent settings' }))
    expect(await within(form).findByText(/Handover contacts must be active company admins/)).toBeInTheDocument()
  })

  it('is read-only for members who are not company admins', async () => {
    role.admin = false
    await renderScreen()
    expect(await screen.findByText(/Only company admins can change or approve them/)).toBeInTheDocument()
    const form = await screen.findByRole('form', { name: 'AI agent settings' })
    expect(within(form).queryByRole('button', { name: 'Save AI agent settings' })).toBeNull()
    expect(within(form).getByLabelText(/Agent name/)).toBeDisabled()
    expect(await screen.findByText('Where do visitors park?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add FAQ' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
  })

  it('adds FAQs as drafts and approves them', async () => {
    fakeSource.createText.mockResolvedValue({ ...FAQ, id: 'f2' })
    fakeSource.review.mockResolvedValue(undefined)
    await renderScreen()
    const list = await screen.findByRole('list', { name: 'FAQs' })
    expect(within(list).getByText('Not available to the agent until approved')).toBeInTheDocument()

    await userEvent.click(within(list).getByRole('button', { name: 'Approve Where do visitors park?' }))
    await vi.waitFor(() => expect(fakeSource.review).toHaveBeenCalledWith(NEXUS_ID, 'faq', 'f1', 'approve'))

    await userEvent.click(screen.getByRole('button', { name: 'Add FAQ' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add FAQ' })
    await userEvent.type(within(dialog).getByLabelText(/Question/), 'Is there a loading bay?')
    await userEvent.type(within(dialog).getByLabelText(/Answer/), 'Yes, behind block B.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add as draft' }))
    await vi.waitFor(() =>
      expect(fakeSource.createText).toHaveBeenCalledWith(NEXUS_ID, 'faq', { title: 'Is there a loading bay?', body: 'Yes, behind block B.' }),
    )
  })

  it('uploads a document as a draft from an empty documents list', async () => {
    fakeSource.uploadDocument.mockResolvedValue({
      id: 'd1',
      companyId: NEXUS_ID,
      title: 'House rules',
      fileName: 'house-rules.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 8,
      status: 'draft',
      createdAt: '2026-11-10T08:00:00+02:00',
      updatedAt: '2026-11-10T08:00:00+02:00',
    })
    await renderScreen()
    await userEvent.click(await screen.findByRole('tab', { name: 'Documents' }))
    expect(await screen.findByText('No documents yet')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Upload document' }))
    const dialog = await screen.findByRole('dialog', { name: 'Upload a document' })
    const file = new File(['%PDF-1.7'], 'house-rules.pdf', { type: 'application/pdf' })
    await userEvent.upload(within(dialog).getByLabelText('File', { selector: 'input' }), file)
    expect(within(dialog).getByLabelText(/Title/)).toHaveValue('house-rules')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload as draft' }))
    await vi.waitFor(() => expect(fakeSource.uploadDocument).toHaveBeenCalledWith(NEXUS_ID, { file, mimeType: 'application/pdf', title: 'house-rules' }))
  })
})
