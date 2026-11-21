import type { StatementGroupFigures, StatementSource, StatementUploadRow } from '@leaseguard/domain'

import { AppLink, DataTable, DateDisplay, MetricCard, MetricGrid, SectionHeader, StatusBadge, type DataTableColumn } from '@/components/shared'
import { labelFor } from '@/lib/labels'

import { useReport } from '../api/queries'
import { csvPercent, toCsv, type CsvColumn } from '../csv'
import { formatRate } from '../format'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

const count = (value: number) => <span className="tabular-nums">{value}</span>
const muted = (text: string) => <span className="text-muted-foreground">{text}</span>
const dayCount = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`

/** A statement's file name, linking to the statement (its review screen while under review). */
function statementLink(row: StatementUploadRow) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <AppLink to={`/statements/${encodeURIComponent(row.statementId)}`} className="font-medium break-all text-foreground hover:underline">
        {row.fileName}
      </AppLink>
      {row.statementNumber ? <span className="text-xs text-muted-foreground tabular-nums">No. {row.statementNumber}</span> : null}
    </span>
  )
}

function tenantCell(row: StatementUploadRow) {
  if (!row.tenantId || !row.tenantName) return muted('Not matched yet')
  return (
    <span className="flex flex-col gap-0.5">
      <AppLink to={`/tenants/${encodeURIComponent(row.tenantId)}`} className="hover:underline">
        {row.tenantName}
      </AppLink>
      {row.unitId && row.unitNumber ? (
        <AppLink to={`/units/${encodeURIComponent(row.unitId)}`} className="text-xs text-muted-foreground tabular-nums hover:underline">
          Unit {row.unitNumber}
        </AppLink>
      ) : null}
    </span>
  )
}

/** Status as dot and text; a failed extraction says so, as on the Statements page. */
const statusCell = (row: StatementUploadRow) =>
  row.processingFailed ? <StatusBadge status={row.status} label="Processing failed" /> : <StatusBadge status={row.status} />

const BACKLOG_COLUMNS: DataTableColumn<StatementUploadRow>[] = [
  { id: 'statement', header: 'Statement', rowHeader: true, cell: statementLink },
  { id: 'property', header: 'Property', hideBelow: 'md', cell: (row) => row.propertyName },
  { id: 'tenant', header: 'Tenant', hideBelow: 'lg', cell: tenantCell },
  { id: 'uploaded', header: 'Uploaded', hideBelow: 'sm', cell: (row) => <DateDisplay value={row.uploadedAt} className="tabular-nums" /> },
  { id: 'age', header: 'Waiting', align: 'right', cell: (row) => <span className="tabular-nums">{dayCount(row.ageDays)}</span> },
  {
    id: 'fields',
    header: 'Fields to resolve',
    align: 'right',
    hideBelow: 'md',
    cell: (row) => (row.processingFailed ? muted('Entered by hand') : count(row.unresolvedFields)),
  },
  { id: 'status', header: 'Status', cell: statusCell },
]

const FAILURE_COLUMNS: DataTableColumn<StatementUploadRow>[] = [
  { id: 'statement', header: 'Statement', rowHeader: true, cell: statementLink },
  { id: 'property', header: 'Property', hideBelow: 'md', cell: (row) => row.propertyName },
  { id: 'source', header: 'Source', hideBelow: 'lg', cell: (row) => labelFor(row.sourceSystem) },
  { id: 'uploaded', header: 'Uploaded', hideBelow: 'sm', cell: (row) => <DateDisplay value={row.uploadedAt} className="tabular-nums" /> },
  { id: 'reason', header: 'Why it failed', cell: (row) => <span className="text-sm">{row.processingError ?? '—'}</span> },
]

/** The figures columns of a group, after the group's own column. */
function figureColumns<T extends StatementGroupFigures>(): DataTableColumn<T>[] {
  return [
    { id: 'total', header: 'Uploads', align: 'right', cell: (row) => count(row.total) },
    { id: 'inProgress', header: 'In progress', align: 'right', hideBelow: 'md', cell: (row) => count(row.inProgress) },
    { id: 'pendingReview', header: 'Waiting for review', align: 'right', cell: (row) => count(row.pendingReview) },
    { id: 'failures', header: 'Failed', align: 'right', cell: (row) => count(row.processingFailures) },
    { id: 'verified', header: 'Verified', align: 'right', cell: (row) => count(row.verified) },
    { id: 'rejected', header: 'Rejected', align: 'right', hideBelow: 'lg', cell: (row) => count(row.rejected) },
    { id: 'duplicate', header: 'Duplicates', align: 'right', hideBelow: 'lg', cell: (row) => count(row.duplicate) },
  ]
}

type SourceFigures = StatementGroupFigures & { sourceSystem: StatementSource }
type PropertyFigures = StatementGroupFigures & { propertyId: string; propertyName: string }

const SOURCE_COLUMNS: DataTableColumn<SourceFigures>[] = [
  { id: 'source', header: 'Source system', rowHeader: true, cell: (row) => labelFor(row.sourceSystem) },
  ...figureColumns<SourceFigures>(),
]

const PROPERTY_COLUMNS: DataTableColumn<PropertyFigures>[] = [
  {
    id: 'property',
    header: 'Property',
    rowHeader: true,
    cell: (row) => (
      <AppLink to={`/properties/${encodeURIComponent(row.propertyId)}`} className="font-medium text-foreground hover:underline">
        {row.propertyName}
      </AppLink>
    ),
  },
  ...figureColumns<PropertyFigures>(),
]

const UPLOAD_COLUMNS: DataTableColumn<StatementUploadRow>[] = [
  { id: 'statement', header: 'Statement', rowHeader: true, cell: statementLink },
  { id: 'property', header: 'Property', hideBelow: 'md', cell: (row) => row.propertyName },
  { id: 'tenant', header: 'Tenant', hideBelow: 'lg', cell: tenantCell },
  { id: 'source', header: 'Source', hideBelow: 'md', cell: (row) => labelFor(row.sourceSystem) },
  { id: 'uploaded', header: 'Uploaded', hideBelow: 'sm', cell: (row) => <DateDisplay value={row.uploadedAt} className="tabular-nums" /> },
  {
    id: 'confidence',
    header: 'Confidence',
    align: 'right',
    hideBelow: 'lg',
    cell: (row) => (row.extractionConfidence === undefined ? muted('—') : <span className="tabular-nums">{formatRate(row.extractionConfidence)}</span>),
  },
  { id: 'status', header: 'Status', cell: statusCell },
]

const CSV_COLUMNS: CsvColumn<StatementUploadRow>[] = [
  { header: 'File name', value: (row) => row.fileName },
  { header: 'Statement number', value: (row) => row.statementNumber },
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Tenant', value: (row) => row.tenantName },
  { header: 'Unit', value: (row) => row.unitNumber },
  { header: 'Source system', value: (row) => labelFor(row.sourceSystem) },
  { header: 'Uploaded on', value: (row) => row.uploadedOn },
  { header: 'Statement date', value: (row) => row.statementDate },
  { header: 'Status', value: (row) => (row.processingFailed ? 'Processing failed' : labelFor(row.status)) },
  { header: 'Days since upload', value: (row) => row.ageDays },
  { header: 'Fields to resolve', value: (row) => (row.status === 'review_required' ? row.unresolvedFields : undefined) },
  { header: 'Extraction confidence (%)', value: (row) => (row.extractionConfidence === undefined ? undefined : csvPercent(row.extractionConfidence)) },
  { header: 'Processing error', value: (row) => row.processingError },
]

/**
 * Statement processing: where the uploads stand, the review backlog oldest first with what each still needs, the
 * statements whose automatic processing failed, and the uploads by source system and property. The CSV holds the
 * uploads table. Figures come from the reports service, counted as the Statements page and the dashboard count them.
 */
export function StatementProcessingReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const query = useReport('statement_processing', reportFiltersFromSearch('statement_processing', search))
  const report = query.data?.data
  const rows = report?.rows ?? []

  return (
    <ReportFrame
      reportId="statement_processing"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={rows.length === 0}
      emptyTitle="No statements uploaded yet"
      emptyDescription="Upload tenant statements on the Statements page, and their processing appears here."
      csv={() => toCsv(CSV_COLUMNS, rows)}
    >
      {report ? (
        <>
          <MetricGrid columns={4}>
            <MetricCard
              lead
              label="Waiting for review"
              value={report.pendingReview}
              {...(report.oldestPendingReviewDays !== null ? { description: `Oldest uploaded ${dayCount(report.oldestPendingReviewDays)} ago` } : {})}
            />
            <MetricCard label="Processing failed" value={report.processingFailures} description="Waiting for review with an error" />
            <MetricCard label="In progress" value={report.inProgress} description="Uploaded or being read" />
            <MetricCard label="Verified" value={report.verified} description={`of ${report.total} uploads`} />
            <MetricCard
              label="Extraction confidence"
              value={report.averageExtractionConfidence === null ? '—' : formatRate(report.averageExtractionConfidence)}
              description="Mean over the uploads read"
            />
          </MetricGrid>

          <section className="flex flex-col gap-3">
            <SectionHeader title="Review backlog" description="Statements waiting for a person, oldest first. Open one to review it." />
            {report.backlog.length > 0 ? (
              <DataTable caption="Statements waiting for review" columns={BACKLOG_COLUMNS} rows={report.backlog} getRowId={(row) => row.statementId} />
            ) : (
              <p className="text-sm text-muted-foreground">Nothing is waiting for review.</p>
            )}
          </section>

          {report.failures.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeader title="Processing failures" description="Automatic extraction gave up on these. Queue one again from its statement, or enter its figures by hand." />
              <DataTable caption="Statements whose processing failed" columns={FAILURE_COLUMNS} rows={report.failures} getRowId={(row) => row.statementId} />
            </section>
          ) : null}

          <section className="flex flex-col gap-3">
            <SectionHeader title="By source system" />
            <DataTable caption="Uploads by source system" columns={SOURCE_COLUMNS} rows={report.bySource} getRowId={(row) => row.sourceSystem} />
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader title="By property" />
            <DataTable caption="Uploads by property" columns={PROPERTY_COLUMNS} rows={report.byProperty} getRowId={(row) => row.propertyId} />
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader title="Uploads" description="Newest first. Export CSV saves this table." />
            <DataTable caption="Every statement upload" columns={UPLOAD_COLUMNS} rows={rows} getRowId={(row) => row.statementId} />
          </section>
        </>
      ) : null}
    </ReportFrame>
  )
}
