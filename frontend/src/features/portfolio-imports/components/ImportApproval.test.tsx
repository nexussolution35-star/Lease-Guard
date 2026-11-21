import type { PortfolioImport, PortfolioImportSummary } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { PortfolioImportApplySource } from '../api/applySource'
import { ImportApproval } from './ImportApproval'

const fakeApply = vi.hoisted(() => ({
  getSummary: vi.fn<PortfolioImportApplySource['getSummary']>(),
  approve: vi.fn<PortfolioImportApplySource['approve']>(),
}))
vi.mock('../api/applySource', () => ({ getPortfolioImportApplySource: () => fakeApply }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyWriter: () => viewer.writer }))

const IMPORT_ID = '6f1d2c1e-0000-4000-8000-0000000000c1'
const MANAGER = '7d9f3c2a-0000-5000-8000-000000000001'
const PROPERTY_ID = 'f922b1e8-d0cd-5a20-8393-829bec4dbc49'
const UNIT_ID = '0b0f7a5e-0000-4000-8000-000000000004'
const BATCH: PortfolioImport = {
  id: IMPORT_ID,
  companyId: NEXUS_ID,
  scope: 'properties',
  fileName: 'portfolio.csv',
  fileFormat: 'csv',
  sizeBytes: 512,
  sheetNames: [],
  delimiter: ',',
  columns: ['Code', 'Unit'],
  rowCount: 5,
  uploadedAt: '2026-11-20T08:00:00+02:00',
  createdAt: '2026-11-20T08:00:00+02:00',
  updatedAt: '2026-11-20T08:00:00+02:00',
}

const PENDING: PortfolioImportSummary = {
  importId: IMPORT_ID,
  propertiesToCreate: 2,
  unitsToCreate: 4,
  tenantsToCreate: 0,
  tenantsLinked: 0,
  tenantSuggestionsToReview: 0,
  missingContactDetails: [],
  linkedRows: 0,
  skippedRows: 0,
  blockedRows: 1,
  canApprove: true,
  needsAccountingSystem: true,
  created: [],
}
const APPROVED: PortfolioImportSummary = {
  ...PENDING,
  propertiesToCreate: 0,
  unitsToCreate: 0,
  linkedRows: 4,
  canApprove: false,
  needsAccountingSystem: false,
  approval: { approvedByUserId: MANAGER, approvedAt: '2026-11-21T09:00:00+02:00' },
  created: [
    { recordType: 'property', id: PROPERTY_ID, label: 'Rosebank Park (RBP)', propertyId: PROPERTY_ID, propertyName: 'Rosebank Park', rowNumber: 2, createdAt: '2026-11-21T09:00:00+02:00' },
    { recordType: 'unit', id: UNIT_ID, label: 'A1', propertyId: PROPERTY_ID, propertyName: 'Rosebank Park', rowNumber: 2, createdAt: '2026-11-21T09:00:00+02:00' },
  ],
}

function renderApproval() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <ImportApproval batch={BATCH} memberName={(id) => (id === MANAGER ? 'Naledi van der Merwe' : undefined)} />
      <Toaster />
    </QueryClientProvider>,
    '/properties/import',
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = true
  fakeApply.getSummary.mockReset()
  fakeApply.approve.mockReset()
})

describe('ImportApproval', () => {
  it('summarises what approving creates, says tenant messaging stays off, and shows the approval pending', async () => {
    fakeApply.getSummary.mockResolvedValue(PENDING)
    renderApproval()
    const summary = await screen.findByLabelText('Import summary')
    expect(within(summary).getByText('Properties to create').nextSibling).toHaveTextContent('2')
    expect(within(summary).getByText('Units to create').nextSibling).toHaveTextContent('4')
    expect(within(summary).getByText('Rows still blocked').nextSibling).toHaveTextContent('1')
    expect(screen.getByText(/Tenant messaging stays off/)).toBeInTheDocument()
    expect(screen.getByText('Not approved yet')).toBeInTheDocument()
  })

  it('asks for the accounting system of new properties, then approves and lists every created record with a link', async () => {
    fakeApply.getSummary.mockResolvedValueOnce(PENDING).mockResolvedValue(APPROVED)
    fakeApply.approve.mockResolvedValue(APPROVED)
    const user = userEvent.setup()
    renderApproval()

    await user.click(await screen.findByRole('button', { name: 'Approve and import' }))
    expect(await screen.findByText("Choose the accounting system the new properties' statements come from.")).toBeInTheDocument()
    expect(fakeApply.approve).not.toHaveBeenCalled()

    await user.click(screen.getByRole('combobox', { name: 'Accounting system for the new properties' }))
    await user.click(await screen.findByRole('option', { name: 'MRI' }))
    await user.click(screen.getByRole('button', { name: 'Approve and import' }))
    await waitFor(() => expect(fakeApply.approve).toHaveBeenCalledWith(NEXUS_ID, IMPORT_ID, { accountingSystem: 'MRI' }))

    const created = await screen.findByRole('list', { name: 'Records created' })
    expect(within(created).getByRole('link', { name: 'Rosebank Park (RBP)' })).toHaveAttribute('href', `/properties/${PROPERTY_ID}`)
    expect(within(created).getByRole('link', { name: 'A1' })).toHaveAttribute('href', `/units/${UNIT_ID}`)
    expect(screen.getByText('Naledi van der Merwe')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve and import' })).toBeDisabled()
  })

  it('counts the tenants, lists missing contact details and links every created tenant', async () => {
    const TENANT_ID = '3c1a9e2b-0000-4000-8000-000000000007'
    fakeApply.getSummary.mockResolvedValue({
      ...APPROVED,
      tenantsToCreate: 1,
      tenantsLinked: 2,
      tenantSuggestionsToReview: 1,
      missingContactDetails: [
        { rowNumber: 3, tenantName: 'Bean There', missing: ['email'], blocksCreation: false },
        { rowNumber: 4, tenantName: 'Kwik Print', missing: ['contactPerson', 'phone'], blocksCreation: true },
      ],
      created: [
        ...APPROVED.created,
        {
          recordType: 'tenant',
          id: TENANT_ID,
          label: 'Bean There',
          propertyId: PROPERTY_ID,
          propertyName: 'Rosebank Park',
          unitId: UNIT_ID,
          unitNumber: 'A1',
          rowNumber: 2,
          createdAt: '2026-11-21T09:00:00+02:00',
        },
      ],
    })
    renderApproval()
    const summary = await screen.findByLabelText('Import summary')
    expect(within(summary).getByText('Tenants to create').nextSibling).toHaveTextContent('1')
    expect(within(summary).getByText('Rows linked to existing tenants').nextSibling).toHaveTextContent('2')
    expect(within(summary).getByText('Suggested tenants to confirm or reject').nextSibling).toHaveTextContent('1')

    const missing = screen.getByRole('list', { name: 'Missing contact details' })
    expect(missing).toHaveTextContent('Bean There · No email')
    expect(missing).toHaveTextContent('Kwik Print · No contact person or phone')
    expect(within(missing).getAllByText('Blocked')).toHaveLength(1)
    expect(screen.getByText(/must be validated before any automated message/)).toBeInTheDocument()

    const created = screen.getByRole('list', { name: 'Records created' })
    expect(within(created).getByRole('link', { name: 'Bean There' })).toHaveAttribute('href', `/tenants/${TENANT_ID}`)
    expect(created).toHaveTextContent('A1, Rosebank Park')
  })

  it('shows members who only read the summary without the approval action', async () => {
    viewer.writer = false
    fakeApply.getSummary.mockResolvedValue(PENDING)
    renderApproval()
    expect(await screen.findByText('Properties to create')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and import' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Accounting system for the new properties' })).not.toBeInTheDocument()
  })
})
