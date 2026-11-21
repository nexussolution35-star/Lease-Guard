import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import type { Communication, MessageApproval } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { CommunicationSource } from '../api/source'
import { ApprovalsWaitingSummary } from './ApprovalsWaitingSummary'

const fakeSource = vi.hoisted(() => ({ listPendingApprovals: vi.fn<CommunicationSource['listPendingApprovals']>() }))
vi.mock('../api/selectSource', () => ({ getCommunicationSource: () => fakeSource }))

const approval = { id: 'a-1', requestedAt: '2026-11-10T08:00:00+02:00' } as MessageApproval
const communication = { id: 'c-1' } as Communication

async function renderSummary(showAction = false) {
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <ApprovalsWaitingSummary showAction={showAction} />
    </QueryClientProvider>,
    '/',
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.listPendingApprovals.mockReset().mockResolvedValue({ items: [{ approval, communication }], total: 3, page: 1, pageSize: 1 })
})

describe('ApprovalsWaitingSummary', () => {
  it('shows how many messages wait on a sign-off and since when, asking only for the oldest', async () => {
    await renderSummary(true)
    const region = await screen.findByRole('region', { name: 'Messages awaiting approval' })
    expect(await within(region).findByText('3 messages awaiting approval')).toBeInTheDocument()
    expect(within(region).getByText('10 Nov 2026')).toBeInTheDocument()
    expect(within(region).getByRole('link', { name: 'Review messages' })).toHaveAttribute('href', '/communications/approvals')
    expect(fakeSource.listPendingApprovals).toHaveBeenCalledWith(NEXUS_ID, { page: 1, pageSize: 1 })
  })

  it('says when nothing is waiting, with a link to the queue', async () => {
    fakeSource.listPendingApprovals.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 1 })
    await renderSummary(true)
    const region = await screen.findByRole('region', { name: 'Messages awaiting approval' })
    expect(await within(region).findByText('Nothing awaiting approval')).toBeInTheDocument()
    expect(within(region).queryByRole('link', { name: 'Review messages' })).toBeNull()
    expect(within(region).getByRole('link', { name: 'Open message approvals' })).toHaveAttribute('href', '/communications/approvals')
  })

  it('shows nothing without a workspace', async () => {
    resetWorkspace()
    await renderSummary()
    expect(screen.queryByRole('region', { name: 'Messages awaiting approval' })).not.toBeInTheDocument()
  })
})
