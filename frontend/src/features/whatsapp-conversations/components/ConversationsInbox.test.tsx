import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Communication } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { ConversationSource, WhatsAppConversation, WhatsAppConversationSummary } from '../api/source'
import { ConversationsInbox, type InboxParams } from './ConversationsInbox'

const fakeSource = vi.hoisted(() => ({
  list: vi.fn<ConversationSource['list']>(),
  get: vi.fn<ConversationSource['get']>(),
}))
vi.mock('../api/selectSource', () => ({ getConversationSource: () => fakeSource }))

const TENANT_CONVERSATION: WhatsAppConversationSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  companyId: NEXUS_ID,
  numberId: 'n-1',
  companyNumber: '+27 11 555 0100',
  contact: { id: 'c-1', profileName: 'Bongani', phoneNumber: '+27821110001', tenantId: 't-1', tenantName: 'Dlamini Cellular' },
  lastInboundAt: '2026-11-10T08:00:00+02:00',
  lastMessageAt: '2026-11-10T08:00:00+02:00',
  lastMessagePreview: 'Please resend my statement',
  createdAt: '2026-11-10T08:00:00+02:00',
  updatedAt: '2026-11-10T08:00:00+02:00',
}
const NUMBERLESS_CONVERSATION: WhatsAppConversationSummary = {
  ...TENANT_CONVERSATION,
  id: '22222222-2222-4222-8222-222222222222',
  contact: { id: 'c-2' },
  lastMessagePreview: 'Hello',
}

const message = (overrides: Partial<Communication>): Communication => ({
  id: 'm-1',
  companyId: NEXUS_ID,
  channel: 'whatsapp',
  direction: 'inbound',
  messageType: 'inbound_reply',
  recipientType: 'tenant',
  companyNumber: '+27 11 555 0100',
  body: 'Please resend my statement',
  status: 'received',
  receivedAt: '2026-11-10T08:00:00+02:00',
  createdAt: '2026-11-10T08:00:01+02:00',
  updatedAt: '2026-11-10T08:00:01+02:00',
  ...overrides,
})

const THREAD: WhatsAppConversation = {
  ...TENANT_CONVERSATION,
  messages: [message({}), message({ id: 'm-2', body: 'Thank you' })],
}

async function renderInbox(params: InboxParams = { page: 1, pageSize: 25 }) {
  const onParamsChange = vi.fn()
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <ConversationsInbox params={params} onParamsChange={onParamsChange} />
    </QueryClientProvider>,
    '/whatsapp/conversations',
  )
  return { onParamsChange }
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.list.mockReset().mockResolvedValue({ items: [TENANT_CONVERSATION, NUMBERLESS_CONVERSATION], total: 2, page: 1, pageSize: 25 })
  fakeSource.get.mockReset().mockResolvedValue(THREAD)
})

describe('ConversationsInbox', () => {
  it('shows a loading state while the inbox loads', async () => {
    fakeSource.list.mockReturnValue(new Promise(() => undefined))
    await renderInbox()
    expect(screen.getByRole('heading', { level: 1, name: 'Conversations' })).toBeInTheDocument()
    expect((await screen.findAllByRole('status')).length).toBeGreaterThan(0)
  })

  it('explains an empty inbox', async () => {
    fakeSource.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderInbox()
    expect(await screen.findByText('No conversations yet')).toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    fakeSource.list.mockRejectedValue(new Error('Network down'))
    await renderInbox()
    expect(await screen.findByText('Could not load conversations')).toBeInTheDocument()
  })

  it('lists conversations, naming tenants and contacts whose number WhatsApp did not share', async () => {
    const { onParamsChange } = await renderInbox()
    const list = await screen.findByRole('list', { name: 'Conversations' })
    const items = within(list).getAllByRole('button')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText('Bongani')).toBeInTheDocument()
    expect(within(items[0]!).getByText('Tenant · Dlamini Cellular')).toBeInTheDocument()
    expect(within(items[0]!).getByText('Please resend my statement')).toBeInTheDocument()
    expect(within(items[1]!).getByText('WhatsApp user')).toBeInTheDocument()
    expect(screen.getByText('Select a conversation')).toBeInTheDocument()

    await userEvent.click(items[1]!)
    expect(onParamsChange).toHaveBeenCalledWith({ page: 1, pageSize: 25, conversation: NUMBERLESS_CONVERSATION.id })
  })

  it('shows the open conversation read-only, with its messages in order', async () => {
    await renderInbox({ page: 1, pageSize: 25, conversation: TENANT_CONVERSATION.id })
    const thread = await screen.findByRole('list', { name: 'Messages' })
    expect(within(thread).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Please resend my statement'),
      expect.stringContaining('Thank you'),
    ])
    expect(screen.getByRole('link', { name: 'Tenant: Dlamini Cellular' })).toHaveAttribute('href', '/tenants/t-1')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(fakeSource.get).toHaveBeenCalledWith(NEXUS_ID, TENANT_CONVERSATION.id)
  })

  it("says when WhatsApp did not share the contact's number", async () => {
    fakeSource.get.mockResolvedValue({ ...NUMBERLESS_CONVERSATION, messages: [message({ recipientType: 'contact', body: 'Hello' })] })
    await renderInbox({ page: 1, pageSize: 25, conversation: NUMBERLESS_CONVERSATION.id })
    expect(await screen.findByText(/WhatsApp did not share this person’s number/)).toBeInTheDocument()
  })

  it('explains a conversation that is not in this workspace', async () => {
    fakeSource.get.mockResolvedValue(null)
    const { onParamsChange } = await renderInbox({ page: 1, pageSize: 25, conversation: TENANT_CONVERSATION.id })
    expect(await screen.findByText('Conversation not found')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to the inbox' }))
    expect(onParamsChange).toHaveBeenCalledWith({ page: 1, pageSize: 25 })
  })
})
