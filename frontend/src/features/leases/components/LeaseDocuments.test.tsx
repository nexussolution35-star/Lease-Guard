import { ApiError } from '@leaseguard/api-client'
import type { LeaseDocument } from '@leaseguard/domain'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithRouter } from '@/components/layout/testRouter'
import { Toaster } from '@/components/ui/sonner'
import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { createTestQueryClient } from '@/test/queryClient'

import type { LeaseSource } from '../api/source'
import { LeaseDocuments } from './LeaseDocuments'

const fakeLeases = vi.hoisted(() => ({
  listDocuments: vi.fn<LeaseSource['listDocuments']>(),
  uploadDocument: vi.fn<LeaseSource['uploadDocument']>(),
  documentDownloadUrl: vi.fn<LeaseSource['documentDownloadUrl']>(),
}))
vi.mock('../api/selectSource', () => ({ getLeaseSource: () => fakeLeases }))

const LEASE_ID = 'f922b1e8-d0cd-5a20-8393-829bec4dbc49'
const MANAGER = '5b0c1d2e-0000-4000-8000-0000000000a2'

const document: LeaseDocument = {
  id: 'd0000000-0000-4000-8000-000000000001',
  companyId: NEXUS_ID,
  leaseId: LEASE_ID,
  documentType: 'signed_lease',
  title: 'Signed lease 2025',
  file: { fileName: 'signed.pdf', storagePath: `${NEXUS_ID}/d0000000-0000-4000-8000-000000000001/signed.pdf`, mimeType: 'application/pdf', sizeBytes: 2048, sha256: 'a'.repeat(64) },
  uploadedByUserId: MANAGER,
  uploadedAt: '2026-03-02T09:15:00+02:00',
  createdAt: '2026-03-02T09:15:00+02:00',
  updatedAt: '2026-03-02T09:15:00+02:00',
}

function renderDocuments(canUpload = true) {
  return renderWithRouter(
    <QueryClientProvider client={createTestQueryClient()}>
      <LeaseDocuments leaseId={LEASE_ID} leaseReference="MSQ-L001" canUpload={canUpload} nameOf={() => 'Naledi van der Merwe'} />
      <Toaster />
    </QueryClientProvider>,
    `/leases/${LEASE_ID}`,
  )
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  for (const fn of Object.values(fakeLeases)) fn.mockReset()
  fakeLeases.listDocuments.mockResolvedValue([document])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LeaseDocuments', () => {
  it('lists each document with its type and uploader', async () => {
    await renderDocuments()
    const region = screen.getByRole('region', { name: 'Documents' })
    expect(await within(region).findByText('Signed lease 2025')).toBeInTheDocument()
    expect(within(region).getByText(/Signed lease · Naledi van der Merwe/)).toBeInTheDocument()
    expect(fakeLeases.listDocuments).toHaveBeenCalledWith(NEXUS_ID, LEASE_ID)
  })

  it('uploads a PDF with its type and title, then lists the documents again', async () => {
    fakeLeases.uploadDocument.mockResolvedValue({ ...document, id: 'd0000000-0000-4000-8000-000000000002', documentType: 'fica', title: 'FICA pack' })
    await renderDocuments()
    await screen.findByText('Signed lease 2025')

    await userEvent.click(screen.getByRole('button', { name: 'Upload document' }))
    const dialog = await screen.findByRole('dialog', { name: 'Upload a document to MSQ-L001' })
    expect(within(dialog).getByText(/PDF only, at most 20/)).toBeInTheDocument()
    const file = new File(['%PDF-1.7'], 'FICA pack.pdf', { type: 'application/pdf' })
    await userEvent.upload(within(dialog).getByLabelText('File', { selector: 'input' }), file)
    expect(within(dialog).getByLabelText(/Title/)).toHaveValue('FICA pack')
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Document type/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'FICA documents' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload document' }))

    await vi.waitFor(() =>
      expect(fakeLeases.uploadDocument).toHaveBeenCalledWith(NEXUS_ID, LEASE_ID, { file, documentType: 'fica', title: 'FICA pack' }),
    )
    expect(await screen.findByText('FICA pack added to MSQ-L001')).toBeInTheDocument()
    await vi.waitFor(() => expect(fakeLeases.listDocuments).toHaveBeenCalledTimes(2))
  })

  it('asks for the document type and refuses a file that is not a PDF before uploading', async () => {
    await renderDocuments()
    await userEvent.click(screen.getByRole('button', { name: 'Upload document' }))
    const dialog = await screen.findByRole('dialog', { name: 'Upload a document to MSQ-L001' })
    const notPdf = new File(['PK'], 'lease.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    await userEvent.upload(within(dialog).getByLabelText('File', { selector: 'input' }), notPdf, { applyAccept: false })
    expect(await within(dialog).findByText('lease.docx')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload document' }))
    expect(await within(dialog).findByText('Choose the document type')).toBeInTheDocument()
    expect(fakeLeases.uploadDocument).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and explains a refused upload', async () => {
    fakeLeases.uploadDocument.mockRejectedValue(new ApiError(422, ['The uploaded file is not a PDF'], null))
    await renderDocuments()
    await userEvent.click(screen.getByRole('button', { name: 'Upload document' }))
    const dialog = await screen.findByRole('dialog', { name: 'Upload a document to MSQ-L001' })
    await userEvent.upload(within(dialog).getByLabelText('File', { selector: 'input' }), new File(['x'], 'fake.pdf', { type: 'application/pdf' }))
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Document type/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'Signed lease' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload document' }))
    expect(await within(dialog).findByText('The uploaded file is not a PDF.')).toBeInTheDocument()
  })

  it('offers no upload to members who only read, but opens documents through a short-lived link', async () => {
    const tab = { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    fakeLeases.documentDownloadUrl.mockResolvedValue('http://storage/object/sign/signed.pdf?token=d')
    await renderDocuments(false)
    await screen.findByText('Signed lease 2025')
    expect(screen.queryByRole('button', { name: 'Upload document' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open signed.pdf' }))

    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    await vi.waitFor(() => expect(tab.location.href).toBe('http://storage/object/sign/signed.pdf?token=d'))
    expect(tab.opener).toBeNull()
    expect(fakeLeases.documentDownloadUrl).toHaveBeenCalledWith(NEXUS_ID, LEASE_ID, document.id)
  })
})
