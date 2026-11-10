import { ApiError } from '@leaseguard/api-client'
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
  acceptHandover: vi.fn<ConversationSource['acceptHandover']>(),
  assignHandover: vi.fn<ConversationSource['assignHandover']>(),
  resolveHandover: vi.fn<ConversationSource['resolveHandover']>(),
  reply: vi.fn<ConversationSource['reply']>(),
}))
vi.mock('../api/selectSource', () => ({ getConversationSource: () => fakeSource }))

const ME = 'me-0000-4000-8000-000000000001'
const role = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({
  useIsCompanyWriter: () => role.writer,
  useIsCompanyAdmin: () => false,
  useCurrentUserId: () => 'me-0000-4000-8000-000000000001',
}))
vi.mock('@/features/users/api/queries', () => ({
  useMemberList: () => ({ data: { items: [], total: 0, page: 1, pageSize: 100 }, isPending: false, isError: false, error: null }),
}))

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()

const TENANT_CONVERSATION: WhatsAppConversationSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  companyId: NEXUS_ID,
  numberId: 'n-1',
  companyNumber: '+27 11 555 0100',
  contact: { id: 'c-1', profileName: 'Bongani', phoneNumber: '+27821110001', tenantId: 't-1', tenantName: 'Dlamini Cellular' },
  lastInboundAt: hoursAgo(2),
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

const CONTACT_THREAD: WhatsAppConversation = {
  ...TENANT_CONVERSATION,
  id: '33333333-3333-4333-8333-333333333333',
  contact: { id: 'c-3', profileName: 'Ayanda', phoneNumber: '+27829990001' },
  messages: [message({ recipientType: 'contact', body: 'Is there parking?' })],
}

const HANDOVER = {
  id: 'h-1',
  companyId: NEXUS_ID,
  conversationId: CONTACT_THREAD.id,
  status: 'open' as const,
  reason: 'The contact complained about parking',
  requestedBy: 'agent' as const,
  createdAt: '2026-11-10T08:00:00+02:00',
  updatedAt: '2026-11-10T08:00:00+02:00',
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  role.writer = true
  fakeSource.acceptHandover.mockReset().mockResolvedValue({ ...HANDOVER, status: 'accepted', assignedUserId: ME })
  fakeSource.resolveHandover.mockReset().mockResolvedValue({ ...HANDOVER, status: 'resolved' })
  fakeSource.assignHandover.mockReset()
  fakeSource.reply.mockReset().mockResolvedValue(message({ id: 'r-1', direction: 'outbound', recipientType: 'contact', status: 'approved', body: 'Yes' }))
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

  it('shows the open conversation with its messages in order, and no free-form reply to a tenant', async () => {
    await renderInbox({ page: 1, pageSize: 25, conversation: TENANT_CONVERSATION.id })
    const thread = await screen.findByRole('list', { name: 'Messages' })
    expect(within(thread).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Please resend my statement'),
      expect.stringContaining('Thank you'),
    ])
    expect(screen.getByRole('link', { name: 'Tenant: Dlamini Cellular' })).toHaveAttribute('href', '/tenants/t-1')
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled()
    expect(screen.getByText(/This contact is a tenant: tenants only receive approved statement and payment messages/)).toBeInTheDocument()
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

  it("replies to a contact inside the window, showing the time left", async () => {
    fakeSource.get.mockResolvedValue(CONTACT_THREAD)
    await renderInbox({ page: 1, pageSize: 25, conversation: CONTACT_THREAD.id })
    expect(await screen.findByText(/Reply window: 21 h \d+ min left/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Yes, in the basement.')
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(fakeSource.reply).toHaveBeenCalledWith(NEXUS_ID, CONTACT_THREAD.id, 'Yes, in the basement.')
  })

  it('shows the API\'s reasons when a reply is refused', async () => {
    fakeSource.get.mockResolvedValue(CONTACT_THREAD)
    fakeSource.reply.mockRejectedValue(new ApiError(422, ['Messages may not contain banking details'], null))
    await renderInbox({ page: 1, pageSize: 25, conversation: CONTACT_THREAD.id })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'EFT details')
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(await screen.findByText('Messages may not contain banking details.')).toBeInTheDocument()
  })

  it('disables the reply, with the reason, outside the 24-hour window', async () => {
    fakeSource.get.mockResolvedValue({ ...CONTACT_THREAD, lastInboundAt: hoursAgo(30) })
    await renderInbox({ page: 1, pageSize: 25, conversation: CONTACT_THREAD.id })
    expect(await screen.findByText('Reply window closed')).toBeInTheDocument()
    expect(screen.getByText(/24-hour customer service window has closed/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
  })

  it('lets a writer take the conversation over and resolve the handover', async () => {
    fakeSource.get.mockResolvedValue({ ...CONTACT_THREAD, handover: HANDOVER })
    await renderInbox({ page: 1, pageSize: 25, conversation: CONTACT_THREAD.id })
    expect(await screen.findByText('The AI agent asked for a person')).toBeInTheDocument()
    expect(screen.getByText('Reason: The contact complained about parking')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Take over' }))
    expect(fakeSource.acceptHandover).toHaveBeenCalledWith(NEXUS_ID, CONTACT_THREAD.id)

    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Resolve handover' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Note/ }), 'Called them back')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }))
    expect(fakeSource.resolveHandover).toHaveBeenCalledWith(NEXUS_ID, CONTACT_THREAD.id, 'Called them back')
  })

  it('shows a conversation a colleague took over without a take-over button', async () => {
    fakeSource.get.mockResolvedValue({ ...CONTACT_THREAD, handover: { ...HANDOVER, status: 'accepted', assignedUserId: 'someone', assignedUserName: 'Naledi' } })
    await renderInbox({ page: 1, pageSize: 25, conversation: CONTACT_THREAD.id })
    expect(await screen.findByText('Taken over by Naledi')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take over' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument()
  })

  it('shows read-only members the handover and the thread without actions', async () => {
    role.writer = false
    fakeSource.get.mockResolvedValue({ ...CONTACT_THREAD, handover: HANDOVER })
    await renderInbox({ page: 1, pageSize: 25, conversation: CONTACT_THREAD.id })
    expect(await screen.findByText('The AI agent asked for a person')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take over' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()
    expect(screen.getByText('Only company admins and property managers can reply.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
  })

  it('filters the inbox to handed-over conversations or those assigned to me', async () => {
    const { onParamsChange } = await renderInbox({ page: 3, pageSize: 25 })
    await userEvent.click(await screen.findByRole('button', { name: 'Handed over' }))
    expect(onParamsChange).toHaveBeenCalledWith({ page: 1, pageSize: 25, filter: 'handed_over' })
    expect(fakeSource.list).toHaveBeenCalledWith(NEXUS_ID, { page: 3, pageSize: 25 })
  })

  it('lists with the chosen filter and shows the handover on the list item', async () => {
    fakeSource.list.mockResolvedValue({ items: [{ ...CONTACT_THREAD, handover: { ...HANDOVER, status: 'accepted', assignedUserId: ME } }], total: 1, page: 1, pageSize: 25 })
    await renderInbox({ page: 1, pageSize: 25, filter: 'mine' })
    expect(await screen.findByText('Taken over by you')).toBeInTheDocument()
    expect(fakeSource.list).toHaveBeenCalledWith(NEXUS_ID, { page: 1, pageSize: 25, filter: 'mine' })
    expect(screen.getByRole('button', { name: 'Assigned to me' })).toHaveAttribute('aria-pressed', 'true')
  })
})
