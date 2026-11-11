import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { daysBetween, type CommunicationAnalytics } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { CommunicationSource } from '../api/source'
import { CommunicationAnalyticsScreen } from './CommunicationAnalyticsScreen'

const fakeSource = vi.hoisted(() => ({
  analytics: vi.fn<CommunicationSource['analytics']>(),
}))
vi.mock('../api/selectSource', () => ({ getCommunicationSource: () => fakeSource }))

const OCTOBER: CommunicationAnalytics = {
  from: '2026-10-01',
  to: '2026-10-31',
  inbound: 42,
  outbound: 30,
  delivered: 20,
  read: 12,
  failed: 3,
  handovers: 5,
  agentHandovers: 4,
  agentReplies: 18,
  outOfHoursMessages: 2,
  suggestedReplies: 4,
}
const QUIET: CommunicationAnalytics = {
  ...OCTOBER,
  from: '2026-10-13',
  to: '2026-11-11',
  inbound: 0,
  outbound: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  handovers: 0,
  agentHandovers: 0,
  agentReplies: 0,
  outOfHoursMessages: 0,
  suggestedReplies: 0,
}

async function renderScreen(range: { from?: string; to?: string } = {}) {
  const onRangeChange = vi.fn()
  await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <CommunicationAnalyticsScreen from={range.from} to={range.to} onRangeChange={onRangeChange} />
    </QueryClientProvider>,
    '/communications/analytics',
  )
  return { onRangeChange }
}

/** The value shown on the metric card labelled `label` inside the section named `section`. */
function figure(section: string, label: string): HTMLElement {
  const region = screen.getByRole('region', { name: section })
  const card = within(region).getByText(label, { selector: 'p' }).closest('div.flex-col')
  if (!(card instanceof HTMLElement)) throw new Error(`No card ${label}`)
  return card
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.analytics.mockReset().mockResolvedValue(OCTOBER)
})

describe('CommunicationAnalyticsScreen', () => {
  it("shows the active company's figures for the chosen range, grouped and with shares of what was sent", async () => {
    await renderScreen({ from: '2026-10-01', to: '2026-10-31' })

    expect(await screen.findByText('01 Oct 2026 to 31 Oct 2026')).toBeInTheDocument()
    expect(fakeSource.analytics).toHaveBeenCalledWith(NEXUS_ID, { from: '2026-10-01', to: '2026-10-31' })

    expect(figure('Messages', 'Received')).toHaveTextContent('42')
    expect(figure('Messages', 'Sent')).toHaveTextContent('30')
    expect(figure('Messages', 'Delivered')).toHaveTextContent('20')
    expect(figure('Messages', 'Delivered')).toHaveTextContent('67% of sent')
    expect(figure('Messages', 'Read')).toHaveTextContent('40% of sent')
    expect(figure('Messages', 'Failed')).toHaveTextContent('10% of sent')
    expect(figure('Handovers', 'Handovers opened')).toHaveTextContent('5')
    expect(figure('Handovers', 'Handovers opened')).toHaveTextContent('4 by the AI agent')
    expect(figure('AI agent', 'Answers sent')).toHaveTextContent('18')
    expect(figure('AI agent', 'Out-of-hours messages')).toHaveTextContent('2')
    expect(figure('AI agent', 'Suggested replies')).toHaveTextContent('4')
    expect(screen.queryByText('No WhatsApp activity in this period.')).not.toBeInTheDocument()
  })

  it('without dates asks for the default and names the range the API used; says when nothing happened', async () => {
    fakeSource.analytics.mockResolvedValue(QUIET)
    await renderScreen()
    expect(await screen.findByText('13 Oct 2026 to 11 Nov 2026')).toBeInTheDocument()
    expect(fakeSource.analytics).toHaveBeenCalledWith(NEXUS_ID, {})
    expect(screen.getByText('No WhatsApp activity in this period.')).toBeInTheDocument()
    // No share of nothing.
    expect(figure('Messages', 'Delivered')).not.toHaveTextContent('%')
  })

  it('offers quick ranges that end today', async () => {
    const user = userEvent.setup()
    const { onRangeChange } = await renderScreen({ from: '2026-10-01', to: '2026-10-31' })
    await user.click(screen.getByRole('button', { name: 'Last 7 days' }))
    const [range] = onRangeChange.mock.lastCall as [{ from: string; to: string }]
    expect(daysBetween(range.from, range.to)).toBe(6)
    await user.click(screen.getByRole('button', { name: 'Last 90 days' }))
    const [longer] = onRangeChange.mock.lastCall as [{ from: string; to: string }]
    expect(daysBetween(longer.from, longer.to)).toBe(89)
  })

  it('applies a custom range picked in the form', async () => {
    const user = userEvent.setup()
    const { onRangeChange } = await renderScreen({ from: '2026-10-01', to: '2026-10-31' })
    await user.click(await screen.findByRole('button', { name: /Start date.*01 Oct 2026/ }))
    await user.click(await screen.findByRole('button', { name: /October 15th, 2026/ }))
    await user.click(screen.getByRole('button', { name: 'Show figures' }))
    expect(onRangeChange).toHaveBeenLastCalledWith({ from: '2026-10-15', to: '2026-10-31' })
  })

  it('refuses a custom range that ends before it starts', async () => {
    const user = userEvent.setup()
    const { onRangeChange } = await renderScreen({ from: '2026-10-01', to: '2026-10-31' })
    await user.click(await screen.findByRole('button', { name: /End date.*31 Oct 2026/ }))
    await user.click(await screen.findByRole('button', { name: /September 30th, 2026/ }))
    await user.click(screen.getByRole('button', { name: 'Show figures' }))
    expect(await screen.findByText('The end date must be on or after the start date.')).toBeInTheDocument()
    expect(onRangeChange).not.toHaveBeenCalled()
  })

  it('does not ask the API for a range in the address that cannot be shown', async () => {
    await renderScreen({ from: '2024-01-01', to: '2025-06-30' })
    expect(await screen.findByText('Choose a range of at most 366 days.')).toBeInTheDocument()
    expect(fakeSource.analytics).not.toHaveBeenCalled()
  })

  it("shows the API's reason when the figures cannot be read", async () => {
    fakeSource.analytics.mockRejectedValue(new ApiError(403, ['You are not allowed to perform this action'], null))
    await renderScreen()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The communication analytics could not be loaded')
    expect(alert).toHaveTextContent('You are not allowed to perform this action.')
  })

  it('asks for a workspace when none is open', async () => {
    resetWorkspace()
    await renderScreen()
    expect(await screen.findByRole('heading', { name: 'Communication analytics' })).toBeInTheDocument()
    expect(fakeSource.analytics).not.toHaveBeenCalled()
  })
})
