import { ApiError } from '@leaseguard/api-client'
import {
  TEMPLATED_MESSAGE_TYPES,
  messageTypeAudience,
  type MessageTemplateSettings,
  type MessageTypeTemplate,
  type WhatsAppMessageTemplate,
} from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { MessageTemplateSource } from '../api/source'
import { MessageTemplatesSettingsScreen } from './MessageTemplatesSettingsScreen'

const fakeSource = vi.hoisted(() => ({
  getSettings: vi.fn<MessageTemplateSource['getSettings']>(),
  choose: vi.fn<MessageTemplateSource['choose']>(),
  sync: vi.fn<MessageTemplateSource['sync']>(),
}))
vi.mock('../api/selectSource', () => ({ getMessageTemplateSource: () => fakeSource }))

const whatsApp = vi.hoisted(() => ({ listMessageTemplates: vi.fn<() => Promise<WhatsAppMessageTemplate[]>>() }))
vi.mock('@/features/whatsapp-integration/api/selectSource', () => ({ getWhatsAppIntegrationSource: () => whatsApp }))

const role = vi.hoisted(() => ({ admin: true }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyAdmin: () => role.admin }))

const BODY = 'Good day {{1}}. Your {{2}} statement is attached.'
const STATEMENT: MessageTypeTemplate = {
  messageType: 'monthly_statement',
  audience: 'tenant',
  sendable: true,
  mapping: {
    templateId: 't1',
    whatsappTemplateId: 'w1',
    metaTemplateName: 'monthly_statement',
    language: 'en_ZA',
    category: 'utility',
    body: BODY,
    variables: ['Tenant name', 'Statement period'],
    approvalStatus: 'approved',
    metaStatus: 'APPROVED',
    supportsDocumentAttachment: true,
    metaBodyChanged: false,
    mappedAt: '2026-11-21T10:00:00+02:00',
    mappedByUserId: 'u1',
    mappedByName: 'Thandi Mokoena',
  },
}
const REJECTED: MessageTypeTemplate = {
  messageType: 'overdue_payment_reminder',
  audience: 'tenant',
  sendable: false,
  mapping: {
    ...STATEMENT.mapping!,
    templateId: 't2',
    whatsappTemplateId: 'w2',
    metaTemplateName: 'overdue_reminder',
    body: 'Good day {{1}}. Your account is overdue.',
    variables: ['Tenant name'],
    approvalStatus: 'rejected',
    metaStatus: 'REJECTED',
    rejectedReason: 'INVALID_FORMAT',
    supportsDocumentAttachment: false,
  },
}

function settingsWith(overrides: MessageTypeTemplate[], whatsappConnected = true): MessageTemplateSettings {
  return {
    whatsappConnected,
    types: TEMPLATED_MESSAGE_TYPES.map(
      (messageType) => overrides.find((t) => t.messageType === messageType) ?? { messageType, audience: messageTypeAudience(messageType), sendable: false },
    ),
  }
}

const synced = (extra: Partial<WhatsAppMessageTemplate>): WhatsAppMessageTemplate => ({
  id: 'w9',
  businessAccountId: '771001',
  metaTemplateId: '9009',
  name: 'initial_reminder',
  language: 'en_ZA',
  category: 'UTILITY',
  status: 'APPROVED',
  syncedAt: '2026-11-21T08:00:00+02:00',
  body: 'Good day {{1}}. {{2}} is due on {{3}}.',
  ...extra,
})

function renderScreen() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <MessageTemplatesSettingsScreen />
    </QueryClientProvider>,
    '/settings/templates',
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  role.admin = true
  fakeSource.getSettings.mockReset().mockResolvedValue(settingsWith([STATEMENT, REJECTED]))
  fakeSource.choose.mockReset()
  fakeSource.sync.mockReset()
  whatsApp.listMessageTemplates.mockReset().mockResolvedValue([])
})

describe('MessageTemplatesSettingsScreen', () => {
  it('lists every message type by audience with its template, status, attachment support and who chose it', async () => {
    await renderScreen()
    const tenant = await screen.findByRole('region', { name: 'Tenant messages' })
    expect(within(tenant).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Monthly statement',
      'Initial payment reminder',
      'Overdue payment reminder',
      'Follow-up payment reminder',
      'Instalment reminder',
    ])
    const owner = screen.getByRole('region', { name: 'Owner messages' })
    expect(within(owner).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Owner weekly summary', 'Owner query response'])

    const statement = within(tenant).getByRole('heading', { name: 'Monthly statement' }).closest('li')!
    expect(within(statement).getByText('Ready to send')).toBeInTheDocument()
    expect(within(statement).getByText('monthly_statement')).toBeInTheDocument()
    expect(within(statement).getByText('en_ZA')).toBeInTheDocument()
    expect(within(statement).getByText('Approved')).toBeInTheDocument()
    expect(within(statement).getByText('Attached as a document')).toBeInTheDocument()
    expect(within(statement).getByText('Thandi Mokoena')).toBeInTheDocument()
    expect(within(statement).getByText('21 Nov 2026')).toBeInTheDocument()
  })

  it('previews the body with en-ZA sample values', async () => {
    await renderScreen()
    const statement = (await screen.findByRole('heading', { name: 'Monthly statement' })).closest('li')!
    await userEvent.click(within(statement).getByText('Preview with sample values'))
    expect(within(statement).getByText('Good day Sample Trading (Pty) Ltd. Your November 2026 statement is attached.')).toBeVisible()
    expect(within(statement).getByText(/Sample values, not real records/)).toBeVisible()
  })

  it("explains a rejected template with Meta's reason and what to do next, and a type without a template", async () => {
    await renderScreen()
    const overdue = (await screen.findByRole('heading', { name: 'Overdue payment reminder' })).closest('li')!
    expect(within(overdue).getByText('Not approved by Meta')).toBeInTheDocument()
    expect(within(overdue).getByText('Rejected by Meta: Invalid format. Messages of this type cannot be sent.')).toBeInTheDocument()
    expect(within(overdue).getByText(/Fix it in WhatsApp Manager/)).toBeInTheDocument()

    const initial = screen.getByRole('heading', { name: 'Initial payment reminder' }).closest('li')!
    expect(within(initial).getByText('No template')).toBeInTheDocument()
    expect(within(initial).getByText('No template chosen. Messages of this type cannot be sent.')).toBeInTheDocument()
  })

  it('is read-only for members who are not company admins', async () => {
    role.admin = false
    await renderScreen()
    expect(await screen.findByText(/Only company admins choose templates/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /template for/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync templates' })).not.toBeInTheDocument()
  })

  it('shows an empty state with a link to set up WhatsApp when it is not connected', async () => {
    fakeSource.getSettings.mockResolvedValue(settingsWith([], false))
    await renderScreen()
    expect(await screen.findByText('WhatsApp is not connected')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up WhatsApp' })).toHaveAttribute('href', '/settings/integrations/whatsapp')
    expect(screen.queryByRole('region', { name: 'Tenant messages' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync templates' })).not.toBeInTheDocument()
  })

  it('lets an admin sync the templates from Meta again', async () => {
    fakeSource.sync.mockResolvedValue({ queued: 1, message: 'LeaseGuard is syncing the templates from Meta.' })
    await renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Sync templates' }))
    expect(fakeSource.sync).toHaveBeenCalledWith(NEXUS_ID)
  })
})

describe('ChooseTemplateDialog', () => {
  it('maps an approved template, previews it, and disables templates that cannot serve a tenant type with every reason', async () => {
    whatsApp.listMessageTemplates.mockResolvedValue([
      synced({}),
      synced({ id: 'w10', name: 'promo', category: 'MARKETING', body: 'Hello {{1}}.' }),
      synced({ id: 'w11', name: 'renewal_notice', body: 'Your lease renewal is due on {{1}}.' }),
      synced({ id: 'w1', name: 'monthly_statement', body: BODY, headerFormat: 'DOCUMENT' }),
    ])
    fakeSource.choose.mockResolvedValue({ ...STATEMENT, messageType: 'initial_payment_reminder' })
    await renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Choose the template for initial payment reminder' }))

    const dialog = await screen.findByRole('dialog', { name: 'Template for initial payment reminder' })
    const options = await within(dialog).findAllByRole('radio')
    expect(options).toHaveLength(4)
    expect(within(dialog).getByRole('radio', { name: /promo/ })).toBeDisabled()
    expect(within(dialog).getByText(/needs a Utility template/)).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: /renewal_notice/ })).toBeDisabled()
    expect(within(dialog).getByText('Tenant messages may not mention: renewal option')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: /^monthly_statement/ })).toBeDisabled()
    expect(within(dialog).getByText('Already sends Monthly statement messages. A template sends one message type.')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('radio', { name: /initial_reminder/ }))
    expect(within(dialog).getByText('Good day Sample Trading (Pty) Ltd. R 12 450,00 is due on 07 Dec 2026.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use this template' }))
    expect(fakeSource.choose).toHaveBeenCalledWith(NEXUS_ID, 'initial_payment_reminder', 'w9')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("shows the API's refusal and stays open", async () => {
    whatsApp.listMessageTemplates.mockResolvedValue([synced({})])
    fakeSource.choose.mockRejectedValue(new ApiError(422, ['Meta has not approved "initial_reminder" (Paused).'], null))
    await renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Choose the template for initial payment reminder' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(await within(dialog).findByRole('radio', { name: /initial_reminder/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use this template' }))
    expect(await within(dialog).findByText('Meta has not approved "initial_reminder" (Paused).')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
