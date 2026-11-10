import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Communication, MessageApproval } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { CommunicationSource, PendingApproval } from '../api/source'
import { ApprovalsQueue } from './ApprovalsQueue'

const fakeSource = vi.hoisted(() => ({
  list: vi.fn<CommunicationSource['list']>(),
  get: vi.fn<CommunicationSource['get']>(),
  listPendingApprovals: vi.fn<CommunicationSource['listPendingApprovals']>(),
  approve: vi.fn<CommunicationSource['approve']>(),
  reject: vi.fn<CommunicationSource['reject']>(),
}))
vi.mock('../api/selectSource', () => ({ getCommunicationSource: () => fakeSource }))

const role = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({
  useIsCompanyWriter: () => role.writer,
  useIsCompanyAdmin: () => false,
  useCurrentUserId: () => 'me-0000-4000-8000-000000000001',
}))
vi.mock('@/features/tenants/api/queries', () => ({
  useTenantQuery: (id: string) => ({
    data: id === TENANT_ID ? { id, tradingName: 'Dlamini Cellular', legalName: 'Dlamini Cellular (Pty) Ltd' } : null,
    isPending: false,
    isError: false,
  }),
}))

const TENANT_ID = '44444444-4444-4444-8444-444444444444'
const COMMUNICATION_ID = '11111111-1111-4111-8111-111111111111'

const communication: Communication = {
  id: COMMUNICATION_ID,
  companyId: NEXUS_ID,
  channel: 'whatsapp',
  direction: 'outbound',
  messageType: 'monthly_statement',
  recipientType: 'tenant',
  tenantId: TENANT_ID,
  counterpartyNumber: '+27821110001',
  companyNumber: '+27 11 555 0100',
  body: 'Good day. Your October 2026 statement is attached.',
  status: 'pending_approval',
  createdAt: '2026-11-10T08:00:00+02:00',
  updatedAt: '2026-11-10T08:00:00+02:00',
}
const approval: MessageApproval = {
  id: 'a-1',
  companyId: NEXUS_ID,
  communicationId: COMMUNICATION_ID,
  requestedByUserId: 'u-2',
  requestedAt: '2026-11-10T08:00:00+02:00',
  decision: 'pending',
  createdAt: '2026-11-10T08:00:00+02:00',
  updatedAt: '2026-11-10T08:00:00+02:00',
}
const PENDING: PendingApproval = { approval, communication }

function apiError(status: number, messages: string[]): ApiError {
  return new ApiError(status, messages, null)
}

async function renderQueue(page = 1) {
  const onPageChange = vi.fn()
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <ApprovalsQueue page={page} pageSize={25} onPageChange={onPageChange} />
    </QueryClientProvider>,
    '/communications/approvals',
  )
  return { onPageChange }
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  role.writer = true
  fakeSource.listPendingApprovals.mockReset().mockResolvedValue({ items: [PENDING], total: 1, page: 1, pageSize: 25 })
  fakeSource.approve.mockReset().mockResolvedValue({ approval: { ...approval, decision: 'approved' }, communication: { ...communication, status: 'approved' } })
  fakeSource.reject.mockReset().mockResolvedValue({ approval: { ...approval, decision: 'rejected', reason: 'x' }, communication: { ...communication, status: 'rejected' } })
})

describe('ApprovalsQueue', () => {
  it('shows a loading state while the queue loads', async () => {
    fakeSource.listPendingApprovals.mockReturnValue(new Promise(() => {}))
    await renderQueue()
    expect(await screen.findByText('Loading messages awaiting approval…')).toBeInTheDocument()
  })

  it('says so when nothing is waiting', async () => {
    fakeSource.listPendingApprovals.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await renderQueue()
    expect(await screen.findByText('Nothing awaiting approval')).toBeInTheDocument()
  })

  it('moves to the last page when the requested page is past the end, instead of saying nothing is waiting', async () => {
    // e.g. the only message on page 2 was just decided; page 1 still has messages waiting.
    fakeSource.listPendingApprovals.mockImplementation((_companyId, params) =>
      Promise.resolve(params.page === 1 ? { items: [PENDING], total: 1, page: 1, pageSize: 25 } : { items: [], total: 1, page: params.page, pageSize: 25 }),
    )
    const { onPageChange } = await renderQueue(2)
    await vi.waitFor(() => expect(onPageChange).toHaveBeenCalledWith(1))
    expect(screen.queryByText('Nothing awaiting approval')).not.toBeInTheDocument()
    expect(screen.getByText('Loading messages awaiting approval…')).toBeInTheDocument()
  })

  it('shows an error with a retry when the queue cannot load', async () => {
    fakeSource.listPendingApprovals.mockRejectedValueOnce(apiError(500, ['boom']))
    await renderQueue()
    expect(await screen.findByText('Could not load messages awaiting approval')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText('Good day. Your October 2026 statement is attached.')).toBeInTheDocument()
  })

  it('lists each pending tenant message with its recipient, type, number and text', async () => {
    await renderQueue()
    const item = await screen.findByRole('article', { name: /Monthly statement/ })
    expect(within(item).getByText('Dlamini Cellular')).toBeInTheDocument()
    expect(within(item).getByText(/\+27821110001/)).toBeInTheDocument()
    expect(within(item).getByText('Good day. Your October 2026 statement is attached.')).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('lets read-only members see the queue but not act on it', async () => {
    role.writer = false
    await renderQueue()
    const item = await screen.findByRole('article', { name: /Monthly statement/ })
    expect(within(item).queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(within(item).queryByRole('button', { name: 'Reject' })).toBeNull()
    expect(screen.getByText(/Only company admins and property managers can approve or reject/)).toBeInTheDocument()
  })

  it('approves with an optional note and the message leaves the queue', async () => {
    await renderQueue()
    const item = await screen.findByRole('article', { name: /Monthly statement/ })
    await userEvent.click(within(item).getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve message' })
    await userEvent.type(within(dialog).getByLabelText(/Note/), 'Checked against the statement')
    fakeSource.listPendingApprovals.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and send' }))
    expect(fakeSource.approve).toHaveBeenCalledWith(NEXUS_ID, COMMUNICATION_ID, 'Checked against the statement')
    expect(await screen.findByText('Nothing awaiting approval')).toBeInTheDocument()
  })

  it('shows every deliverability blocker when the message cannot be sent, and keeps it pending', async () => {
    fakeSource.approve.mockRejectedValue(
      apiError(422, ['The company WhatsApp account is not connected', 'WhatsApp template "monthly_statement" is not approved by Meta']),
    )
    await renderQueue()
    const item = await screen.findByRole('article', { name: /Monthly statement/ })
    await userEvent.click(within(item).getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve message' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and send' }))
    expect(fakeSource.approve).toHaveBeenCalledWith(NEXUS_ID, COMMUNICATION_ID, undefined)

    const blockers = await within(item).findByRole('alert')
    expect(blockers).toHaveTextContent('This message cannot be sent yet')
    const reasons = within(blockers).getAllByRole('listitem').map((reason) => reason.textContent)
    expect(reasons).toEqual(['The company WhatsApp account is not connected', 'WhatsApp template "monthly_statement" is not approved by Meta'])
    expect(screen.queryByRole('dialog')).toBeNull()
    // Still awaiting a decision: it can be approved again once fixed, or rejected.
    expect(within(item).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('explains a conflict inside the dialog', async () => {
    fakeSource.approve.mockRejectedValue(apiError(409, ['This approval request was decided by someone else; reload the message']))
    await renderQueue()
    const item = await screen.findByRole('article', { name: /Monthly statement/ })
    await userEvent.click(within(item).getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve message' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and send' }))
    expect(await within(dialog).findByText('This approval request was decided by someone else; reload the message.')).toBeInTheDocument()
  })

  it('requires a reason to reject, and records it', async () => {
    await renderQueue()
    const item = await screen.findByRole('article', { name: /Monthly statement/ })
    await userEvent.click(within(item).getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject message' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject message' }))
    expect(await within(dialog).findByText('Give a reason for rejecting the message')).toBeInTheDocument()
    expect(fakeSource.reject).not.toHaveBeenCalled()

    await userEvent.type(within(dialog).getByLabelText(/Reason/), '  Wrong statement month  ')
    fakeSource.listPendingApprovals.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject message' }))
    expect(fakeSource.reject).toHaveBeenCalledWith(NEXUS_ID, COMMUNICATION_ID, 'Wrong statement month')
    expect(await screen.findByText('Nothing awaiting approval')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
