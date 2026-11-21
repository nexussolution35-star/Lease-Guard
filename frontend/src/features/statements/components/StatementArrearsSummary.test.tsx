import { QueryClientProvider } from '@tanstack/react-query'
import type { StatementArrearsEntry, StatementArrearsSummary as Summary } from '@leaseguard/domain'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { StatementArrearsSource } from '../api/arrearsSource'
import { StatementArrearsSummary } from './StatementArrearsSummary'

const VERIFIER_ID = '7d9f3c2a-0000-5000-8000-0000000000bb'

const fakeSource = vi.hoisted(() => ({ summary: vi.fn<StatementArrearsSource['summary']>() }))
vi.mock('../api/arrearsSource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/arrearsSource')>()),
  createApiStatementArrearsSource: () => fakeSource,
}))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))
vi.mock('@/features/users/api/apiSource', () => ({
  createApiUserSource: () => ({
    listMembers: async () => ({ items: [{ id: VERIFIER_ID, fullName: 'Thandi Mokoena' }], total: 1, page: 1, pageSize: 100 }),
  }),
}))

const spaces = { normalizer: (text: string) => text.replace(/\s/g, ' ') }

function entry(overrides: Partial<StatementArrearsEntry>): StatementArrearsEntry {
  return {
    tenantId: 't1',
    tenantName: 'Umoya Coffee',
    propertyId: 'p1',
    propertyName: 'Acacia Park',
    unitNumber: 'G12',
    statementId: 's1',
    statementDate: '2026-10-31',
    outstanding: 12_000,
    ageDays: 21,
    bucket: 'current',
    underArrangement: false,
    remindersSuppressed: false,
    verifiedByUserId: VERIFIER_ID,
    verifiedAt: '2026-11-02T09:00:00+02:00',
    ...overrides,
  }
}

const SUMMARY: Summary = {
  asOf: '2026-11-21',
  ageingBuckets: [30, 60, 90, 120],
  totalOutstanding: 16_500.5,
  tenantsInArrears: 2,
  tenantsUnderArrangement: 1,
  pendingReview: 3,
  buckets: [
    { bucket: 'current', description: '0–29 days', outstanding: 12_000, tenantCount: 1 },
    { bucket: '30', description: '30–59 days', outstanding: 0, tenantCount: 0 },
    { bucket: '60', description: '60–89 days', outstanding: 0, tenantCount: 0 },
    { bucket: '90', description: '90–119 days', outstanding: 0, tenantCount: 0 },
    { bucket: '120+', description: '120 days or more', outstanding: 4_500.5, tenantCount: 1 },
  ],
  entries: [
    entry({}),
    entry({ tenantId: 't2', tenantName: 'Book Nook', statementId: 's2', statementDate: '2026-07-15', outstanding: 4_500.5, ageDays: 129, bucket: '120+', underArrangement: true, remindersSuppressed: true }),
  ],
}

async function renderSummary() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <StatementArrearsSummary />
    </QueryClientProvider>,
    '/statements',
  )
}

const tenantRow = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.summary.mockReset()
})

describe('StatementArrearsSummary', () => {
  it('shows the figures exactly as the API calculated them, in ZAR and dd MMM yyyy', async () => {
    fakeSource.summary.mockResolvedValue(SUMMARY)
    await renderSummary()

    const total = await screen.findByRole('button', { name: /Total outstanding/ })
    expect(within(total).getByText('R 16 500,50', spaces)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tenants in arrears/ })).toHaveTextContent('1 under a payment arrangement')
    expect(screen.getByText(/aged from its statement date to 21 Nov 2026/)).toBeInTheDocument()

    const buckets = screen.getByRole('group', { name: 'Outstanding by ageing bucket' })
    expect(within(buckets).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Current'),
      expect.stringContaining('30 days'),
      expect.stringContaining('60 days'),
      expect.stringContaining('90 days'),
      expect.stringContaining('120+ days'),
    ])
    expect(within(buckets).getByRole('button', { name: /120\+ days/ })).toHaveTextContent(/R 4 500,50/)
  })

  it('links the review figure to the statements waiting for review', async () => {
    fakeSource.summary.mockResolvedValue(SUMMARY)
    await renderSummary()
    const review = await screen.findByRole('link', { name: /Waiting for review/ })
    expect(review).toHaveAttribute('href', '/statements?status=review_required')
    expect(review).toHaveTextContent('3')
  })

  it('lists each tenant with the statement behind the balance, its sign-off and any arrangement', async () => {
    fakeSource.summary.mockResolvedValue(SUMMARY)
    await renderSummary()

    await screen.findByText('Umoya Coffee')
    const umoya = tenantRow('Umoya Coffee')
    expect(within(umoya).getByRole('link', { name: '31 Oct 2026' })).toHaveAttribute('href', '/statements/s1')
    await waitFor(() => expect(within(umoya).getByText('Thandi Mokoena')).toBeInTheDocument())
    expect(within(umoya).queryByText(/Payment arrangement/)).not.toBeInTheDocument()

    const nook = tenantRow('Book Nook')
    expect(within(nook).getByText('Payment arrangement · reminders paused')).toBeInTheDocument()
    expect(within(nook).getByRole('link', { name: '15 Jul 2026' })).toHaveAttribute('href', '/statements/s2')
  })

  it('a bucket shows only the tenants whose balance is in it', async () => {
    fakeSource.summary.mockResolvedValue(SUMMARY)
    await renderSummary()
    await screen.findByText('Umoya Coffee')

    const oldest = screen.getByRole('button', { name: /120\+ days/ })
    await userEvent.click(oldest)
    expect(oldest).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Umoya Coffee')).not.toBeInTheDocument()
    expect(screen.getByText('Book Nook')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /30 days/ }))
    expect(screen.getByText("No tenant's balance is in the 30 days bucket.")).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Total outstanding/ }))
    expect(screen.getByText('Umoya Coffee')).toBeInTheDocument()
    expect(screen.getByText('Book Nook')).toBeInTheDocument()
  })

  it('says so when no verified statement shows a balance', async () => {
    fakeSource.summary.mockResolvedValue({ ...SUMMARY, totalOutstanding: 0, tenantsInArrears: 0, tenantsUnderArrangement: 0, entries: [] })
    await renderSummary()
    expect(await screen.findByText('No verified statement shows a balance outstanding.')).toBeInTheDocument()
  })

  it('offers a retry when the figures cannot be loaded, showing no figure', async () => {
    fakeSource.summary.mockRejectedValueOnce(new Error('down'))
    await renderSummary()
    expect(await screen.findByRole('alert')).toHaveTextContent('The arrears figures could not be loaded.')
    expect(screen.queryByText(/R /)).not.toBeInTheDocument()

    fakeSource.summary.mockResolvedValueOnce(SUMMARY)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Umoya Coffee')).toBeInTheDocument()
  })
})
