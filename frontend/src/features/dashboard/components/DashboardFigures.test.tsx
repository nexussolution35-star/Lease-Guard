import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DashboardSummary } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { DashboardSource } from '../api/source'
import { DashboardFigures } from './DashboardFigures'

const fakeSource = vi.hoisted(() => ({ summary: vi.fn<DashboardSource['summary']>() }))
vi.mock('../api/selectSource', () => ({ getDashboardSource: () => fakeSource }))

const SUMMARY: DashboardSummary = {
  asOf: '2026-11-21',
  properties: 4,
  units: 30,
  occupiedUnits: 21,
  activeLeases: 19,
  totalOutstanding: 16_500.5,
  tenantsInArrears: 2,
  activeArrangements: 1,
  escalationDiscrepancies: 1,
  upcomingExpiries: 3,
  renewalDeadlines: 0,
  expiringGuarantees: 2,
  pendingStatementReviews: 5,
  pendingApprovals: 6,
}

async function renderFigures() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <DashboardFigures />
    </QueryClientProvider>,
    '/',
  )
}

/** The figure link whose label is `label`, as a screen reader names it (label, figure and caption). */
const figure = (label: string) => screen.getByRole('link', { name: new RegExp(`^${label}`) })

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.summary.mockReset().mockResolvedValue(SUMMARY)
})

describe('DashboardFigures', () => {
  it('shows every PRD §7.1 figure from one summary request for the active company', async () => {
    await renderFigures()
    await screen.findByRole('region', { name: 'Arrears' })

    expect(fakeSource.summary).toHaveBeenCalledTimes(1)
    expect(fakeSource.summary).toHaveBeenCalledWith(NEXUS_ID)
    expect(figure('Outstanding balances')).toHaveTextContent(/R\s?16\s?500,50/)
    expect(figure('Tenants in arrears')).toHaveTextContent('2')
    expect(figure('Active payment arrangements')).toHaveTextContent('1')
    expect(figure('Rental escalation discrepancies')).toHaveTextContent('1')
    expect(figure('Upcoming lease expiries')).toHaveTextContent('3')
    expect(figure('Upcoming renewal deadlines')).toHaveTextContent('0')
    expect(figure('Expiring bank guarantees')).toHaveTextContent('2')
    expect(figure('Statements to review')).toHaveTextContent('5')
    expect(figure('Messages awaiting approval')).toHaveTextContent('6')
    expect(figure('Properties')).toHaveTextContent('4')
    expect(figure('Units')).toHaveTextContent('30')
    expect(figure('Occupied units')).toHaveTextContent('21of 30 units')
    expect(figure('Active leases')).toHaveTextContent('19')
    // The balances' date and the monitoring-only wording come with the figures.
    expect(within(screen.getByRole('region', { name: 'Arrears' })).getByText(/as of 21 Nov 2026\. Monitoring figures: LeaseGuard takes no payments\./)).toBeInTheDocument()
  })

  it('links each figure to its list, filtered the way the API counted it', async () => {
    await renderFigures()
    await screen.findByRole('region', { name: 'Arrears' })

    expect(figure('Outstanding balances')).toHaveAttribute('href', '/statements')
    expect(figure('Tenants in arrears')).toHaveAttribute('href', '/statements')
    expect(figure('Active payment arrangements')).toHaveAttribute('href', '/arrangements?status=active')
    expect(figure('Rental escalation discrepancies')).toHaveAttribute('href', '/monitoring?type=rental_escalation_discrepancy&status=open')
    expect(figure('Upcoming lease expiries')).toHaveAttribute('href', '/monitoring?type=lease_expiry&status=open')
    expect(figure('Upcoming renewal deadlines')).toHaveAttribute('href', '/monitoring?type=renewal_notice_deadline&status=open')
    expect(figure('Expiring bank guarantees')).toHaveAttribute('href', '/monitoring?type=guarantee_expiry&status=open')
    expect(figure('Statements to review')).toHaveAttribute('href', '/statements?status=review_required')
    expect(figure('Messages awaiting approval')).toHaveAttribute('href', '/communications/approvals')
    expect(figure('Properties')).toHaveAttribute('href', '/properties')
    expect(figure('Units')).toHaveAttribute('href', '/units')
    expect(figure('Occupied units')).toHaveAttribute('href', '/units?occupancyStatus=occupied')
    expect(figure('Active leases')).toHaveAttribute('href', '/leases?status=active')
  })

  it('opens the filtered list when a figure is followed', async () => {
    const { router } = await renderFigures()
    await screen.findByRole('region', { name: 'Arrears' })

    await userEvent.click(figure('Upcoming lease expiries'))

    expect(router.state.location.pathname).toBe('/monitoring')
    expect(router.state.location.search).toEqual({ type: 'lease_expiry', status: 'open' })
  })

  it('colours only a non-zero escalation discrepancy figure', async () => {
    await renderFigures()
    await screen.findByRole('region', { name: 'Arrears' })
    expect(figure('Rental escalation discrepancies').querySelector('.text-destructive')).not.toBeNull()
    expect(figure('Upcoming lease expiries').querySelector('.text-destructive')).toBeNull()
  })

  it('announces loading once for the whole set, not per figure', async () => {
    fakeSource.summary.mockReturnValue(new Promise(() => {}))
    await renderFigures()
    expect(await screen.findAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Loading the dashboard figures…')
  })

  it('offers a retry when the figures cannot be loaded', async () => {
    fakeSource.summary.mockRejectedValueOnce(new Error('offline'))
    await renderFigures()
    expect(await screen.findByText('Could not load the dashboard figures')).toBeInTheDocument()
    fakeSource.summary.mockResolvedValue(SUMMARY)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('region', { name: 'Arrears' })).toBeInTheDocument()
  })

  it('shows nothing without a workspace', async () => {
    resetWorkspace()
    await renderFigures()
    expect(screen.queryByRole('region', { name: 'Arrears' })).not.toBeInTheDocument()
    expect(fakeSource.summary).not.toHaveBeenCalled()
  })
})
