import { ApiError } from '@leaseguard/api-client'
import type { PortfolioImport, Property } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { PortfolioImportSource } from '../api/source'
import { PortfolioImportScreen } from './PortfolioImportScreen'

const fakeImports = vi.hoisted(() => ({
  list: vi.fn<PortfolioImportSource['list']>(),
  upload: vi.fn<PortfolioImportSource['upload']>(),
  importGoogleSheet: vi.fn<PortfolioImportSource['importGoogleSheet']>(),
  get: vi.fn<PortfolioImportSource['get']>(),
  selectSheet: vi.fn<PortfolioImportSource['selectSheet']>(),
}))
const fakeProperties = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn() }))
const members = vi.hoisted(() => vi.fn())
vi.mock('../api/selectSource', () => ({ getPortfolioImportSource: () => fakeImports }))
vi.mock('@/features/properties/api/selectSource', () => ({ getPropertySource: () => fakeProperties }))
vi.mock('@/features/users/api/apiSource', () => ({ createApiUserSource: () => ({ listMembers: members }) }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))
vi.mock('@/features/account/useActiveRole', () => ({
  useIsCompanyWriter: () => true,
  useCurrentUserId: () => '7d9f3c2a-0000-5000-8000-000000000001',
}))

const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
const LINK = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=7`
const PROPERTY: Property = { ...sampleRecord('properties'), id: 'f922b1e8-d0cd-5a20-8393-829bec4dbc49', companyId: NEXUS_ID, name: 'Maponya Square', status: 'active' }
const SHEET_BATCH: PortfolioImport = {
  id: '6f1d2c1e-0000-4000-8000-0000000000c1',
  companyId: NEXUS_ID,
  scope: 'properties',
  fileName: 'Rent roll - Units.csv',
  fileFormat: 'csv',
  sizeBytes: 2048,
  sheetNames: [],
  delimiter: ',',
  googleSheet: { spreadsheetId: SHEET_ID, gid: '7' },
  columns: ['Property code', 'Property name'],
  rowCount: 12,
  uploadedAt: '2026-11-20T08:00:00+02:00',
  createdAt: '2026-11-20T08:00:00+02:00',
  updatedAt: '2026-11-20T08:00:00+02:00',
}

function renderScreen(props: { importId?: string; propertyId?: string } = {}) {
  const onImported = vi.fn<(batch: PortfolioImport) => void>()
  renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <PortfolioImportScreen {...props} onImported={onImported} />
      <Toaster />
    </QueryClientProvider>,
    '/properties/import',
  )
  return { onImported }
}

const linkInput = () => screen.findByLabelText('Google Sheets link')

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  for (const fn of [...Object.values(fakeImports), ...Object.values(fakeProperties), members]) fn.mockReset()
  fakeImports.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })
  members.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 })
  fakeProperties.get.mockResolvedValue(PROPERTY)
})

describe('PortfolioImportScreen: Google Sheets link', () => {
  it('reads the sheet in a pasted link and hands the batch on', async () => {
    fakeImports.importGoogleSheet.mockResolvedValue(SHEET_BATCH)
    const { onImported } = renderScreen()
    await userEvent.type(await linkInput(), LINK)
    await userEvent.click(screen.getByRole('button', { name: 'Read sheet' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(SHEET_BATCH))
    expect(fakeImports.importGoogleSheet).toHaveBeenCalledWith(NEXUS_ID, { url: LINK, scope: 'properties' })
    expect(await screen.findByText('Rent roll - Units.csv accepted: 12 rows')).toBeInTheDocument()
  })

  it('reads units for a property', async () => {
    fakeImports.importGoogleSheet.mockResolvedValue({ ...SHEET_BATCH, scope: 'units', propertyId: PROPERTY.id })
    renderScreen({ propertyId: PROPERTY.id })
    await userEvent.type(await linkInput(), LINK)
    await userEvent.click(screen.getByRole('button', { name: 'Read sheet' }))
    await waitFor(() => expect(fakeImports.importGoogleSheet).toHaveBeenCalledWith(NEXUS_ID, { url: LINK, scope: 'units', propertyId: PROPERTY.id }))
  })

  it('refuses a link that is not a Google Sheets link without sending it', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Read sheet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Paste the link of the Google Sheet.')
    await userEvent.type(await linkInput(), 'https://example.com/rent-roll.csv')
    await userEvent.click(screen.getByRole('button', { name: 'Read sheet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not a Google Sheets link.')
    expect(fakeImports.importGoogleSheet).not.toHaveBeenCalled()
  })

  it('says how to share a private sheet, and why an oversized one was refused', async () => {
    const share = 'LeaseGuard cannot open this sheet: it is not shared with "Anyone with the link". In Google Sheets choose Share.'
    fakeImports.importGoogleSheet.mockRejectedValueOnce(new ApiError(422, [share], 'req-1'))
    renderScreen()
    await userEvent.type(await linkInput(), LINK)
    await userEvent.click(screen.getByRole('button', { name: 'Read sheet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(share)

    fakeImports.importGoogleSheet.mockRejectedValueOnce(new ApiError(413, ['The sheet is larger than the 5 MB limit for portfolio files.'], 'req-2'))
    await userEvent.click(screen.getByRole('button', { name: 'Read sheet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The sheet is larger than the 5 MB limit for portfolio files.')
  })

  it('shows where a batch read from a Google Sheet came from', async () => {
    fakeImports.get.mockResolvedValue(SHEET_BATCH)
    renderScreen({ importId: SHEET_BATCH.id })
    const link = await screen.findByRole('link', { name: 'Google Sheet' })
    expect(link).toHaveAttribute('href', `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=7`)
    expect(screen.getByText(/A copy of the sheet as LeaseGuard read it is kept with this import/)).toBeInTheDocument()
  })
})
