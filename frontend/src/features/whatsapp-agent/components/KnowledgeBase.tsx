import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { AlertCircle, BookOpen, ExternalLink, FileText, HelpCircle, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { KNOWLEDGE_DOCUMENT_MAX_BYTES, KNOWLEDGE_DOCUMENT_MIME_TYPES, type EntityId, type KnowledgeDocumentMimeType, type KnowledgeReview } from '@leaseguard/domain'
import { toast } from 'sonner'
import { z } from 'zod'

import { FileUpload, formatBytes, TextAreaField, TextField, zodResolver } from '@/components/forms'
import { ConfirmationDialog, DateDisplay, EmptyState, ErrorState, FormDialog, LoadingState, StatusBadge } from '@/components/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { describeApiError } from '@/lib/data/apiErrors'

import {
  useDeleteKnowledge,
  useKnowledgeDocumentLink,
  useKnowledgeDocuments,
  useKnowledgeEntries,
  useKnowledgeFaqs,
  useReviewKnowledge,
  useSaveKnowledgeText,
  useUploadKnowledgeDocument,
} from '../api/queries'
import type { KnowledgeKind, KnowledgeTextKind } from '../api/source'

const TEXT_KINDS: Readonly<
  Record<KnowledgeTextKind, { noun: string; titleLabel: string; bodyLabel: string; titleMax: number; bodyMax: number; empty: string }>
> = {
  faq: { noun: 'FAQ', titleLabel: 'Question', bodyLabel: 'Answer', titleMax: 500, bodyMax: 4000, empty: 'No FAQs yet' },
  entry: { noun: 'knowledge entry', titleLabel: 'Title', bodyLabel: 'Text', titleMax: 200, bodyMax: 10000, empty: 'No knowledge entries yet' },
}

const ACCEPT = KNOWLEDGE_DOCUMENT_MIME_TYPES.join(',')

/** Draft or approved, and who approved it. */
function ReviewStatus({ item }: { item: KnowledgeReview }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <StatusBadge status={item.status} label={item.status === 'approved' ? 'Approved' : 'Draft'} />
      {item.status === 'approved' && item.approvedAt ? (
        <span>
          Approved{item.approvedByName ? ` by ${item.approvedByName}` : ''} on <DateDisplay value={item.approvedAt} />
        </span>
      ) : (
        <span>Not available to the agent until approved</span>
      )}
    </div>
  )
}

/** Approve or withdraw, and delete (company admins). */
function ReviewActions({ kind, id, status, label }: { kind: KnowledgeKind; id: EntityId; status: KnowledgeReview['status']; label: string }) {
  const review = useReviewKnowledge()
  const remove = useDeleteKnowledge()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const act = async (action: 'approve' | 'withdraw') => {
    try {
      await review.mutateAsync({ kind, id, action })
      toast.success(action === 'approve' ? `Approved: ${label}` : `Returned to draft: ${label}`)
    } catch (error) {
      toast.error(describeApiError(error, 'That did not work. Try again.'))
    }
  }

  return (
    <>
      {status === 'draft' ? (
        <Button type="button" size="sm" onClick={() => void act('approve')} disabled={review.isPending} aria-label={`Approve ${label}`}>
          Approve
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => void act('withdraw')} disabled={review.isPending} aria-label={`Return ${label} to draft`}>
          Return to draft
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${label}`}>
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this item?"
        description={`${label} is removed from the knowledge base and the agent stops using it.`}
        confirmLabel="Delete"
        destructive
        isPending={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync({ kind, id })
            toast.success(`Deleted: ${label}`)
            setConfirmDelete(false)
          } catch (error) {
            toast.error(describeApiError(error, 'It could not be deleted. Try again.'))
          }
        }}
      />
    </>
  )
}

const textSchema = (kind: KnowledgeTextKind) =>
  z.object({
    title: z.string().trim().min(1, `Write the ${TEXT_KINDS[kind].titleLabel.toLowerCase()}`).max(TEXT_KINDS[kind].titleMax),
    body: z.string().trim().min(1, `Write the ${TEXT_KINDS[kind].bodyLabel.toLowerCase()}`).max(TEXT_KINDS[kind].bodyMax),
  })
type TextValues = { title: string; body: string }

/** Add or change an FAQ or entry (a change to an approved one makes it a draft again). */
function TextDialog({
  kind,
  open,
  onOpenChange,
  editing,
}: {
  kind: KnowledgeTextKind
  open: boolean
  onOpenChange: (open: boolean) => void
  editing?: { id: EntityId; values: TextValues; approved: boolean }
}) {
  const meta = TEXT_KINDS[kind]
  const save = useSaveKnowledgeText()
  const form = useForm<TextValues>({ resolver: zodResolver(textSchema(kind)), defaultValues: editing?.values ?? { title: '', body: '' } })
  const { reset } = form
  useEffect(() => {
    if (open) reset(editing?.values ?? { title: '', body: '' })
  }, [open, editing, reset])

  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ kind, ...(editing ? { id: editing.id } : {}), input: values })
      toast.success(editing ? `Saved as a draft: approve it again for the agent to use it` : `Added as a draft`)
      onOpenChange(false)
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, 'It could not be saved. Try again.') })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${meta.noun}` : `Add ${meta.noun}`}
      description={
        editing?.approved
          ? 'Changing it returns it to draft: the agent stops using it until a company admin approves it again.'
          : 'New items start as drafts. The agent only uses approved items.'
      }
      submitLabel={editing ? 'Save as draft' : 'Add as draft'}
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
      size="lg"
    >
      <Form {...form}>
        {form.formState.errors.root?.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
          </Alert>
        ) : null}
        <TextField control={form.control} name="title" label={meta.titleLabel} required maxLength={meta.titleMax} />
        <TextAreaField control={form.control} name="body" label={meta.bodyLabel} required rows={6} maxLength={meta.bodyMax} showCount />
      </Form>
    </FormDialog>
  )
}

interface TextItem extends KnowledgeReview {
  id: EntityId
  title: string
  body: string
}

function TextList({ kind, canEdit }: { kind: KnowledgeTextKind; canEdit: boolean }) {
  const faqs = useKnowledgeFaqs()
  const entries = useKnowledgeEntries()
  const query = kind === 'faq' ? faqs : entries
  const meta = TEXT_KINDS[kind]
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<TextItem | null>(null)

  const items: TextItem[] | undefined =
    kind === 'faq'
      ? faqs.data?.map((faq) => ({ ...faq, title: faq.question, body: faq.answer }))
      : entries.data?.map((entry) => ({ ...entry, title: entry.title, body: entry.content }))

  return (
    <div className="space-y-4">
      {canEdit ? (
        <Button type="button" size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {kind === 'faq' ? 'Add FAQ' : 'Add knowledge entry'}
        </Button>
      ) : null}
      {query.isPending ? <LoadingState label={`Loading ${meta.noun}s…`} rows={2} /> : null}
      {query.isError ? <ErrorState title={`The ${meta.noun}s could not be loaded`} error={query.error} onRetry={() => void query.refetch()} /> : null}
      {items && items.length === 0 ? (
        <EmptyState
          icon={kind === 'faq' ? HelpCircle : BookOpen}
          title={meta.empty}
          description={kind === 'faq' ? 'Add the questions contacts ask most, with the answers you want the agent to give.' : 'Add facts about your business the agent may share.'}
        />
      ) : null}
      {items && items.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border" aria-label={kind === 'faq' ? 'FAQs' : 'Knowledge entries'}>
          {items.map((item) => (
            <li key={item.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-foreground">{item.title}</p>
                  <p className="text-sm whitespace-pre-line text-muted-foreground">{item.body}</p>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(item)} aria-label={`Edit ${item.title}`}>
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <ReviewActions kind={kind} id={item.id} status={item.status} label={item.title} />
                  </div>
                ) : null}
              </div>
              <ReviewStatus item={item} />
            </li>
          ))}
        </ul>
      ) : null}
      <TextDialog kind={kind} open={adding} onOpenChange={setAdding} />
      <TextDialog
        kind={kind}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        {...(editing ? { editing: { id: editing.id, values: { title: editing.title, body: editing.body }, approved: editing.status === 'approved' } } : {})}
      />
    </div>
  )
}

const documentSchema = z.object({
  title: z.string().trim().min(1, 'Give the document a title').max(200),
  description: z.string().trim().max(1000),
})
type DocumentValues = z.infer<typeof documentSchema>

function UploadDocumentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const upload = useUploadKnowledgeDocument()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | undefined>()
  // Mounted only while open (see DocumentList), so every upload starts empty.
  const form = useForm<DocumentValues>({ resolver: zodResolver(documentSchema), defaultValues: { title: '', description: '' } })

  const submit = form.handleSubmit(async (values) => {
    if (!file) {
      setFileError('Choose a file')
      return
    }
    try {
      await upload.mutateAsync({
        file,
        mimeType: file.type as KnowledgeDocumentMimeType,
        title: values.title,
        ...(values.description ? { description: values.description } : {}),
      })
      toast.success('Document uploaded as a draft')
      onOpenChange(false)
    } catch (error) {
      form.setError('root', { type: 'server', message: describeApiError(error, error instanceof Error && error.name === 'DocumentUploadError' ? error.message : 'The document could not be uploaded. Try again.') })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Upload a document"
      description="PDF, PNG, JPEG or plain text, at most 10 MB. It starts as a draft: the agent only refers to approved documents."
      submitLabel="Upload as draft"
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
          maxSizeBytes={KNOWLEDGE_DOCUMENT_MAX_BYTES}
          onFilesSelected={(files) => {
            const chosen = files[0] ?? null
            setFile(chosen)
            setFileError(undefined)
            if (chosen && !form.getValues('title')) form.setValue('title', chosen.name.replace(/\.[^.]+$/, ''))
          }}
          {...(fileError ? { error: fileError } : {})}
        />
        {file ? (
          <p className="text-sm text-muted-foreground">
            {file.name} ({formatBytes(file.size)})
          </p>
        ) : null}
        <TextField control={form.control} name="title" label="Title" required maxLength={200} />
        <TextAreaField control={form.control} name="description" label="Description" rows={2} maxLength={1000} />
      </Form>
    </FormDialog>
  )
}

function DocumentList({ canEdit }: { canEdit: boolean }) {
  const query = useKnowledgeDocuments()
  const link = useKnowledgeDocumentLink()
  const [uploading, setUploading] = useState(false)

  const open = async (id: EntityId) => {
    try {
      const url = await link.mutateAsync({ id })
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      toast.error(describeApiError(error, 'The document could not be opened. Try again.'))
    }
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <Button type="button" size="sm" onClick={() => setUploading(true)}>
          <Upload className="size-4" aria-hidden="true" />
          Upload document
        </Button>
      ) : null}
      {query.isPending ? <LoadingState label="Loading documents…" rows={2} /> : null}
      {query.isError ? <ErrorState title="The documents could not be loaded" error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.length === 0 ? (
        <EmptyState icon={FileText} title="No documents yet" description="Upload brochures or rules the agent may point contacts to once approved." />
      ) : null}
      {query.data && query.data.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border" aria-label="Documents">
          {query.data.map((document) => (
            <li key={document.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-foreground">{document.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {document.fileName} · {formatBytes(document.sizeBytes)}
                  </p>
                  {document.description ? <p className="text-sm text-muted-foreground">{document.description}</p> : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => void open(document.id)} aria-label={`Open ${document.title}`}>
                    <ExternalLink className="size-4" aria-hidden="true" />
                  </Button>
                  {canEdit ? <ReviewActions kind="document" id={document.id} status={document.status} label={document.title} /> : null}
                </div>
              </div>
              <ReviewStatus item={document} />
            </li>
          ))}
        </ul>
      ) : null}
      {uploading ? <UploadDocumentDialog open onOpenChange={setUploading} /> : null}
    </div>
  )
}

/** FAQs, knowledge entries and documents, each draft or approved. Only approved items reach the agent. */
export function KnowledgeBase({ canEdit }: { canEdit: boolean }) {
  return (
    <Tabs defaultValue="faqs" className="space-y-4">
      <TabsList>
        <TabsTrigger value="faqs">FAQs</TabsTrigger>
        <TabsTrigger value="entries">Knowledge entries</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="faqs">
        <TextList kind="faq" canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="entries">
        <TextList kind="entry" canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="documents">
        <DocumentList canEdit={canEdit} />
      </TabsContent>
    </Tabs>
  )
}
