import type { PortfolioImport, PortfolioImportMapping, PortfolioImportPreview, PortfolioImportRowCheck } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { PortfolioImportPreviewSource } from '../api/previewSource'
import { ImportMappingPreview } from './ImportMappingPreview'

const fakePreview = vi.hoisted(() => ({
  getMapping: vi.fn<PortfolioImportPreviewSource['getMapping']>(),
  saveMapping: vi.fn<PortfolioImportPreviewSource['saveMapping']>(),
  preview: vi.fn<PortfolioImportPreviewSource['preview']>(),
  changeRow: vi.fn<PortfolioImportPreviewSource['changeRow']>(),
}))
const members = vi.hoisted(() => vi.fn())
const fakeUnits = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../api/previewSource', () => ({ getPortfolioImportPreviewSource: () => fakePreview }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => ({ listMembers: members }) }))
vi.mock('@/features/units/api/selectSource', () => ({ getUnitSource: () => fakeUnits }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({
  useIsCompanyWriter: () => viewer.writer,
  useCurrentUserId: () => '7d9f3c2a-0000-5000-8000-000000000001',
}))

const IMPORT_ID = '6f1d2c1e-0000-4000-8000-0000000000c1'
const MANAGER = '7d9f3c2a-0000-5000-8000-000000000001'
const UNIT_ID = '0b0f7a5e-0000-4000-8000-000000000004'
const BATCH: PortfolioImport = {
  id: IMPORT_ID,
  companyId: NEXUS_ID,
  scope: 'units',
  propertyId: 'f922b1e8-d0cd-5a20-8393-829bec4dbc49',
  fileName: 'units.csv',
  fileFormat: 'csv',
  sizeBytes: 512,
  sheetNames: [],
  delimiter: ',',
  columns: ['Shop No', 'Size', 'Tenant'],
  rowCount: 4,
  uploadedAt: '2026-11-20T08:00:00+02:00',
  createdAt: '2026-11-20T08:00:00+02:00',
  updatedAt: '2026-11-20T08:00:00+02:00',
}

const mappingOf = (source: PortfolioImportMapping['source'], columns: Partial<Record<string, string>>): PortfolioImportMapping => ({
  importId: IMPORT_ID,
  source,
  fields: (['unitNumber', 'unitType', 'floorAreaSqm', 'occupancyStatus'] as const).map((field) => ({
    field,
    ...(columns[field] ? { column: columns[field] } : {}),
    ...(field === 'unitNumber' ? { suggestedColumn: 'Shop No' } : field === 'floorAreaSqm' ? { suggestedColumn: 'Size' } : {}),
  })),
})

const ROWS: PortfolioImportRowCheck[] = [
  { rowNumber: 2, result: 'match', reasons: ['Unit Shop 1 of Maponya Square is already in LeaseGuard with these values'], values: { unitNumber: 'Shop 1' }, conflicts: [] },
  { rowNumber: 3, result: 'new', reasons: ['Adds the unit Shop 2 to Maponya Square'], values: { unitNumber: 'Shop 2' }, conflicts: [] },
  {
    rowNumber: 4,
    result: 'conflict',
    reasons: ['Floor area (m²) differs from unit Shop 3 of Maponya Square in LeaseGuard'],
    values: { unitNumber: 'Shop 3' },
    conflicts: [{ field: 'floorAreaSqm', value: '120', existingValue: '1250.5' }],
  },
  { rowNumber: 5, result: 'invalid', reasons: ['Unit type is missing'], values: { unitNumber: 'Shop 4' }, conflicts: [] },
]
const COUNTS = { new: 1, match: 1, suggested: 0, conflict: 1, invalid: 1, duplicate: 0, skipped: 0 }

function previewOf(result: PortfolioImportRowCheck['result'] | undefined): PortfolioImportPreview {
  const items = result ? ROWS.filter((row) => row.result === result) : ROWS
  return { importId: IMPORT_ID, counts: COUNTS, items, total: items.length, page: 1, pageSize: 25 }
}

function renderPreview() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <ImportMappingPreview batch={BATCH} />
      <Toaster />
    </QueryClientProvider>,
    '/properties/import',
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = true
  for (const fn of Object.values(fakePreview)) fn.mockReset()
  members.mockResolvedValue({
    items: [{ id: MANAGER, fullName: 'Naledi van der Merwe', status: 'active', memberships: [] }],
    total: 1,
    page: 1,
    pageSize: 100,
  })
  fakeUnits.list.mockResolvedValue({ items: [{ id: UNIT_ID, unitNumber: 'Shop 4' }], total: 1, page: 1, pageSize: 100 })
  fakePreview.getMapping.mockResolvedValue(mappingOf('suggested', { unitNumber: 'Shop No', floorAreaSqm: 'Size' }))
  fakePreview.preview.mockImplementation(async (_company, _id, params) => previewOf(params.result))
})

describe('ImportMappingPreview', () => {
  it('shows the suggested mapping and every row with its result and reason', async () => {
    renderPreview()
    const mapping = await screen.findByRole('list', { name: 'Column mapping' })
    expect(within(mapping).getByRole('combobox', { name: 'Column for Unit number' })).toHaveTextContent('Shop No')
    expect(within(mapping).getByRole('combobox', { name: 'Column for Unit type' })).toHaveTextContent('Not in the file')
    expect(screen.getByText(/Suggested from the column headings, never from the values/)).toBeInTheDocument()

    const table = await screen.findByRole('table')
    expect(within(table).getByText('Matches existing')).toBeInTheDocument()
    expect(within(table).getByText('Adds the unit Shop 2 to Maponya Square')).toBeInTheDocument()
    // A conflict shows both values.
    expect(within(table).getByText('120 m²')).toBeInTheDocument()
    expect(within(table).getByText('1 250,5 m²')).toBeInTheDocument()
    expect(fakePreview.preview).toHaveBeenCalledWith(NEXUS_ID, IMPORT_ID, { page: 1, pageSize: 25 })
  })

  it('narrows the rows by result', async () => {
    renderPreview()
    await screen.findByRole('table')
    const filters = screen.getByRole('group', { name: 'Show rows' })
    await userEvent.click(within(filters).getByRole('button', { name: /^Conflict/ }))
    await waitFor(() => expect(fakePreview.preview).toHaveBeenLastCalledWith(NEXUS_ID, IMPORT_ID, { result: 'conflict', page: 1, pageSize: 25 }))
    await waitFor(() => expect(screen.queryByText('Adds the unit Shop 2 to Maponya Square')).not.toBeInTheDocument())
    expect(within(filters).getByRole('button', { name: /^Conflict/ })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(within(filters).getByRole('button', { name: /^Duplicate in file/ }))
    expect(await screen.findByText('No rows are duplicate in file.')).toBeInTheDocument()
  })

  it('applies a changed mapping, refusing a column chosen for two fields', async () => {
    fakePreview.saveMapping.mockResolvedValue(mappingOf('applied', { unitNumber: 'Shop No', floorAreaSqm: 'Size', unitType: 'Tenant' }))
    renderPreview()
    const apply = await screen.findByRole('button', { name: 'Apply mapping' })

    await userEvent.click(screen.getByRole('combobox', { name: 'Column for Unit type' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Size' }))
    expect(await screen.findAllByText(/chosen for another field too/)).toHaveLength(2)
    expect(apply).toBeDisabled()

    await userEvent.click(screen.getByRole('combobox', { name: 'Column for Unit type' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Tenant' }))
    await userEvent.click(apply)
    await waitFor(() =>
      expect(fakePreview.saveMapping).toHaveBeenCalledWith(NEXUS_ID, IMPORT_ID, { unitNumber: 'Shop No', floorAreaSqm: 'Size', unitType: 'Tenant' }),
    )
    expect(await screen.findByText('Column mapping applied')).toBeInTheDocument()
    // The preview is read again with the applied mapping.
    await waitFor(() => expect(fakePreview.preview.mock.calls.length).toBeGreaterThan(1))
  })

  it('says when the mapping is reused from the last file with the same headings', async () => {
    fakePreview.getMapping.mockResolvedValue({ ...mappingOf('saved', { unitNumber: 'Shop No' }), savedAt: '2026-11-18T10:00:00+02:00' })
    renderPreview()
    expect(await screen.findByText('Reused from the last file with these columns in this workspace.')).toBeInTheDocument()
    expect(screen.getByText(/Saved/)).toHaveTextContent('18 Nov 2026')
  })

  it('shows the mapping read-only to members who cannot import', async () => {
    viewer.writer = false
    renderPreview()
    const mapping = await screen.findByRole('list', { name: 'Column mapping' })
    expect(within(mapping).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(mapping).getByText('Shop No')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply mapping' })).not.toBeInTheDocument()
  })

  it('signs off a corrected row with who changed it, when, and the previous and new value', async () => {
    const corrected: PortfolioImportRowCheck = {
      ...ROWS[3]!,
      result: 'new',
      reasons: ['Adds the unit Shop 4 to Maponya Square'],
      values: { unitNumber: 'Shop 4', unitType: 'line_shop' },
      resolution: {
        corrections: [{ field: 'unitType', value: 'line_shop' }],
        skipped: false,
        tenantSuggestionsRejected: false,
        changedByUserId: MANAGER,
        changedAt: '2026-11-21T09:30:00+02:00',
      },
    }
    fakePreview.preview.mockResolvedValue({ importId: IMPORT_ID, counts: COUNTS, items: [corrected], total: 1, page: 1, pageSize: 25 })
    renderPreview()
    const changes = await screen.findByRole('list', { name: 'Changes to row 5' })
    expect(changes).toHaveTextContent('Unit type: corrected from empty to Line shop')
    const signOff = await screen.findByText('Naledi van der Merwe')
    expect(signOff.closest('[data-slot="sign-off"]')).toHaveTextContent('21 Nov 2026')
  })

  it('corrects a value of a row and shows it checked again', async () => {
    fakePreview.changeRow.mockResolvedValue({
      ...ROWS[3]!,
      result: 'new',
      reasons: ['Adds the unit Shop 4 to Maponya Square'],
      values: { unitNumber: 'Shop 4', unitType: 'Line shop' },
      resolution: { corrections: [{ field: 'unitType', value: 'Line shop' }], skipped: false, tenantSuggestionsRejected: false, changedByUserId: MANAGER, changedAt: '2026-11-21T09:30:00+02:00' },
    })
    renderPreview()
    await userEvent.click(await screen.findByRole('button', { name: 'Fix row 5' }))
    const drawer = await screen.findByRole('dialog', { name: 'Row 5' })
    expect(within(drawer).getByText('Unit type is missing')).toBeInTheDocument()
    await userEvent.type(within(drawer).getByLabelText('Unit type'), 'Line shop')
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save and check again' }))

    await waitFor(() => expect(fakePreview.changeRow).toHaveBeenCalledWith(NEXUS_ID, IMPORT_ID, 5, { corrections: { unitType: 'Line shop' } }))
    expect(await screen.findByText('Saved. Row 5 checked again: New')).toBeInTheDocument()
    expect(within(drawer).getByText('Adds the unit Shop 4 to Maponya Square')).toBeInTheDocument()
    // The whole preview is read again: other rows can change with this one.
    await waitFor(() => expect(fakePreview.preview.mock.calls.length).toBeGreaterThan(1))
  })

  it('links a row to an existing unit of the property, or skips it', async () => {
    fakePreview.changeRow.mockResolvedValue({ ...ROWS[1]!, result: 'skipped', reasons: ['Skipped: this row is left out of the import'] })
    renderPreview()
    await userEvent.click(await screen.findByRole('button', { name: 'Fix row 5' }))
    const drawer = await screen.findByRole('dialog', { name: 'Row 5' })
    await userEvent.click(within(drawer).getByRole('combobox', { name: 'Linked unit' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Shop 4' }))
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save and check again' }))
    await waitFor(() => expect(fakePreview.changeRow).toHaveBeenCalledWith(NEXUS_ID, IMPORT_ID, 5, { link: { unitId: UNIT_ID } }))
    expect(fakeUnits.list).toHaveBeenCalledWith(NEXUS_ID, expect.objectContaining({ propertyId: BATCH.propertyId }))

    await userEvent.click(within(drawer).getByRole('button', { name: 'Skip row' }))
    await waitFor(() => expect(fakePreview.changeRow).toHaveBeenLastCalledWith(NEXUS_ID, IMPORT_ID, 5, { skipped: true }))
  })

  it("shows a row's suggested tenants and records the manager's confirmation or rejection", async () => {
    const TENANT_ID = '3c1a9e2b-0000-4000-8000-000000000007'
    const suggested: PortfolioImportRowCheck = {
      rowNumber: 6,
      result: 'suggested',
      reasons: ['A tenant in LeaseGuard has a similar name but no registration number or account reference in common: confirm which tenant this is, or reject the suggestion'],
      values: { unitNumber: 'Shop 1', tenantTradingName: 'Ubuntu Coffee' },
      conflicts: [],
      tenant: {
        result: 'suggested',
        reasons: ['A tenant in LeaseGuard has a similar name but no registration number or account reference in common: confirm which tenant this is, or reject the suggestion'],
        name: 'Ubuntu Coffee',
        suggestions: [{ id: TENANT_ID, tradingName: 'Ubuntu Coffee Roasters', legalName: 'Ubuntu Coffee Roasters (Pty) Ltd', registrationNumber: '2019/987654/07' }],
        missingContactDetails: ['email'],
      },
    }
    fakePreview.preview.mockResolvedValue({ importId: IMPORT_ID, counts: { ...COUNTS, suggested: 1 }, items: [suggested], total: 1, page: 1, pageSize: 25 })
    fakePreview.changeRow.mockResolvedValue({
      ...suggested,
      result: 'match',
      reasons: ['Confirmed as Ubuntu Coffee Roasters in LeaseGuard: no tenant is created and its details are kept'],
      tenant: { ...suggested.tenant!, result: 'match', matchedBy: 'confirmed', tenant: { id: TENANT_ID, label: 'Ubuntu Coffee Roasters' }, reasons: ['Confirmed'] },
      resolution: {
        corrections: [],
        skipped: false,
        linkedTenant: { id: TENANT_ID, label: 'Ubuntu Coffee Roasters' },
        tenantSuggestionsRejected: false,
        changedByUserId: MANAGER,
        changedAt: '2026-11-21T09:30:00+02:00',
      },
    })
    renderPreview()
    const table = await screen.findByRole('table')
    expect(within(table).getAllByText('Suggested match').length).toBeGreaterThan(0)

    await userEvent.click(await screen.findByRole('button', { name: 'Fix row 6' }))
    const drawer = await screen.findByRole('dialog', { name: 'Row 6' })
    const suggestions = within(drawer).getByRole('list', { name: 'Suggested tenants' })
    expect(suggestions).toHaveTextContent('Ubuntu Coffee Roasters (Pty) Ltd · 2019/987654/07')
    expect(within(drawer).getByText('No email')).toBeInTheDocument()

    await userEvent.click(within(suggestions).getByRole('button', { name: 'Confirm Ubuntu Coffee Roasters' }))
    await waitFor(() =>
      expect(fakePreview.changeRow).toHaveBeenCalledWith(NEXUS_ID, IMPORT_ID, 6, { tenantMatch: { decision: 'confirmed', tenantId: TENANT_ID } }),
    )
    expect(await within(drawer).findByText('Confirmed as Ubuntu Coffee Roasters')).toBeInTheDocument()
    expect(within(drawer).getByLabelText('Tenant trading name')).toBeInTheDocument()

    fakePreview.changeRow.mockResolvedValue(suggested)
    await userEvent.click(within(drawer).getByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(fakePreview.changeRow).toHaveBeenLastCalledWith(NEXUS_ID, IMPORT_ID, 6, { tenantMatch: null }))
    await userEvent.click(await within(drawer).findByRole('button', { name: 'None of these: add a new tenant' }))
    await waitFor(() => expect(fakePreview.changeRow).toHaveBeenLastCalledWith(NEXUS_ID, IMPORT_ID, 6, { tenantMatch: { decision: 'rejected' } }))
  })

  it('offers no fixes to members who cannot import', async () => {
    viewer.writer = false
    renderPreview()
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: /^Fix row/ })).not.toBeInTheDocument()
  })
})
