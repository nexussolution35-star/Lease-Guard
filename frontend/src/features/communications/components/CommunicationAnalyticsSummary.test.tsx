import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import type { CommunicationAnalytics } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { CommunicationSource } from '../api/source'
import { CommunicationAnalyticsSummary } from './CommunicationAnalyticsSummary'

const fakeSource = vi.hoisted(() => ({ analytics: vi.fn<CommunicationSource['analytics']>() }))
vi.mock('../api/selectSource', () => ({ getCommunicationSource: () => fakeSource }))

const FIGURES: CommunicationAnalytics = {
  from: '2026-10-13',
  to: '2026-11-11',
  inbound: 1250,
  outbound: 40,
  delivered: 30,
  read: 10,
  failed: 2,
  handovers: 6,
  agentHandovers: 5,
  agentReplies: 9,
  outOfHoursMessages: 1,
  suggestedReplies: 5,
}

async function renderSummary() {
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <CommunicationAnalyticsSummary />
    </QueryClientProvider>,
    '/',
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.analytics.mockReset().mockResolvedValue(FIGURES)
})

describe('CommunicationAnalyticsSummary', () => {
  it("summarises the last 30 days of the workspace's WhatsApp activity and links to the full figures", async () => {
    await renderSummary()
    const region = await screen.findByRole('region', { name: 'WhatsApp activity' })
    expect(await within(region).findByText('13 Oct 2026 to 11 Nov 2026')).toBeInTheDocument()
    expect(fakeSource.analytics).toHaveBeenCalledWith(NEXUS_ID, {})
    const terms = within(region).getAllByRole('term').map((term) => term.textContent)
    const values = within(region).getAllByRole('definition').map((value) => value.textContent)
    expect(Object.fromEntries(terms.map((term, i) => [term, values[i]]))).toEqual({
      Received: '1 250',
      Sent: '40',
      Delivered: '30 (75%)',
      Handovers: '6',
    })
    expect(within(region).getByRole('link', { name: 'Open communication analytics' })).toHaveAttribute('href', '/communications/analytics')
  })

  it('shows nothing without a workspace', async () => {
    resetWorkspace()
    await renderSummary()
    expect(screen.queryByRole('region', { name: 'WhatsApp activity' })).not.toBeInTheDocument()
  })
})
