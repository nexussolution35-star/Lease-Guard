import { ApiError } from '@leaseguard/api-client'
import type { Statement } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createTestQueryClient } from '@/test/queryClient'

import type { StatementSource } from '../api/source'
import { StatementUploadScreen } from './StatementUploadScreen'

const PROPERTY_ID = 'a1b2c3d4-0000-5000-8000-0000000000aa'
const ON_RECORD_ID = 'a1b2c3d4-0000-5000-8000-0000000000ee'

const fakeSource = vi.hoisted(() => ({
  list: vi.fn<StatementSource['list']>(),
  get: vi.fn<StatementSource['get']>(),
  retryProcessing: vi.fn<StatementSource['retryProcessing']>(),
  upload: vi.fn<StatementSource['upload']>(),
}))
vi.mock('../api/selectSource', () => ({ getStatementSource: () => fakeSource }))
vi.mock('@/services/api/client', () => ({ getApiClient: () => ({}) }))
vi.mock('@/features/properties/api/selectSource', () => ({
  getPropertySource: () => ({
    list: async () => ({
      items: [
        { ...sampleRecord('properties'), id: PROPERTY_ID, name: 'Acacia Park', status: 'active', accountingSystem: 'Sage' },
        { ...sampleRecord('properties'), id: 'a1b2c3d4-0000-5000-8000-0000000000ab', name: 'Old Mill', status: 'archived' },
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    }),
  }),
}))
const viewer = vi.hoisted(() => ({ writer: true }))
vi.mock('@/features/account/useActiveRole', () => ({ useIsCompanyWriter: () => viewer.writer }))

const pdf = (name: string, body = name) => new File([`%PDF-1.7 ${body}`], name, { type: 'application/pdf' })

async function renderScreen() {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <StatementUploadScreen />
    </QueryClientProvider>,
    '/statements/upload',
  )
}

async function chooseProperty() {
  await userEvent.click(await screen.findByRole('combobox', { name: 'Property' }))
  expect(screen.queryByRole('option', { name: 'Old Mill' })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole('option', { name: 'Acacia Park' }))
}

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  viewer.writer = true
  for (const fn of Object.values(fakeSource)) fn.mockReset()
})

describe('StatementUploadScreen', () => {
  it('preselects the property accounting system and uploads every file as one batch, each with its own outcome', async () => {
    fakeSource.upload.mockImplementation(async (_companyId, { file }) => {
      if (file.name === 'broken.pdf') throw new ApiError(422, ['The uploaded file size does not match sizeBytes'], null)
      if (file.name === 'known.pdf') return { outcome: 'identical', existingStatementId: ON_RECORD_ID, message: 'Identical file' }
      return { outcome: 'registered', statement: { ...sampleRecord('statements'), id: `${file.name}-id` } as Statement, processingQueued: true, likelyDuplicate: null }
    })
    await renderScreen()
    await chooseProperty()
    expect(screen.getByRole('combobox', { name: 'Source system' })).toHaveTextContent('Sage')

    await userEvent.upload(screen.getByLabelText('Statement PDFs', { selector: 'input' }), [pdf('oct.pdf', 'same'), pdf('known.pdf'), pdf('broken.pdf'), pdf('oct copy.pdf', 'same')])
    await userEvent.click(screen.getByRole('button', { name: 'Upload 4 statements' }))

    const files = await screen.findByRole('list', { name: 'Chosen files' })
    expect(await screen.findByRole('link', { name: 'Follow this upload on the list' })).toHaveAttribute('href', expect.stringContaining('uploadBatchId='))
    const row = (name: string) => within(files).getByText(name).closest('li') as HTMLElement
    expect(row('oct.pdf')).toHaveTextContent('Queued for processing')
    expect(within(row('known.pdf')).getByRole('link', { name: 'Open the statement on record' })).toHaveAttribute('href', `/statements/${ON_RECORD_ID}`)
    expect(row('broken.pdf')).toHaveTextContent('Failed')
    expect(row('broken.pdf')).toHaveTextContent('The uploaded file size does not match sizeBytes')
    expect(row('oct copy.pdf')).toHaveTextContent('Repeated in this upload')
    expect(within(row('oct copy.pdf')).getByRole('link', { name: 'Open the statement' })).toHaveAttribute('href', '/statements/oct.pdf-id')
    expect(screen.getByText('1 registered · 2 duplicates · 1 failed')).toBeInTheDocument()

    expect(fakeSource.upload).toHaveBeenCalledTimes(3)
    const batchIds = new Set(fakeSource.upload.mock.calls.map(([, input]) => input.uploadBatchId))
    expect(batchIds.size).toBe(1)
    expect(fakeSource.upload.mock.calls[0]?.[1]).toMatchObject({ propertyId: PROPERTY_ID, sourceSystem: 'Sage' })
  })

  it('asks for the property before uploading, and refuses a file that is not a PDF before it is sent', async () => {
    await renderScreen()
    await userEvent.upload(await screen.findByLabelText('Statement PDFs', { selector: 'input' }), [pdf('oct.pdf')])
    await userEvent.click(screen.getByRole('button', { name: 'Upload statement' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the property the statements belong to.')

    // A file named .pdf that is not a PDF passes the picker but is refused by its content.
    await userEvent.upload(screen.getByLabelText('Statement PDFs', { selector: 'input' }), [new File(['PK\u0003\u0004'], 'sheet.pdf', { type: 'application/pdf' })])
    await chooseProperty()
    await userEvent.click(screen.getByRole('button', { name: 'Upload 2 statements' }))
    expect(await screen.findByText(/The file is not a PDF/)).toBeInTheDocument()
    expect(fakeSource.upload).toHaveBeenCalledTimes(1)
  })

  it('resolves a failed file: Try again sends it again in the same batch, Remove takes it out', async () => {
    fakeSource.upload
      .mockRejectedValueOnce(new ApiError(422, ['The storage object for this statement was not found'], null))
      .mockRejectedValueOnce(new ApiError(422, ['The uploaded file size does not match sizeBytes'], null))
      .mockResolvedValueOnce({ outcome: 'registered', statement: { ...sampleRecord('statements'), id: 'retried-id' } as Statement, processingQueued: true, likelyDuplicate: null })
    await renderScreen()
    await chooseProperty()
    await userEvent.upload(screen.getByLabelText('Statement PDFs', { selector: 'input' }), [pdf('april.pdf'), pdf('may.pdf')])
    await userEvent.click(screen.getByRole('button', { name: 'Upload 2 statements' }))

    const files = await screen.findByRole('list', { name: 'Chosen files' })
    const row = (name: string) => within(files).getByText(name).closest('li') as HTMLElement
    expect(await within(row('april.pdf')).findByText(/The storage object for this statement was not found/)).toBeInTheDocument()
    expect(row('may.pdf')).toHaveTextContent('The uploaded file size does not match sizeBytes')

    await userEvent.click(within(row('april.pdf')).getByRole('button', { name: 'Try again april.pdf' }))
    expect(await within(row('april.pdf')).findByText('Queued for processing')).toBeInTheDocument()
    expect(within(row('april.pdf')).queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument()
    const batchIds = new Set(fakeSource.upload.mock.calls.map(([, input]) => input.uploadBatchId))
    expect(batchIds.size).toBe(1)

    await userEvent.click(within(row('may.pdf')).getByRole('button', { name: 'Remove may.pdf' }))
    expect(within(files).queryByText('may.pdf')).not.toBeInTheDocument()
  })

  it('is read-only for members who cannot write', async () => {
    viewer.writer = false
    await renderScreen()
    expect(await screen.findByText('Only company admins and property managers upload statements')).toBeInTheDocument()
    expect(screen.queryByLabelText('Statement PDFs', { selector: 'input' })).not.toBeInTheDocument()
  })
})
