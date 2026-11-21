import {
  PORTFOLIO_IMPORT_MAX_FILE_BYTES,
  PORTFOLIO_IMPORT_MAX_ROWS,
  googleSheetUrl,
  portfolioImportFieldsFor,
  type PortfolioImport,
  type PortfolioImportScope,
  type Property,
} from '@leaseguard/domain'
import { isApiError } from '@leaseguard/api-client'
import { Link } from '@tanstack/react-router'
import { Download, Upload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { RecordNotFound } from '@/components/layout'
import { PageHeader } from '@/components/layout/PageHeader'
import { FileUpload, formatBytes } from '@/components/forms'
import { AppLink, DateDisplay, EmptyState, InformationGrid, InformationItem, RecordQueryView, SectionHeader, SignOff, StatusDot } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { usePropertyQuery } from '@/features/properties/api'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { PortfolioUploadError } from '../api/apiSource'
import { usePortfolioImportQuery, useSelectPortfolioImportSheet, useUploadPortfolioFile } from '../api/queries'
import { usePortfolioImportSummaryQuery } from '../api/applyQueries'
import { downloadTemplate } from '../templateDownload'
import { GoogleSheetLinkForm } from './GoogleSheetLinkForm'
import { ImportApproval } from './ImportApproval'
import { ImportHistory } from './ImportHistory'
import { ImportMappingPreview } from './ImportMappingPreview'

const ACCEPT = '.csv,.xlsx'
const COUNT_FORMAT = new Intl.NumberFormat('en-ZA')
const PAGE_TITLE = 'Import from file'

export interface PortfolioImportScreenProps {
  /** The batch to show; without one, the upload step. */
  importId?: string | undefined
  /** Units for this property; without one, properties with their units. */
  propertyId?: string | undefined
  /** Called with the batch once the file is accepted (the route puts its id in the URL). */
  onImported: (batch: PortfolioImport) => void
}

/**
 * Importing a portfolio file: the upload step (choose a CSV or XLSX file exported from your own system, or download
 * LeaseGuard's template), then the accepted batch (file, sheet, row count and the columns found). Started from the
 * Properties screen for properties with their units, or from a property for its units. Nothing is written to
 * properties or units here.
 */
export function PortfolioImportScreen({ importId, propertyId, onImported }: PortfolioImportScreenProps) {
  if (importId) return <BatchRoute importId={importId} />
  if (propertyId) return <UnitsUploadRoute propertyId={propertyId} onImported={onImported} />
  return <UploadStep scope="properties" onImported={onImported} />
}

function UnitsUploadRoute({ propertyId, onImported }: { propertyId: string; onImported: (batch: PortfolioImport) => void }) {
  const query = usePropertyQuery(propertyId)
  return (
    <RecordQueryView query={query} notFound={<RecordNotFound entityLabel="Property" backTo="/properties" backLabel="Back to properties" />}>
      {(property) => <UploadStep scope="units" property={property} onImported={onImported} />}
    </RecordQueryView>
  )
}

function UploadStep({ scope, property, onImported }: { scope: PortfolioImportScope; property?: Property; onImported: (batch: PortfolioImport) => void }) {
  const isWriter = useIsCompanyWriter()
  const upload = useUploadPortfolioFile()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | undefined>()
  const fields = portfolioImportFieldsFor(scope)
  const description =
    scope === 'units' && property
      ? `Add units to ${property.name} from a CSV or Excel file exported from your own system.`
      : 'Add properties and their units from a CSV or Excel file exported from your own system.'

  if (!isWriter) {
    return (
      <section>
        <PageHeader title={PAGE_TITLE} description={description} />
        <EmptyState
          title="Only company admins and property managers import files"
          description="Ask a company admin or property manager of this workspace to import the file."
          action={<AppLink to={property ? `/properties/${encodeURIComponent(property.id)}` : '/properties'} className="text-sm text-primary hover:underline">Back</AppLink>}
        />
        <div className="mt-10">
          <ImportHistory scope={scope} propertyId={property?.id} />
        </div>
      </section>
    )
  }

  if (property?.status === 'archived') {
    return (
      <section>
        <PageHeader title={PAGE_TITLE} description={description} />
        <EmptyState
          title="This property is archived"
          description="Restore it before importing units into it."
          action={<AppLink to={`/properties/${encodeURIComponent(property.id)}`} className="text-sm text-primary hover:underline">Back to {property.name}</AppLink>}
        />
      </section>
    )
  }

  async function submit() {
    if (!file) {
      setError('Choose a CSV or Excel (.xlsx) file to upload.')
      return
    }
    setError(undefined)
    try {
      accepted(await upload.mutateAsync({ file, scope, ...(property ? { propertyId: property.id } : {}) }))
    } catch (failure) {
      setError(uploadErrorMessage(failure))
    }
  }

  function accepted(batch: PortfolioImport) {
    toast.success(`${batch.fileName} accepted: ${COUNT_FORMAT.format(batch.rowCount)} ${batch.rowCount === 1 ? 'row' : 'rows'}`)
    onImported(batch)
  }

  return (
    <section>
      <PageHeader title={PAGE_TITLE} description={description} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="File" className="min-w-0 space-y-3">
          <SectionHeader title="File" description="Nothing is added to properties or units until you check the rows and approve the import." />
          <FileUpload
            label="Portfolio file"
            description={`CSV (comma or semicolon separated) or Excel .xlsx, up to ${formatBytes(PORTFOLIO_IMPORT_MAX_FILE_BYTES)} and ${COUNT_FORMAT.format(PORTFOLIO_IMPORT_MAX_ROWS)} rows. Empty rows are ignored.`}
            accept={ACCEPT}
            maxSizeBytes={PORTFOLIO_IMPORT_MAX_FILE_BYTES}
            disabled={upload.isPending}
            onFilesSelected={(files) => {
              setFile(files[0] ?? null)
              setError(undefined)
            }}
            {...(error ? { error } : {})}
          />
          {file ? (
            <p className="text-sm">
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground tabular-nums"> · {formatBytes(file.size)}</span>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" onClick={() => void submit()} disabled={upload.isPending}>
              <Upload aria-hidden="true" />
              {upload.isPending ? 'Uploading…' : 'Upload file'}
            </Button>
            <Button asChild type="button" variant="ghost">
              <AppLink to={property ? `/properties/${encodeURIComponent(property.id)}` : '/properties'}>Cancel</AppLink>
            </Button>
          </div>
          <div className="mt-4 border-t border-border pt-5">
            <GoogleSheetLinkForm scope={scope} propertyId={property?.id} disabled={upload.isPending} onImported={accepted} />
          </div>
        </section>

        <section aria-label="Template" className="space-y-3 lg:border-l lg:border-border lg:pl-8">
          <SectionHeader title="Columns LeaseGuard reads" className="[&_h2]:text-sm" />
          <p className="text-xs text-muted-foreground italic">
            Your own column headings are fine: you match them to these in the next step. The template lists every column with
            one example row. The tenant columns are optional: leave them out to import {scope === 'units' ? 'units' : 'properties and units'} only.
          </p>
          <ul className="divide-y divide-border/70 border-y border-border text-sm">
            {fields.map((field) => (
              <li key={field.key} className="py-1.5">
                {field.header}
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" size="sm" onClick={() => downloadTemplate(scope)}>
            <Download aria-hidden="true" />
            Download the CSV template
          </Button>
        </section>
      </div>
      <div className="mt-10">
        <ImportHistory scope={scope} propertyId={property?.id} />
      </div>
    </section>
  )
}

/** Why the upload failed, in words: the API's own message for a file it refused (413 included), or storage's answer. */
function uploadErrorMessage(failure: unknown): string {
  if (failure instanceof PortfolioUploadError) return failure.message
  if (isApiError(failure) && failure.status === 413 && failure.messages.length > 0) return `${failure.messages.join('. ')}.`
  return describeApiError(failure, 'The file could not be uploaded. Try again in a moment.')
}

function BatchRoute({ importId }: { importId: string }) {
  const query = usePortfolioImportQuery(importId)
  return (
    <RecordQueryView query={query} notFound={<RecordNotFound entityLabel="Import" backTo="/properties" backLabel="Back to properties" />}>
      {(batch) => <BatchView batch={batch} />}
    </RecordQueryView>
  )
}

function BatchView({ batch }: { batch: PortfolioImport }) {
  const isWriter = useIsCompanyWriter()
  const property = usePropertyQuery(batch.propertyId ?? '', { enabled: batch.propertyId !== undefined })
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })
  const selectSheet = useSelectPortfolioImportSheet()
  const summary = usePortfolioImportSummaryQuery(batch.id, batch.updatedAt)
  const memberName = (userId: string | undefined) =>
    userId ? members.data?.items.find((member) => member.id.toLowerCase() === userId.toLowerCase())?.fullName : undefined
  const uploader = memberName(batch.uploadedByUserId)
  const approved = (summary.data?.created.length ?? 0) > 0
  const propertyName = property.data?.name

  async function changeSheet(sheetName: string) {
    try {
      const saved = await selectSheet.mutateAsync({ id: batch.id, sheetName })
      toast.success(`Now reading the sheet ${saved.sheetName ?? sheetName}: ${COUNT_FORMAT.format(saved.rowCount)} ${saved.rowCount === 1 ? 'row' : 'rows'}`)
    } catch (failure) {
      toast.error('The sheet was not changed', { description: describeApiError(failure, 'Try again in a moment.') })
    }
  }

  const sheet =
    batch.fileFormat === 'xlsx' && batch.sheetName ? (
      isWriter && batch.sheetNames.length > 1 ? (
        <Select value={batch.sheetName} onValueChange={(value) => void changeSheet(value)} disabled={selectSheet.isPending}>
          <SelectTrigger aria-label="Sheet" className="w-full max-w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {batch.sheetNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        batch.sheetName
      )
    ) : null

  return (
    <section>
      <PageHeader
        title={PAGE_TITLE}
        status={
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{batch.fileName}</span>
            <span aria-hidden="true">·</span>
            <StatusDot tone="success">{approved ? 'Imported' : 'File accepted'}</StatusDot>
          </p>
        }
        actions={
          isWriter ? (
            <Button asChild variant="outline">
              <Link to="/properties/import" search={batch.propertyId ? { propertyId: batch.propertyId } : {}}>
                Import another file
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-10">
          <p className="text-sm text-muted-foreground">
            {batch.googleSheet
              ? 'A copy of the sheet as LeaseGuard read it is kept with this import, so later changes to the sheet do not change it.'
              : 'The file is kept with this import.'}{' '}
            {approved
              ? 'The records this import created are listed under Approve the import.'
              : 'Nothing has been added to properties or units: the rows are checked and approved first.'}
          </p>
          <section aria-label="Columns found" className="space-y-3">
            <SectionHeader
              title="Columns found"
              description={`${batch.columns.length} ${batch.columns.length === 1 ? 'column' : 'columns'} read from the first non-empty row${batch.sheetName ? ` of the sheet ${batch.sheetName}` : ''}, in file order.`}
            />
            <ol aria-label="Columns found" className="divide-y divide-border/70 border-y border-border text-sm">
              {batch.columns.map((column) => (
                <li key={column} className="py-2">
                  {column}
                </li>
              ))}
            </ol>
          </section>
          <ImportMappingPreview batch={batch} />
          <ImportApproval batch={batch} memberName={memberName} />
        </div>

        <section aria-label="Details" className="space-y-4 lg:border-l lg:border-border lg:pl-8">
          <SectionHeader title="Details" className="[&_h2]:text-sm" />
          <InformationGrid columns={1} className="gap-y-3">
            <InformationItem
              label="Adds"
              value={
                batch.scope === 'units' && batch.propertyId ? (
                  <>
                    Units of{' '}
                    <AppLink to={`/properties/${encodeURIComponent(batch.propertyId)}`} className="hover:underline">
                      {propertyName ?? 'the property'}
                    </AppLink>
                  </>
                ) : (
                  'Properties and their units'
                )
              }
            />
            {batch.googleSheet ? (
              <InformationItem
                label="Read from"
                value={
                  <a href={googleSheetUrl(batch.googleSheet)} target="_blank" rel="noreferrer" className="hover:underline">
                    Google Sheet{batch.googleSheet.gid === undefined ? ', first tab' : ''}
                  </a>
                }
              />
            ) : null}
            <InformationItem
              label="Format"
              value={batch.fileFormat === 'xlsx' ? 'Excel workbook (.xlsx)' : `CSV, ${batch.delimiter === ';' ? 'semicolon' : 'comma'} separated`}
            />
            {sheet !== null ? <InformationItem label="Sheet" value={sheet} /> : null}
            <InformationItem label="Rows" value={<span className="tabular-nums">{COUNT_FORMAT.format(batch.rowCount)}</span>} />
            <InformationItem label="Size" value={<span className="tabular-nums">{formatBytes(batch.sizeBytes)}</span>} />
            <InformationItem
              label="Uploaded by"
              value={uploader ? <SignOff by={uploader} at={batch.uploadedAt} /> : <DateDisplay value={batch.uploadedAt} className="tabular-nums" />}
            />
          </InformationGrid>
        </section>
      </div>
    </section>
  )
}
