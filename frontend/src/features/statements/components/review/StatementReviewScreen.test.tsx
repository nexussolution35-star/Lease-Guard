import { ApiError } from '@leaseguard/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  fieldResolution,
  EXTRACTION_FIELD_NAMES,
  type ExtractedField,
  type Lease,
  type Statement,
  type StatementExtraction,
} from '@leaseguard/domain'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import type { CompanyMember } from '@/features/users/api/source'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { StatementSource } from '../../api/source'
import { StatementReviewScreen } from './StatementReviewScreen'

const fakeStatements = vi.hoisted(() => ({
  list: vi.fn<StatementSource['list']>(),
  get: vi.fn<StatementSource['get']>(),
  getExtraction: vi.fn<StatementSource['getExtraction']>(),
  downloadUrl: vi.fn<StatementSource['downloadUrl']>(),
  confirmField: vi.fn<StatementSource['confirmField']>(),
  confirmNotOnStatement: vi.fn<StatementSource['confirmNotOnStatement']>(),
  correctField: vi.fn<StatementSource['correctField']>(),
  setMatch: vi.fn<StatementSource['setMatch']>(),
  verify: vi.fn<StatementSource['verify']>(),
  reject: vi.fn<StatementSource['reject']>(),
  markDuplicate: vi.fn<StatementSource['markDuplicate']>(),
  retryProcessing: vi.fn<StatementSource['retryProcessing']>(),
}))
const others = vi.hoisted(() => ({
  tenant: vi.fn(),
  tenants: vi.fn(),
  unit: vi.fn(),
  units: vi.fn(),
  lease: vi.fn(),
  leases: vi.fn(),
  property: vi.fn(),
  members: vi.fn(),
}))
vi.mock('../../api/selectSource', () => ({ getStatementSource: () => fakeStatements }))
vi.mock('@/features/tenants/api/selectSource', () => ({ getTenantSource: () => ({ get: others.tenant, list: others.tenants }) }))
vi.mock('@/features/units/api/selectSource', () => ({ getUnitSource: () => ({ get: others.unit, list: others.units }) }))
vi.mock('@/features/leases/api/selectSource', () => ({ getLeaseSource: () => ({ get: others.lease, list: others.leases }) }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => ({ get: others.property, list: vi.fn() }) }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => ({ listMembers: others.members }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({
  useIsCompanyWriter: () => viewer.writer,
  useCurrentUserId: () => '7d9f3c2a-0000-5000-8000-000000000001',
}))

const STATEMENT_ID = 'c0000000-0000-4000-8000-000000000001'
const OTHER_ID = 'c0000000-0000-4000-8000-000000000002'
const PROPERTY_ID = 'a0000000-0000-4000-8000-000000000001'
const TENANT_ID = 'b0000000-0000-4000-8000-000000000001'
const UNIT_ID = 'd0000000-0000-4000-8000-000000000001'
const LEASE_ID = 'e0000000-0000-4000-8000-000000000001'
const MANAGER = '5b0c1d2e-0000-4000-8000-0000000000a2'
const FILE_URL = 'http://127.0.0.1:54321/storage/v1/object/sign/statements/october.pdf?token=t'

const VALUES: Record<(typeof EXTRACTION_FIELD_NAMES)[number], string | number> = {
  tenant_name: 'Umoya Coffee',
  unit_number: 'G12',
  statement_number: 'INV-1001',
  statement_date: '2026-10-31',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  opening_balance: 1000,
  rental_charged: 37_800,
  additional_charges: 2_200,
  payments_received: 36_000,
  outstanding_balance: 5_000,
  total_due: 5_000,
}

function field(name: ExtractedField['name'], overrides: Partial<ExtractedField> = {}): ExtractedField {
  const base = { name, rawText: String(VALUES[name]), value: VALUES[name], confidence: 0.97, flagged: false, ...overrides }
  return { ...base, resolution: fieldResolution(base) } as ExtractedField
}

function extraction(fields: Partial<Record<ExtractedField['name'], Partial<ExtractedField>>> = {}, overrides: Partial<StatementExtraction> = {}): StatementExtraction {
  return {
    id: 'f0000000-0000-4000-8000-000000000001',
    companyId: NEXUS_ID,
    createdAt: '2026-11-02T08:00:00+02:00',
    updatedAt: '2026-11-02T08:00:00+02:00',
    statementId: STATEMENT_ID,
    engine: 'leaseguard-document-processing',
    extractedAt: '2026-11-02T08:00:00+02:00',
    overallConfidence: 0.91,
    fields: EXTRACTION_FIELD_NAMES.map((name) => field(name, fields[name])),
    matchConfidence: 0.95,
    matchedTenantId: TENANT_ID,
    matchedUnitId: UNIT_ID,
    status: 'pending_review',
    issues: [],
    ...overrides,
  }
}

function statement(overrides: Partial<Statement> = {}): Statement {
  const base = sampleRecord('statements')
  return {
    ...base,
    id: STATEMENT_ID,
    companyId: NEXUS_ID,
    propertyId: PROPERTY_ID,
    tenantId: undefined,
    unitId: undefined,
    leaseId: undefined,
    file: { ...base.file, fileName: 'october.pdf' },
    status: 'review_required',
    statementNumber: undefined,
    openingBalance: undefined,
    rentalCharged: undefined,
    additionalCharges: undefined,
    paymentsReceived: undefined,
    closingBalance: undefined,
    totalDue: undefined,
    verifiedByUserId: undefined,
    verifiedAt: undefined,
    processingError: undefined,
    duplicateOfStatementId: undefined,
    rejectionReason: undefined,
    lineItems: [
      { id: 'l1', statementId: STATEMENT_ID, date: '2026-10-01', description: 'Rental October', category: 'rental', kind: 'charge', amount: 37_800, flagged: false },
      { id: 'l2', statementId: STATEMENT_ID, date: '2026-10-05', description: 'EFT received', category: 'payment', kind: 'payment', amount: 36_000, flagged: true },
    ],
    ...overrides,
  } as Statement
}

const LEASE = {
  ...sampleRecord('leases'),
  id: LEASE_ID,
  companyId: NEXUS_ID,
  reference: 'L-001',
  tenantId: TENANT_ID,
  unitId: UNIT_ID,
  propertyId: PROPERTY_ID,
  status: 'active',
  commencementDate: '2025-02-01',
  expiryDate: '2028-01-31',
} as Lease
const MATCHED = { tenantId: TENANT_ID, unitId: UNIT_ID, leaseId: LEASE_ID }

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 100 })
const member = { id: MANAGER, fullName: 'Naledi van der Merwe', status: 'active' } as unknown as CompanyMember

function renderScreen(record: Statement) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <StatementReviewScreen statement={record} />
      <Toaster />
    </QueryClientProvider>,
    `/statements/${record.id}`,
  )
}

const rowOf = async (label: string) => screen.findByRole('listitem', { name: label })

/** Sets the viewport the screen sees through `matchMedia`: wide embeds the PDF (from `md`), narrow is a phone. */
function viewportIs(width: 'wide' | 'narrow') {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: width === 'wide' && query === '(min-width: 48rem)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}

afterEach(() => {
  vi.mocked(window.matchMedia).mockRestore?.()
})

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = true
  for (const fn of [...Object.values(fakeStatements), ...Object.values(others)]) fn.mockReset()
  fakeStatements.downloadUrl.mockResolvedValue(FILE_URL)
  fakeStatements.getExtraction.mockResolvedValue(extraction())
  fakeStatements.list.mockResolvedValue(page([]))
  others.property.mockResolvedValue({ ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Acacia Park' })
  others.tenant.mockResolvedValue({ ...sampleRecord('tenants'), id: TENANT_ID, tradingName: 'Umoya Coffee' })
  others.tenants.mockResolvedValue(page([{ ...sampleRecord('tenants'), id: TENANT_ID, tradingName: 'Umoya Coffee', leaseCount: 1 }]))
  others.unit.mockResolvedValue({ ...sampleRecord('units'), id: UNIT_ID, unitNumber: 'G12' })
  others.units.mockResolvedValue(page([{ ...sampleRecord('units'), id: UNIT_ID, unitNumber: 'G12' }]))
  others.lease.mockResolvedValue(LEASE)
  others.leases.mockResolvedValue(page([{ ...LEASE, tenantName: 'Umoya Coffee', propertyName: 'Acacia Park', unitNumber: 'G12' }]))
  others.members.mockResolvedValue(page([member]))
})

describe('StatementReviewScreen', () => {
  it('always shows the original statement beside the values, and opens it in a new tab', async () => {
    viewportIs('wide')
    await renderScreen(statement())
    expect(await screen.findByTitle('Original statement: october.pdf')).toHaveAttribute('src', FILE_URL)

    const tab = { opener: {}, location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    await userEvent.click(screen.getByRole('button', { name: 'Open in a new tab' }))
    await waitFor(() => expect(tab.location.href).toBe(FILE_URL))
    expect(tab.opener).toBeNull()
    open.mockRestore()
  })

  it('on a phone offers the original in a new tab and does not download it into the page', async () => {
    viewportIs('narrow')
    await renderScreen(statement())
    expect(await screen.findByRole('button', { name: 'Open in a new tab' })).toBeInTheDocument()
    expect(screen.queryByTitle('Original statement: october.pdf')).not.toBeInTheDocument()
    expect(fakeStatements.downloadUrl).not.toHaveBeenCalled()
  })

  it('says why a field is flagged and offers Confirm for a value that was read, Enter for one that was not', async () => {
    fakeStatements.getExtraction.mockResolvedValue(
      extraction(
        {
          statement_date: { flagged: true },
          outstanding_balance: { value: null, rawText: 'R 5 OOO,00', flagged: true },
        },
        {
          issues: [
            { code: 'typed_value_mismatch', severity: 'warning', message: 'The statement date on the document (31 Oct 2026) differs from the one typed at upload (30 Oct 2026).', field: 'statement_date' },
            { code: 'totals_do_not_reconcile', severity: 'error', message: 'The figures do not add up to the outstanding balance.', field: 'outstanding_balance' },
          ],
        },
      ),
    )
    await renderScreen(statement())

    const date = await rowOf('Statement date')
    expect(within(date).getByText('Differs from what was typed')).toBeInTheDocument()
    expect(within(date).getByRole('button', { name: 'Confirm statement date' })).toBeInTheDocument()

    const balance = await rowOf('Outstanding balance')
    expect(within(balance).getByText('Does not reconcile')).toBeInTheDocument()
    expect(within(balance).getByText('Not found')).toBeInTheDocument()
    expect(within(balance).queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument()
    expect(within(balance).getByRole('button', { name: 'Enter outstanding balance' })).toBeInTheDocument()

    // A value found without a flag needs nothing.
    expect(within(await rowOf('Tenant name')).getByText('Found, not flagged')).toBeInTheDocument()
  })

  it('offers Verify only once nothing is unresolved, listing what remains', async () => {
    fakeStatements.getExtraction.mockResolvedValue(extraction({ statement_date: { flagged: true } }))
    await renderScreen(statement())

    expect(await screen.findByText('The statement date is flagged: confirm or correct it')).toBeInTheDocument()
    expect(screen.getByText('The tenant is not set')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled()
  })

  it('confirms a flagged field through the API', async () => {
    fakeStatements.getExtraction.mockResolvedValue(extraction({ statement_date: { flagged: true } }))
    fakeStatements.confirmField.mockResolvedValue(extraction({ statement_date: { flagged: true, confirmedAt: '2026-11-21T08:00:00Z', confirmedByUserId: MANAGER } }))
    await renderScreen(statement(MATCHED))

    await userEvent.click(within(await rowOf('Statement date')).getByRole('button', { name: 'Confirm statement date' }))
    expect(fakeStatements.confirmField).toHaveBeenCalledWith(NEXUS_ID, STATEMENT_ID, 'statement_date')
    expect(await within(await rowOf('Statement date')).findByText('Naledi van der Merwe')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verify' })).toBeEnabled())
  })

  it('records that a statement prints no number, without filling one in; a required field cannot be left out', async () => {
    const noNumber = { value: null, rawText: '', flagged: true }
    fakeStatements.getExtraction.mockResolvedValue(extraction({ statement_number: noNumber, outstanding_balance: { value: null, rawText: '', flagged: true } }))
    fakeStatements.confirmNotOnStatement.mockResolvedValue(
      extraction({
        statement_number: { ...noNumber, confirmedAt: '2026-11-21T08:00:00Z', confirmedByUserId: MANAGER },
        outstanding_balance: { value: null, rawText: '', flagged: true },
      }),
    )
    await renderScreen(statement(MATCHED))

    const outstanding = /^the statement number was not found on the statement: enter it, or confirm it is not on the statement$/i
    expect(await screen.findByText(outstanding)).toBeInTheDocument()
    expect(within(await rowOf('Outstanding balance')).queryByRole('button', { name: /not on the statement/i })).not.toBeInTheDocument()

    await userEvent.click(within(await rowOf('Statement number')).getByRole('button', { name: 'Confirm the statement number is not on the statement' }))
    expect(fakeStatements.confirmNotOnStatement).toHaveBeenCalledWith(NEXUS_ID, STATEMENT_ID, 'statement_number')
    const row = await rowOf('Statement number')
    expect(await within(row).findByText('Not on the statement')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /not on the statement/i })).not.toBeInTheDocument()
    // The verification checklist no longer lists it (the field's original reason stays, as for any resolved field).
    await waitFor(() => expect(screen.queryByText(outstanding)).not.toBeInTheDocument())
    expect(fakeStatements.correctField).not.toHaveBeenCalled()
  })

  it('enters a missing amount, checked by the domain rule', async () => {
    fakeStatements.getExtraction.mockResolvedValue(extraction({ total_due: { value: null, rawText: '', flagged: true } }))
    fakeStatements.correctField.mockResolvedValue(extraction({ total_due: { value: null, rawText: '', flagged: true, correctedValue: 5000 } }))
    await renderScreen(statement(MATCHED))

    await userEvent.click(within(await rowOf('Total due')).getByRole('button', { name: 'Enter total due' }))
    const dialog = await screen.findByRole('dialog', { name: 'Enter the total due' })
    await userEvent.type(within(dialog).getByLabelText(/Total due \(ZAR\)/), '5000')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save value' }))
    await waitFor(() => expect(fakeStatements.correctField).toHaveBeenCalledWith(NEXUS_ID, STATEMENT_ID, 'total_due', 5000))
  })

  it('starts the match from the proposal and saves tenant and unit, letting the API take the lease in force', async () => {
    fakeStatements.setMatch.mockResolvedValue(statement(MATCHED))
    await renderScreen(statement())

    await waitFor(() => expect(screen.getByText(/Proposed from the statement:/)).toHaveTextContent('Umoya Coffee, unit G12'))
    expect(await screen.findByText('In force on 31 Oct 2026: L-001.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save tenant, unit and lease' }))
    await waitFor(() => expect(fakeStatements.setMatch).toHaveBeenCalledWith(NEXUS_ID, STATEMENT_ID, { tenantId: TENANT_ID, unitId: UNIT_ID }))
  })

  it('verifies a statement with nothing unresolved, and reports a refusal', async () => {
    fakeStatements.verify.mockRejectedValueOnce(new ApiError(422, ['The lease is not set'], 'req-1'))
    await renderScreen(statement(MATCHED))

    await userEvent.click(await screen.findByRole('button', { name: 'Verify' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Verify this statement?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('The lease is not set.')).toBeInTheDocument()

    fakeStatements.verify.mockResolvedValueOnce({ statement: statement({ ...MATCHED, status: 'verified' }) as never, monitoringQueued: true })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText('Statement verified')).toBeInTheDocument()
  })

  it('rejects with a reason and marks a duplicate of another statement', async () => {
    fakeStatements.reject.mockResolvedValue(statement({ status: 'rejected', rejectionReason: 'Wrong tenant' }))
    await renderScreen(statement())

    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Reject this statement?' })
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('Why is it rejected?'), 'Wrong tenant')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(fakeStatements.reject).toHaveBeenCalledWith(NEXUS_ID, STATEMENT_ID, 'Wrong tenant'))

    fakeStatements.list.mockResolvedValue(page([]))
    await userEvent.click(screen.getByRole('button', { name: 'Mark as duplicate' }))
    const duplicate = await screen.findByRole('dialog', { name: 'Mark as a duplicate' })
    expect(await within(duplicate).findByText('No other statement of this property can be chosen.')).toBeInTheDocument()
    expect(within(duplicate).getByRole('button', { name: 'Mark as duplicate' })).toBeDisabled()
  })

  it('shows a verified statement’s figures and who verified it, with no review actions', async () => {
    fakeStatements.getExtraction.mockResolvedValue(extraction({}, { status: 'confirmed' }))
    await renderScreen(
      statement({
        ...MATCHED,
        status: 'verified',
        statementDate: '2026-10-31',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        openingBalance: 1000,
        rentalCharged: 37_800,
        additionalCharges: 2_200,
        paymentsReceived: 36_000,
        closingBalance: 5_000,
        totalDue: 5_000,
        verifiedByUserId: MANAGER,
        verifiedAt: '2026-11-03T08:00:00+02:00',
      }),
    )
    const verification = await screen.findByRole('region', { name: 'Verification' })
    expect(await within(verification).findByText('Naledi van der Merwe')).toBeInTheDocument()
    expect(within(verification).getByText('Outstanding balance')).toBeInTheDocument()
    expect(within(verification).getAllByText(/R\s?5\s?000,00/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument()
  })

  it('says why a rejected statement was rejected and what a duplicate repeats', async () => {
    const { unmount } = await renderScreen(statement({ status: 'rejected', rejectionReason: 'The statement is for another centre' }))
    expect(await screen.findByText('The statement is for another centre')).toBeInTheDocument()
    unmount()

    fakeStatements.get.mockResolvedValue(statement({ id: OTHER_ID, statementNumber: 'INV-0999' }))
    await renderScreen(statement({ status: 'duplicate', duplicateOfStatementId: OTHER_ID }))
    expect(await screen.findByRole('link', { name: 'statement INV-0999' })).toHaveAttribute('href', `/statements/${OTHER_ID}`)
  })

  it('is read-only for members who cannot write', async () => {
    viewer.writer = false
    fakeStatements.getExtraction.mockResolvedValue(extraction({ statement_date: { flagged: true } }))
    await renderScreen(statement(MATCHED))

    expect(within(await rowOf('Statement date')).getByText('Confirm or correct')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirm statement date/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Correct/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save tenant, unit and lease' })).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'L-001' })).toHaveAttribute('href', `/leases/${LEASE_ID}`)
    // The original is still there for every member.
    expect(screen.getByRole('button', { name: 'Open in a new tab' })).toBeInTheDocument()
  })
})
