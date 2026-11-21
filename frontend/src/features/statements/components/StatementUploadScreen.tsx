import { STATEMENT_SOURCES, STATEMENT_UPLOAD_MAX_BYTES, type Property, type StatementSource } from '@leaseguard/domain'
import { Link } from '@tanstack/react-router'
import { RotateCcw, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { FileUpload, formatBytes } from '@/components/forms'
import { AppLink, EmptyState, NoActiveWorkspace, ProgressIndicator, SectionHeader, StatusDot } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { usePropertyList } from '@/features/properties/api/queries'
import type { Tone } from '@/lib/labels'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { isAwaitingWorkspace } from '@/lib/data/queries'

import { useStatementUploader } from '../api/queries'
import { countOutcomes, isSettled, runUploadBatch, statementOf, UPLOAD_OUTCOMES, type UploadFileState, type UploadOutcome } from '../upload/uploadBatch'

const PAGE_TITLE = 'Upload statements'
const ACCEPT = 'application/pdf,.pdf'
const SOURCE_LABELS: Readonly<Record<StatementSource, string>> = { MRI: 'MRI', MDA: 'MDA', PropSys: 'PropSys', Sage: 'Sage', other: 'Other system' }

interface ChosenFile {
  key: string
  file: File
  state: UploadFileState
}

/** Status mark and words for one file. */
function describeState(state: UploadFileState): { tone: Tone; label: string } {
  switch (state.phase) {
    case 'waiting':
      return { tone: 'neutral', label: 'Waiting' }
    case 'checking':
      return { tone: 'info', label: 'Checking the file…' }
    case 'uploading':
      return { tone: 'info', label: 'Uploading…' }
    case 'registering':
      return { tone: 'info', label: 'Registering…' }
    case 'queued':
      return state.processingQueued ? { tone: 'success', label: 'Queued for processing' } : { tone: 'warning', label: 'Saved, not yet queued' }
    case 'likely_duplicate':
      return { tone: 'warning', label: 'Uploaded: likely duplicate' }
    case 'identical':
      return { tone: 'neutral', label: 'Already uploaded' }
    case 'repeat':
      return { tone: 'neutral', label: 'Repeated in this upload' }
    case 'failed':
      return { tone: 'danger', label: 'Failed' }
  }
}

function StatementLink({ statementId, children }: { statementId: string; children: string }) {
  return (
    <Link to="/statements/$statementId" params={{ statementId }} className="text-primary hover:underline">
      {children}
    </Link>
  )
}

/** What happened to one file, beyond its status: the statement to open, or why it failed. */
function FileOutcome({ item, items }: { item: ChosenFile; items: readonly ChosenFile[] }) {
  const { state } = item
  switch (state.phase) {
    case 'queued':
      return (
        <p>
          {state.processingQueued ? 'Values are read from the document next, then wait for review.' : 'Processing could not be queued; retry it from the statement list.'}{' '}
          <StatementLink statementId={state.statementId}>Open the statement</StatementLink>
        </p>
      )
    case 'likely_duplicate':
      return (
        <p>
          Another statement has the same tenant, period and number; check both before verifying.{' '}
          <StatementLink statementId={state.duplicate.existingStatementId}>Open the other statement</StatementLink>
          {' · '}
          <StatementLink statementId={state.statementId}>Open this one</StatementLink>
        </p>
      )
    case 'identical':
      return (
        <p>
          This exact file is already on record and was not processed again.{' '}
          <StatementLink statementId={state.existingStatementId}>Open the statement on record</StatementLink>
        </p>
      )
    case 'repeat': {
      const original = items[state.repeatsIndex]
      const statementId = original ? statementOf(original.state) : undefined
      return (
        <p>
          The same file as {original?.file.name ?? 'an earlier file'} in this upload; only that copy is uploaded.
          {statementId ? (
            <>
              {' '}
              <StatementLink statementId={statementId}>Open the statement</StatementLink>
            </>
          ) : null}
        </p>
      )
    }
    case 'failed':
      return <p className="text-destructive">{state.reason}</p>
    default:
      return null
  }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** Each outcome in the batch summary, in words. */
const OUTCOME_WORDS: Readonly<Record<UploadOutcome, (count: number) => string>> = {
  registered: (count) => `${count} registered`,
  likely_duplicate: (count) => plural(count, 'likely duplicate to check', 'likely duplicates to check'),
  already_uploaded: (count) => `${count} already uploaded`,
  failed: (count) => `${count} failed`,
}

/**
 * The finished batch in one line. Every file counts once (a likely duplicate under likely duplicates only, never also
 * as registered), so the numbers add up to the files; registered and failed always show, the duplicate outcomes only
 * when a file came to them.
 */
function batchSummary(states: readonly UploadFileState[]): string {
  const counts = countOutcomes(states)
  return UPLOAD_OUTCOMES
    .filter((outcome) => outcome === 'registered' || outcome === 'failed' || counts[outcome] > 0)
    .map((outcome) => OUTCOME_WORDS[outcome](counts[outcome]))
    .join(' · ')
}

/** A fresh id for one upload batch; the statement list follows the batch by it. */
function newBatchId(): string {
  return crypto.randomUUID()
}

/**
 * Uploading statements: a writer chooses the property (its accounting system is preselected as the source) and drops
 * one or many PDF statements. Each file is checked, uploaded through its own signed URL and queued for processing as
 * one upload batch, with its own progress and outcome: queued, already on record (linking to it), a likely duplicate
 * (linking to the other statement), repeated within the batch, or failed with the reason. The batch can then be
 * followed on the statement list.
 */
export function StatementUploadScreen() {
  const isWriter = useIsCompanyWriter()
  const properties = usePropertyList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'name', direction: 'asc' })
  const uploader = useStatementUploader()
  const [propertyId, setPropertyId] = useState<string | undefined>()
  const [sourceSystem, setSourceSystem] = useState<StatementSource | undefined>()
  const [items, setItems] = useState<ChosenFile[]>([])
  const [batchId, setBatchId] = useState<string | undefined>()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const nextKey = useRef(0)

  if (isAwaitingWorkspace(properties)) {
    return (
      <section>
        <PageHeader title={PAGE_TITLE} />
        <NoActiveWorkspace />
      </section>
    )
  }
  if (!isWriter) {
    return (
      <section>
        <PageHeader title={PAGE_TITLE} />
        <EmptyState
          title="Only company admins and property managers upload statements"
          description="Ask a company admin or property manager of this workspace to upload them."
          action={
            <AppLink to="/statements" className="text-sm text-primary hover:underline">
              Back to statements
            </AppLink>
          }
        />
      </section>
    )
  }

  const choosable = (properties.data?.items ?? []).filter((property) => property.status !== 'archived')
  const property: Property | undefined = choosable.find((candidate) => candidate.id === propertyId)
  const started = batchId !== undefined
  const settled = items.filter((item) => isSettled(item.state)).length
  const finished = started && !running

  function chooseProperty(id: string) {
    setPropertyId(id)
    const chosen = choosable.find((candidate) => candidate.id === id)
    if (chosen) setSourceSystem(chosen.accountingSystem)
    setError(undefined)
  }

  function addFiles(files: File[]) {
    setItems((current) => [...current, ...files.map((file) => ({ key: `file-${nextKey.current++}`, file, state: { phase: 'waiting' } as const }))])
    setError(undefined)
  }

  async function start() {
    if (!property || !sourceSystem) {
      setError('Choose the property the statements belong to.')
      return
    }
    if (items.length === 0) {
      setError('Choose at least one PDF statement.')
      return
    }
    const uploadBatchId = newBatchId()
    const files = items.map((item) => item.file)
    setError(undefined)
    setBatchId(uploadBatchId)
    setRunning(true)
    try {
      await runUploadBatch({
        files,
        propertyId: property.id,
        sourceSystem,
        uploadBatchId,
        upload: uploader.upload,
        onChange: (index, state) => setItems((current) => current.map((item, at) => (at === index ? { ...item, state } : item))),
      })
    } finally {
      setRunning(false)
      void uploader.refresh()
    }
  }

  /**
   * Sends one failed file again in the same upload batch. Its row walks through checking, uploading and registering
   * again and settles on its own outcome; the rest of the batch is untouched.
   */
  async function retryFile(key: string) {
    const index = items.findIndex((item) => item.key === key)
    const item = items[index]
    if (!item || !property || !sourceSystem || !batchId) return
    setRunning(true)
    try {
      await runUploadBatch({
        files: [item.file],
        propertyId: property.id,
        sourceSystem,
        uploadBatchId: batchId,
        upload: uploader.upload,
        onChange: (_, state) => setItems((current) => current.map((candidate) => (candidate.key === key ? { ...candidate, state } : candidate))),
      })
    } finally {
      setRunning(false)
      void uploader.refresh()
    }
  }

  function removeFile(key: string) {
    setItems((current) => current.filter((candidate) => candidate.key !== key))
  }

  function startAgain() {
    setItems([])
    setBatchId(undefined)
    setError(undefined)
  }

  return (
    <section>
      <PageHeader title={PAGE_TITLE} />
      <div className="mx-auto max-w-3xl space-y-10">
        <section aria-label="Property and source" className="space-y-3">
          <SectionHeader title="Property and source" description="Every file in this upload belongs to one property. Its accounting system is chosen for you; change it if these statements came from another system." />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="statement-upload-property">Property</Label>
              <Select value={propertyId ?? ''} onValueChange={chooseProperty} disabled={started}>
                <SelectTrigger id="statement-upload-property" className="w-full">
                  <SelectValue placeholder={properties.isPending ? 'Loading properties…' : 'Choose a property'} />
                </SelectTrigger>
                <SelectContent>
                  {choosable.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {properties.isSuccess && choosable.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No active properties yet. <AppLink to="/properties" className="text-primary not-italic hover:underline">Add a property</AppLink> first.
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="statement-upload-source">Source system</Label>
              <Select value={sourceSystem ?? ''} onValueChange={(value) => setSourceSystem(value as StatementSource)} disabled={started || !property}>
                <SelectTrigger id="statement-upload-source" className="w-full">
                  <SelectValue placeholder="Choose the property first" />
                </SelectTrigger>
                <SelectContent>
                  {STATEMENT_SOURCES.map((source) => (
                    <SelectItem key={source} value={source}>
                      {SOURCE_LABELS[source]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section aria-label="Files" className="space-y-3">
          <SectionHeader
            title="Files"
            description="A file already on record is linked instead of being processed again, and a file chosen twice is uploaded once."
          />
          {!started ? (
            <FileUpload
              label="Statement PDFs"
              accept={ACCEPT}
              multiple
              maxSizeBytes={STATEMENT_UPLOAD_MAX_BYTES}
              description={`PDF only, up to ${formatBytes(STATEMENT_UPLOAD_MAX_BYTES)} each. Choose as many as you need.`}
              onFilesSelected={addFiles}
            />
          ) : null}

          {items.length > 0 ? (
            <ul aria-label="Chosen files" className="divide-y divide-border/70 border-y border-border">
              {items.map((item) => {
                const { tone, label } = describeState(item.state)
                return (
                  <li key={item.key} className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-start sm:gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate" title={item.file.name}>
                        <span className="font-medium">{item.file.name}</span>
                        <span className="text-muted-foreground tabular-nums"> · {formatBytes(item.file.size)}</span>
                      </p>
                      {started ? (
                        <div className="text-xs text-muted-foreground">
                          <FileOutcome item={item} items={items} />
                        </div>
                      ) : null}
                    </div>
                    {started ? (
                      // The status, and for a failed file its actions, sit at the far right of the row.
                      <div className="flex flex-col items-end gap-2 sm:w-56">
                        <StatusDot tone={tone} className="sm:w-full sm:justify-end">
                          {label}
                        </StatusDot>
                        {item.state.phase === 'failed' && !running ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${item.file.name}`} onClick={() => removeFile(item.key)}>
                              Remove
                            </Button>
                            <Button type="button" variant="outline" size="sm" aria-label={`Try again ${item.file.name}`} onClick={() => void retryFile(item.key)}>
                              <RotateCcw aria-hidden="true" />
                              Try again
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="self-end sm:self-start"
                        onClick={() => setItems((current) => current.filter((candidate) => candidate.key !== item.key))}
                      >
                        <X aria-hidden="true" />
                        Remove<span className="sr-only"> {item.file.name}</span>
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {/*
            Progress is the progress bar's to convey; only the finished summary is announced. The status region stays in
            the page from the start so assistive technology is already watching it when the summary appears.
          */}
          <div className={started ? 'space-y-3 pt-1' : undefined}>
            {started ? <ProgressIndicator label={`${settled} of ${items.length} files done`} value={(settled / Math.max(1, items.length)) * 100} /> : null}
            <p role="status" className="text-sm tabular-nums empty:hidden">
              {finished ? batchSummary(items.map((item) => item.state)) : null}
            </p>
          </div>

          {/* Buttons on the right, the primary one last (owner rule: no buttons on the left). */}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {!started ? (
              <>
                <Button asChild type="button" variant="ghost">
                  <AppLink to="/statements">Cancel</AppLink>
                </Button>
                <Button type="button" onClick={() => void start()}>
                  <Upload aria-hidden="true" />
                  {items.length > 1 ? `Upload ${items.length} statements` : 'Upload statement'}
                </Button>
              </>
            ) : finished ? (
              <>
                <Button type="button" variant="outline" onClick={startAgain}>
                  Upload more statements
                </Button>
                <Button asChild type="button">
                  <Link to="/statements" search={{ uploadBatchId: batchId }}>
                    Follow this upload on the list
                  </Link>
                </Button>
              </>
            ) : (
              <Button type="button" disabled>
                <Upload aria-hidden="true" />
                Uploading…
              </Button>
            )}
          </div>
        </section>
      </div>
    </section>
  )
}
