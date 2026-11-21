import { LEASE_DOCUMENT_MAX_BYTES, LEASE_DOCUMENT_MIME_TYPES, LEASE_DOCUMENT_TYPES, type EntityId, type LeaseDocument } from '@leaseguard/domain'
import { AlertCircle, Upload } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { FileUpload, formatBytes, SelectField, TextField, zodResolver } from '@/components/forms'
import { DateDisplay, DocumentList, ErrorState, FormDialog, LoadingState, SectionHeader } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { describeApiError } from '@/lib/data/apiErrors'
import { enumOptions, labelFor } from '@/lib/labels'

import { useLeaseDocumentLink, useLeaseDocuments, useUploadLeaseDocument } from '../api/queries'

const ACCEPT = LEASE_DOCUMENT_MIME_TYPES.join(',')
const DOCUMENT_TYPE_OPTIONS = enumOptions(LEASE_DOCUMENT_TYPES)

const uploadSchema = z.object({
  documentType: z.enum(LEASE_DOCUMENT_TYPES, { error: 'Choose the document type' }),
  title: z.string().trim().min(1, 'Give the document a title').max(200),
})
type UploadValues = z.infer<typeof uploadSchema>

export interface LeaseDocumentsProps {
  leaseId: EntityId
  leaseReference: string
  /** Company admins and property managers upload; every member lists and opens. */
  canUpload: boolean
  /** The uploader's name for plain text, or why it is missing. */
  nameOf: (userId: EntityId) => string
}

/**
 * The documents recorded on one lease: type, uploader and date per document, each opened through a short-lived link, and
 * an upload for writers. Files live in protected storage; the API checks they are PDFs within the size limit.
 */
export function LeaseDocuments({ leaseId, leaseReference, canUpload, nameOf }: LeaseDocumentsProps) {
  const documents = useLeaseDocuments(leaseId)
  const link = useLeaseDocumentLink(leaseId)
  const [uploading, setUploading] = useState(false)

  async function open(document: LeaseDocument) {
    // Opened before the link is requested, so the browser treats it as the click's own window and does not block it.
    const tab = window.open('about:blank', '_blank')
    try {
      const url = await link.mutateAsync(document.id)
      if (tab) {
        tab.opener = null
        tab.location.href = url
      } else {
        window.location.assign(url)
      }
    } catch (error) {
      tab?.close()
      toast.error(`${document.title} could not be opened`, { description: describeApiError(error, 'Try again in a moment.') })
    }
  }

  return (
    <section aria-label="Documents" className="space-y-3">
      <SectionHeader
        title="Documents"
        description="The signed lease, renewals, guarantee, deposit receipt and FICA documents, kept as PDFs."
        actions={
          canUpload ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setUploading(true)}>
              <Upload aria-hidden="true" />
              Upload document
            </Button>
          ) : null
        }
      />
      {documents.isPending ? (
        <LoadingState label="Loading the documents…" rows={2} />
      ) : documents.isError ? (
        <ErrorState title="Could not load the documents" error={describeApiError(documents.error, 'Try again in a moment.')} onRetry={() => void documents.refetch()} />
      ) : (
        <DocumentList
          emptyLabel="No documents recorded on this lease"
          className="py-0"
          onOpen={(id) => {
            const document = documents.data.find((item) => item.id === id)
            if (document) void open(document)
          }}
          documents={documents.data.map((document) => ({
            id: document.id,
            title: document.title,
            file: document.file,
            meta: (
              <span className="tabular-nums">
                {labelFor(document.documentType)} · {nameOf(document.uploadedByUserId)} · <DateDisplay value={document.uploadedAt} />
              </span>
            ),
          }))}
        />
      )}
      {uploading ? <UploadLeaseDocumentDialog leaseId={leaseId} leaseReference={leaseReference} onClose={() => setUploading(false)} /> : null}
    </section>
  )
}

/** Mounted only while open, so every upload starts empty. */
function UploadLeaseDocumentDialog({ leaseId, leaseReference, onClose }: { leaseId: EntityId; leaseReference: string; onClose: () => void }) {
  const upload = useUploadLeaseDocument(leaseId)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | undefined>()
  const form = useForm<UploadValues>({ resolver: zodResolver(uploadSchema), defaultValues: { title: '' } })

  const submit = form.handleSubmit(async (values) => {
    if (!file) {
      setFileError('Choose a PDF')
      return
    }
    try {
      const document = await upload.mutateAsync({ file, documentType: values.documentType, title: values.title })
      toast.success(`${document.title} added to ${leaseReference}`)
      onClose()
    } catch (error) {
      const fallback = error instanceof Error && error.name === 'LeaseDocumentUploadError' ? error.message : 'The document could not be uploaded. Try again.'
      form.setError('root', { type: 'server', message: describeApiError(error, fallback) })
    }
  })

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`Upload a document to ${leaseReference}`}
      description={`PDF only, at most ${formatBytes(LEASE_DOCUMENT_MAX_BYTES)}. Your name and the time are recorded with it.`}
      submitLabel="Upload document"
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
    >
      <Form {...form}>
        {form.formState.errors.root?.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        ) : null}
        <FileUpload
          label="File"
          accept={ACCEPT}
          maxSizeBytes={LEASE_DOCUMENT_MAX_BYTES}
          onFilesSelected={(files) => {
            const chosen = files[0] ?? null
            setFile(chosen)
            setFileError(undefined)
            if (chosen && !form.getValues('title')) form.setValue('title', chosen.name.replace(/\.[^.]+$/, ''))
          }}
          {...(fileError ? { error: fileError } : {})}
        />
        {file ? (
          <p className="text-sm text-muted-foreground tabular-nums">
            {file.name} ({formatBytes(file.size)})
          </p>
        ) : null}
        <SelectField control={form.control} name="documentType" label="Document type" options={DOCUMENT_TYPE_OPTIONS} required />
        <TextField control={form.control} name="title" label="Title" required maxLength={200} />
      </Form>
    </FormDialog>
  )
}
