import { ApiError } from '@leaseguard/api-client'
import type { PortfolioImport, Property } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import type { CompanyMember } from '@/features/users/api/source'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { PortfolioImportSource } from '../api/source'
import { templateBlob } from '../templateDownload'
import { PortfolioImportScreen } from './PortfolioImportScreen'

const fakeImports = vi.hoisted(() => ({
  list: vi.fn<PortfolioImportSource['list']>(),
  upload: vi.fn<PortfolioImportSource['upload']>(),
  get: vi.fn<PortfolioImportSource['get']>(),
  selectSheet: vi.fn<PortfolioImportSource['selectSheet']>(),
}))
const fakeProperties = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn() }))
const members = vi.hoisted(() => vi.fn())
vi.mock('../api/selectSource', () => ({ getPortfolioImportSource: () => fakeImports }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => ({ listMembers: members }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))

const viewer = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({
  useIsCompanyWriter: () => viewer.writer,
  useCurrentUserId: () => '7d9f3c2a-0000-5000-8000-000000000001',
}))

const MANAGER = '5b0c1d2e-0000-4000-8000-0000000000a2'
const IMPORT_ID = '6f1d2c1e-0000-4000-8000-0000000000c1'
const PROPERTY: Property = { ...sampleRecord('properties'), id: 'f922b1e8-d0cd-5a20-8393-829bec4dbc49', companyId: NEXUS_ID, name: 'Maponya Square', status: 'active' }

const CSV_BATCH: PortfolioImport = {
  id: IMPORT_ID,
  companyId: NEXUS_ID,
  scope: 'properties',
  fileName: 'Rent roll.csv',
  fileFormat: 'csv',
  sizeBytes: 2048,
  sheetNames: [],
  delimiter: ';',
  columns: ['Property code', 'Property name', 'Unit number'],
  rowCount: 1250,
  uploadedByUserId: MANAGER,
  uploadedAt: '2026-11-20T08:00:00+02:00',
  createdAt: '2026-11-20T08:00:00+02:00',
  updatedAt: '2026-11-20T08:00:00+02:00',
}
const XLSX_BATCH: PortfolioImport = {
  ...CSV_BATCH,
  scope: 'units',
  propertyId: PROPERTY.id,
  fileName: 'units.xlsx',
  fileFormat: 'xlsx',
  sheetName: 'Units',
  sheetNames: ['Units', 'Parking'],
  columns: ['Unit number', 'Floor area (m²)'],
  rowCount: 2,
}
const { delimiter: _unused, ...XLSX_WITHOUT_DELIMITER } = XLSX_BATCH
void _unused

const member = { id: MANAGER, fullName: 'Naledi van der Merwe', status: 'active', memberships: [] } as unknown as CompanyMember

function renderScreen(props: { importId?: string; propertyId?: string } = {}) {
  const onImported = vi.fn<(batch: PortfolioImport) => void>()
  const result = renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <PortfolioImportScreen {...props} onImported={onImported} />
      <Toaster />
    </QueryClientProvider>,
    '/properties/import',
  )
  return { result, onImported }
}

const chooseFile = (file: File) => userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file)

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = true
  for (const fn of [...Object.values(fakeImports), ...Object.values(fakeProperties), members]) fn.mockReset()
  fakeImports.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })
  members.mockResolvedValue({ items: [member], total: 1, page: 1, pageSize: 100 })
  fakeProperties.get.mockResolvedValue(PROPERTY)
})

describe('PortfolioImportScreen: upload', () => {
  it('uploads a CSV file for properties and their units and hands the accepted batch on', async () => {
    fakeImports.upload.mockResolvedValue(CSV_BATCH)
    const { onImported } = renderScreen()
    expect(await screen.findByText('Add properties and their units from a CSV or Excel file exported from your own system.')).toBeInTheDocument()

    const file = new File(['Property code;Property name\nMSQ;Maponya Square\n'], 'Rent roll.csv', { type: 'text/csv' })
    await chooseFile(file)
    expect(screen.getByText('Rent roll.csv')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Upload file' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(CSV_BATCH))
    expect(fakeImports.upload).toHaveBeenCalledWith(NEXUS_ID, { file, scope: 'properties' })
    expect(await screen.findByText('Rent roll.csv accepted: 1 250 rows')).toBeInTheDocument()
  })

  it('uploads an XLSX file of units for a property', async () => {
    fakeImports.upload.mockResolvedValue(XLSX_BATCH)
    const { onImported } = renderScreen({ propertyId: PROPERTY.id })
    expect(await screen.findByText('Add units to Maponya Square from a CSV or Excel file exported from your own system.')).toBeInTheDocument()
    // The units template lists only the unit columns, then the optional tenant columns.
    const columns = within(screen.getByRole('region', { name: 'Template' })).getAllByRole('listitem').map((item) => item.textContent)
    expect(columns.slice(0, 5)).toEqual(['Unit number', 'Unit type', 'Floor area (m²)', 'Unit status', 'Tenant trading name'])
    expect(columns).not.toContain('Property code')

    const file = new File(['PK'], 'units.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await chooseFile(file)
    await userEvent.click(screen.getByRole('button', { name: 'Upload file' }))
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(XLSX_BATCH))
    expect(fakeImports.upload).toHaveBeenCalledWith(NEXUS_ID, { file, scope: 'units', propertyId: PROPERTY.id })
  })

  it('shows why an empty file was refused, and asks for a file before uploading', async () => {
    fakeImports.upload.mockRejectedValue(new ApiError(422, ['The file is empty. Check that you chose the right file, or the right sheet.'], 'req-1'))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Upload file' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a CSV or Excel (.xlsx) file to upload.')
    expect(fakeImports.upload).not.toHaveBeenCalled()

    await chooseFile(new File([''], 'empty.csv', { type: 'text/csv' }))
    await userEvent.click(screen.getByRole('button', { name: 'Upload file' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is empty. Check that you chose the right file, or the right sheet.')
  })

  it('refuses an oversized file before sending it, and shows the API refusal of one', async () => {
    renderScreen()
    await screen.findByRole('button', { name: 'Upload file' })
    const big = new File(['x'], 'big.csv', { type: 'text/csv' })
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 })
    await chooseFile(big)
    expect(await screen.findByText(/big\.csv/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('big.csv: File is 6 MB; the limit is 5 MB.')
    await userEvent.click(screen.getByRole('button', { name: 'Upload file' }))
    expect(fakeImports.upload).not.toHaveBeenCalled()

    fakeImports.upload.mockRejectedValue(new ApiError(413, ['The file is larger than the 5 MB limit for portfolio files'], 'req-2'))
    await chooseFile(new File(['Code\nMSQ\n'], 'ok.csv', { type: 'text/csv' }))
    await userEvent.click(screen.getByRole('button', { name: 'Upload file' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is larger than the 5 MB limit for portfolio files')
  })

  it('offers no upload to members who only read or own properties', async () => {
    viewer.writer = false
    renderScreen()
    expect(await screen.findByText('Only company admins and property managers import files')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload file' })).not.toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('does not import units into an archived property', async () => {
    fakeProperties.get.mockResolvedValue({ ...PROPERTY, status: 'archived' })
    renderScreen({ propertyId: PROPERTY.id })
    expect(await screen.findByText('This property is archived')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload file' })).not.toBeInTheDocument()
  })
})

describe('PortfolioImportScreen: accepted batch', () => {
  it('shows the file, its format, row count, the columns found and who uploaded it', async () => {
    fakeImports.get.mockResolvedValue(CSV_BATCH)
    renderScreen({ importId: IMPORT_ID })
    expect(await screen.findByText('File accepted')).toBeInTheDocument()
    expect(screen.getByText('CSV, semicolon separated')).toBeInTheDocument()
    expect(screen.getByText('1 250')).toBeInTheDocument()
    const columns = within(screen.getByRole('list', { name: 'Columns found' })).getAllByRole('listitem').map((item) => item.textContent)
    expect(columns).toEqual(['Property code', 'Property name', 'Unit number'])
    expect(await screen.findByText('Naledi van der Merwe')).toBeInTheDocument()
    expect(screen.getByText(/Nothing has been added to properties or units/)).toBeInTheDocument()
  })

  it('lets a writer read a workbook from another sheet', async () => {
    fakeImports.get.mockResolvedValue(XLSX_WITHOUT_DELIMITER)
    fakeImports.selectSheet.mockResolvedValue({ ...XLSX_WITHOUT_DELIMITER, sheetName: 'Parking', columns: ['Bay'], rowCount: 1 })
    renderScreen({ importId: IMPORT_ID })
    expect(await screen.findByText('Excel workbook (.xlsx)')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Maponya Square' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox', { name: 'Sheet' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Parking' }))
    await waitFor(() => expect(fakeImports.selectSheet).toHaveBeenCalledWith(NEXUS_ID, IMPORT_ID, 'Parking'))
    expect(await screen.findByText('Now reading the sheet Parking: 1 row')).toBeInTheDocument()
  })

  it('shows the sheet without a choice to members who only read', async () => {
    viewer.writer = false
    fakeImports.get.mockResolvedValue(XLSX_WITHOUT_DELIMITER)
    renderScreen({ importId: IMPORT_ID })
    expect(await screen.findByText('Units')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Sheet' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Import another file' })).not.toBeInTheDocument()
  })

  it('says when the batch is not in this workspace', async () => {
    fakeImports.get.mockResolvedValue(null)
    renderScreen({ importId: IMPORT_ID })
    expect(await screen.findByText('Import not found in this workspace')).toBeInTheDocument()
  })
})

describe('portfolio template', () => {
  it('downloads every supported column with one example row, readable by Excel', async () => {
    const bytes = new Uint8Array(await templateBlob('properties').arrayBuffer())
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const [header, example] = new TextDecoder().decode(bytes).split('\r\n')
    expect(header?.split(',')).toHaveLength(22)
    expect(example).toMatch(/^MSQ,Market Square,Shop/)
  })
})

describe('PortfolioImportScreen: import history', () => {
  it('lists earlier imports so a batch left with rows to fix can be opened again', async () => {
    fakeImports.list.mockResolvedValue({ items: [CSV_BATCH], total: 1, page: 1, pageSize: 10 })
    renderScreen()
    const history = await screen.findByRole('region', { name: 'Earlier imports' })
    const link = await within(history).findByRole('link', { name: CSV_BATCH.fileName })
    expect(link).toHaveAttribute('href', `/properties/import?importId=${CSV_BATCH.id}`)
    expect(await within(history).findByText('Naledi van der Merwe')).toBeInTheDocument()
    expect(fakeImports.list).toHaveBeenCalledWith(NEXUS_ID, { page: 1, pageSize: 10, scope: 'properties' })
  })
})
