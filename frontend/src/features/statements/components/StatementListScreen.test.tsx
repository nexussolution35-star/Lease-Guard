import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import type { StatementListItem } from '@leaseguard/domain'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { useAppStore } from '@/store/appStore'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'
import { sampleRecord } from '@/test/fakeApi'

import type { StatementSource } from '../api/source'
import { STATEMENT_LIST_DEFAULTS, statementListSearchSchema, type StatementListSearch } from '../listSearch'
import { StatementListScreen } from './StatementListScreen'

const PROPERTY_ID = 'a1b2c3d4-0000-5000-8000-0000000000aa'
const VERIFIER_ID = '7d9f3c2a-0000-5000-8000-0000000000bb'

const fakeSource = vi.hoisted(() => ({
  list: vi.fn<StatementSource['list']>(),
  get: vi.fn<StatementSource['get']>(),
  retryProcessing: vi.fn<StatementSource['retryProcessing']>(),
  verifyMany: vi.fn<StatementSource['verifyMany']>(),
}))

vi.mock('../api/selectSource', () => ({ getStatementSource: () => fakeSource }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))
vi.mock('@/features/properties/api/selectSource', () => ({
  getPropertySource: () => ({
    list: async () => ({ items: [{ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Acacia Park' }], total: 1, page: 1, pageSize: 100 }),
  }),
}))
const viewer = vi.hoisted(() => ({ writer: false }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyWriter: () => viewer.writer }))
vi.mock('@/features/users/api/apiSource', () => ({
  createApiUserSource: () => ({
    listMembers: async () => ({ items: [{ id: VERIFIER_ID, fullName: 'Thandi Mokoena' }], total: 1, page: 1, pageSize: 100 }),
  }),
}))

const BASE: StatementListSearch = statementListSearchSchema.parse({})
const FAILURE = 'The PDF could not be read; enter the figures manually'

function statement(id: string, fileName: string, overrides: Partial<StatementListItem> = {}): StatementListItem {
  const base = sampleRecord('statements')
  return {
    ...base,
    id,
    file: { ...base.file, fileName },
    status: 'review_required',
    closingBalance: undefined,
    verifiedByUserId: undefined,
    verifiedAt: undefined,
    propertyName: 'Acacia Park',
    tenantName: 'Umoya Coffee',
    unitNumber: 'G12',
    readyToVerify: false,
    ...overrides,
  } as StatementListItem
}

const page = (items: StatementListItem[], total = items.length) => ({ items, total, page: 1, pageSize: 25 })

async function renderScreen(params: StatementListSearch = BASE) {
  const onParamsChange = vi.fn<(next: StatementListSearch) => void>()
  const result = await renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <StatementListScreen params={params} onParamsChange={onParamsChange} />
    </QueryClientProvider>,
    '/statements',
  )
  return { ...result, onParamsChange }
}

const rowOf = async (fileName: string) => (await screen.findByRole('link', { name: fileName })).closest('tr') as HTMLElement

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = false
  for (const fn of Object.values(fakeSource)) fn.mockReset()
})

describe('StatementListScreen', () => {
  it('shows a loading state, with the page name for screen readers only', async () => {
    fakeSource.list.mockReturnValue(new Promise(() => undefined))
    await renderScreen()
    expect(await screen.findByRole('status')).toHaveTextContent('Loading records…')
    expect(screen.getByRole('heading', { level: 1, name: 'Statements' })).toHaveClass('sr-only')
  })

  it('shows the API error with a working retry', async () => {
    fakeSource.list.mockRejectedValueOnce(new ApiError(503, ['The database is unavailable'], 'req-1'))
    await renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is unavailable')

    fakeSource.list.mockResolvedValueOnce(page([statement('s1', 'October.pdf')]))
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('link', { name: 'October.pdf' })).toBeInTheDocument()
  })

  it('shows an empty workspace state, inviting writers to upload', async () => {
    viewer.writer = true
    fakeSource.list.mockResolvedValue(page([]))
    await renderScreen()
    expect(await screen.findByText('No statements yet')).toBeInTheDocument()
    expect(screen.getByText('Upload the first tenant statements of this workspace.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload statements' })).toHaveAttribute('href', '/statements/upload')
  })

  it('shows the balance and sign-off of verified statements only', async () => {
    fakeSource.list.mockResolvedValue(
      page([
        statement('s1', 'Verified.pdf', { status: 'verified', closingBalance: 4200.5, verifiedByUserId: VERIFIER_ID, verifiedAt: '2026-11-03T08:00:00+02:00' }),
        // A figure on an unverified statement is never shown, even if one is present.
        statement('s2', 'Review.pdf', { status: 'review_required', closingBalance: 9999, tenantName: undefined, unitNumber: undefined }),
      ]),
    )
    await renderScreen()

    const verified = await rowOf('Verified.pdf')
    expect(within(verified).getByText('R 4 200,50', { normalizer: (text) => text.replace(/\s/g, ' ') })).toBeInTheDocument()
    await waitFor(() => expect(within(verified).getByText('TM')).toBeInTheDocument())
    expect(within(verified).getByText('Thandi Mokoena')).toBeInTheDocument()
    expect(within(verified).getByText('03 Nov 2026')).toBeInTheDocument()

    const review = await rowOf('Review.pdf')
    expect(within(review).queryByText(/9 999/)).not.toBeInTheDocument()
    expect(within(review).getByLabelText('Not available')).toBeInTheDocument()
    expect(within(review).getByText('Not verified')).toBeInTheDocument()
    expect(within(review).getByText('Not matched')).toBeInTheDocument()
    expect(within(review).getByText('Review required')).toBeInTheDocument()
  })

  it('shows why processing failed, read-only for members who cannot write', async () => {
    fakeSource.list.mockResolvedValue(page([statement('s1', 'Scan.pdf', { processingError: FAILURE })]))
    await renderScreen()
    const row = await rowOf('Scan.pdf')
    expect(within(row).getByText('Processing failed')).toBeInTheDocument()
    expect(within(row).getByText(FAILURE)).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /retry processing/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upload statements' })).not.toBeInTheDocument()
  })

  it('lets writers retry a failed statement without opening it', async () => {
    viewer.writer = true
    fakeSource.list.mockResolvedValue(page([statement('s1', 'Scan.pdf', { processingError: FAILURE })]))
    fakeSource.retryProcessing.mockResolvedValue({ statementId: 's1', status: 'uploaded', jobId: 'job-1', outcome: 'retried' })
    const { router } = await renderScreen()

    const row = await rowOf('Scan.pdf')
    await userEvent.click(within(row).getByRole('button', { name: /retry processing/i }))

    await waitFor(() => expect(fakeSource.retryProcessing).toHaveBeenCalledWith(NEXUS_ID, 's1'))
    // The list is read again for the new status.
    await waitFor(() => expect(fakeSource.list).toHaveBeenCalledTimes(2))
    expect(router.state.location.pathname).toBe('/statements')
  })

  it('does not offer a retry for a statement whose processing did not fail', async () => {
    viewer.writer = true
    fakeSource.list.mockResolvedValue(page([statement('s1', 'Uploaded.pdf', { status: 'uploaded' })]))
    await renderScreen()
    const row = await rowOf('Uploaded.pdf')
    expect(within(row).getByText('Uploaded')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /retry processing/i })).not.toBeInTheDocument()
  })

  it('sends the URL filters and search to the source', async () => {
    fakeSource.list.mockResolvedValue(page([]))
    await renderScreen({ ...BASE, search: 'MRI-0001', status: 'verified', propertyId: PROPERTY_ID, sourceSystem: 'MRI' })

    expect(await screen.findByText('No matching records')).toBeInTheDocument()
    expect(fakeSource.list).toHaveBeenCalledWith(NEXUS_ID, {
      ...STATEMENT_LIST_DEFAULTS,
      search: 'MRI-0001',
      status: 'verified',
      propertyId: PROPERTY_ID,
      sourceSystem: 'MRI',
    })
  })

  it('shows a filtered empty state that clears search and every filter', async () => {
    fakeSource.list.mockResolvedValue(page([]))
    const { onParamsChange } = await renderScreen({ ...BASE, page: 2, search: 'zzz', status: 'rejected', sourceSystem: 'Sage' })
    expect(await screen.findByText('No matching records')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Clear filters' })
    await userEvent.click(buttons[1] as HTMLElement)
    expect(onParamsChange).toHaveBeenLastCalledWith({
      ...BASE,
      page: 1,
      search: undefined,
      status: undefined,
      propertyId: undefined,
      sourceSystem: undefined,
    })
  })

  it('pages, sorts and opens a statement from its row', async () => {
    fakeSource.list.mockResolvedValue(page([statement('s1', 'One.pdf'), statement('s2', 'Two.pdf')], 27))
    const { onParamsChange, router } = await renderScreen()

    expect(await screen.findByRole('link', { name: 'One.pdf' })).toHaveAttribute('href', '/statements/s1')
    const pagination = screen.getByRole('navigation', { name: 'Pagination' })
    await userEvent.click(within(pagination).getByRole('button', { name: 'Next page' }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 2 })

    await userEvent.click(screen.getByRole('button', { name: /^statement date/i }))
    expect(onParamsChange).toHaveBeenLastCalledWith({ ...BASE, page: 1, sort: 'statementDate', direction: 'asc' })

    const row = await rowOf('Two.pdf')
    await userEvent.click(within(row).getByText('Umoya Coffee'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/statements/s2'))
  })

  it('asks for a workspace instead of loading when none is selected', async () => {
    useAppStore.setState({ activeCompanyId: '' })
    await renderScreen()
    expect(await screen.findByText('No workspace selected')).toBeInTheDocument()
    expect(fakeSource.list).not.toHaveBeenCalled()
  })

  describe('verifying ready statements together', () => {
    const rows = () =>
      page([
        statement('s1', 'Ready.pdf', { readyToVerify: true }),
        statement('s2', 'AlsoReady.pdf', { readyToVerify: true, statementNumber: 'ST-2' }),
        statement('s3', 'Flagged.pdf'),
      ])

    it('lets writers select only the statements with nothing unresolved', async () => {
      viewer.writer = true
      fakeSource.list.mockResolvedValue(rows())
      await renderScreen()
      expect(await screen.findByRole('checkbox', { name: 'Select Ready.pdf to verify' })).toBeInTheDocument()
      expect(within(await rowOf('Ready.pdf')).getByText('Ready to verify')).toBeInTheDocument()
      expect(within(await rowOf('Flagged.pdf')).queryByRole('checkbox')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }))
      const bar = screen.getByRole('region', { name: 'Selected statements' })
      expect(bar).toHaveTextContent('2 statements ready to verify selected')
      // While statements are selected, verifying them is the one primary action.
      expect(screen.getByRole('link', { name: 'Upload statements' })).toHaveAttribute('data-variant', 'outline')
    })

    it('offers no selection to members who cannot write', async () => {
      fakeSource.list.mockResolvedValue(rows())
      await renderScreen()
      await rowOf('Ready.pdf')
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('verifies the selection after confirming and names every statement not verified, with why', async () => {
      viewer.writer = true
      fakeSource.list.mockResolvedValue(rows())
      fakeSource.verifyMany.mockResolvedValue({
        verified: [{ statementId: 's1', fileName: 'Ready.pdf', monitoringQueued: true }],
        notVerified: [{ statementId: 's2', fileName: 'AlsoReady.pdf', statementNumber: 'ST-2', reasons: ['The lease is not set', 'The total due is flagged: confirm or correct it'] }],
      })
      await renderScreen()
      await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Ready.pdf to verify' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Select AlsoReady.pdf to verify' }))
      await userEvent.click(within(screen.getByRole('region', { name: 'Selected statements' })).getByRole('button', { name: 'Verify 2 statements' }))

      const dialog = await screen.findByRole('alertdialog', { name: 'Verify 2 statements?' })
      await userEvent.click(within(dialog).getByRole('button', { name: 'Verify' }))
      await waitFor(() => expect(fakeSource.verifyMany).toHaveBeenCalledWith(NEXUS_ID, ['s1', 's2']))

      const outcome = await screen.findByRole('region', { name: 'Verification result' })
      expect(outcome).toHaveTextContent('1 statement verified')
      expect(outcome).toHaveTextContent('1 statement not verified')
      const refused = within(outcome).getByRole('list', { name: 'Statements not verified' })
      expect(within(refused).getByRole('link', { name: 'AlsoReady.pdf' })).toHaveAttribute('href', '/statements/s2')
      expect(refused).toHaveTextContent('No. ST-2')
      expect(refused).toHaveTextContent('The lease is not set')
      expect(refused).toHaveTextContent('The total due is flagged: confirm or correct it')
      expect(screen.queryByRole('region', { name: 'Selected statements' })).not.toBeInTheDocument()

      await userEvent.click(within(outcome).getByRole('button', { name: 'Dismiss the verification result' }))
      expect(screen.queryByRole('region', { name: 'Verification result' })).not.toBeInTheDocument()
    })

    it('keeps the selection and says so when the request fails', async () => {
      viewer.writer = true
      fakeSource.list.mockResolvedValue(rows())
      fakeSource.verifyMany.mockRejectedValue(new ApiError(503, ['The database is unavailable'], 'req-2'))
      await renderScreen()
      await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Ready.pdf to verify' }))
      await userEvent.click(screen.getByRole('button', { name: 'Verify 1 statement' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Verify 1 statement?' })
      await userEvent.click(within(dialog).getByRole('button', { name: 'Verify' }))
      await waitFor(() => expect(fakeSource.verifyMany).toHaveBeenCalled())
      // The dialog stays open to try again; closing it keeps the selection.
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
      expect(await screen.findByRole('region', { name: 'Selected statements' })).toHaveTextContent('1 statement ready to verify selected')
    })
  })
})

