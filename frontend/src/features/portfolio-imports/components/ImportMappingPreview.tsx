import {
  PORTFOLIO_IMPORT_ROW_RESULTS,
  formatCount,
  portfolioImportMappingProblems,
  type EntityId,
  type PortfolioImport,
  type PortfolioImportColumnMapping,
  type PortfolioImportMapping,
  type PortfolioImportRowCheck,
  type PortfolioImportRowResult,
} from '@leaseguard/domain'
import { useState } from 'react'
import { toast } from 'sonner'

import { DataTable, DateDisplay, ErrorState, LoadingState, SectionHeader, SignOff, StatusDot, type DataTableColumn } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { cn } from '@/lib/utils'

import { usePortfolioImportMappingQuery, usePortfolioImportPreviewQuery, useSavePortfolioImportMapping } from '../api/previewQueries'
import { formatImportValue, IMPORT_ROW_RESULT_DISPLAY, IMPORT_TENANT_RESULT_DISPLAY, importFieldLabel } from '../previewLabels'
import { RowResolutionDrawer } from './RowResolutionDrawer'

const NOT_READ = '__not_read__'
const PAGE_SIZE = 25

/**
 * The batch's column mapping and its rows checked against the database: how each LeaseGuard field is read from the
 * file (suggested from the headings, reused from the last file with the same headings, or applied by a person), then
 * every row's result with its reason, narrowed by result. Nothing is written to properties or units here.
 */
export function ImportMappingPreview({ batch }: { batch: PortfolioImport }) {
  const mapping = usePortfolioImportMappingQuery(batch.id, batch.updatedAt)
  return (
    <>
      <section aria-label="Column mapping" className="space-y-3">
        {mapping.isPending ? (
          <LoadingState label="Reading the column mapping…" />
        ) : mapping.isError ? (
          <ErrorState title="The column mapping could not be read" error={mapping.error} onRetry={() => void mapping.refetch()} />
        ) : (
          <MappingEditor key={fingerprint(mapping.data)} batch={batch} mapping={mapping.data} />
        )}
      </section>
      <RowPreview batch={batch} />
    </>
  )
}

/** Changes when the mapping read from the API changes, so the editor starts again from it. */
function fingerprint(mapping: PortfolioImportMapping): string {
  return `${mapping.source}:${mapping.fields.map((field) => `${field.field}=${field.column ?? ''}`).join('|')}`
}

function toColumnMapping(mapping: PortfolioImportMapping): PortfolioImportColumnMapping {
  const result: PortfolioImportColumnMapping = {}
  for (const field of mapping.fields) if (field.column !== undefined) result[field.field] = field.column
  return result
}

const SOURCE_DESCRIPTION: Record<PortfolioImportMapping['source'], string> = {
  suggested: 'Suggested from the column headings, never from the values. Check each field and change any that is wrong.',
  saved: 'Reused from the last file with these columns in this workspace.',
  applied: 'Applied to this import. The next file with these columns starts from it.',
}

function MappingEditor({ batch, mapping }: { batch: PortfolioImport; mapping: PortfolioImportMapping }) {
  const isWriter = useIsCompanyWriter()
  const save = useSavePortfolioImportMapping(batch.id)
  const initial = toColumnMapping(mapping)
  const [draft, setDraft] = useState<PortfolioImportColumnMapping>(initial)
  const problems = portfolioImportMappingProblems(draft, batch.columns, batch.scope)
  const changed = mapping.fields.some((field) => (draft[field.field] ?? '') !== (field.column ?? ''))
  const columnUse = new Map<string, number>()
  for (const column of Object.values(draft)) if (column) columnUse.set(column, (columnUse.get(column) ?? 0) + 1)

  async function apply() {
    try {
      await save.mutateAsync(draft)
      toast.success('Column mapping applied', { description: 'The rows were checked again with it.' })
    } catch (failure) {
      toast.error('The mapping was not applied', { description: describeApiError(failure, 'Try again in a moment.') })
    }
  }

  return (
    <>
      <SectionHeader
        title="Column mapping"
        description={SOURCE_DESCRIPTION[mapping.source]}
        actions={
          isWriter ? (
            <Button type="button" onClick={() => void apply()} disabled={save.isPending || problems.length > 0 || (!changed && mapping.source === 'applied')}>
              {save.isPending ? 'Applying…' : 'Apply mapping'}
            </Button>
          ) : null
        }
      />
      {mapping.source === 'saved' && mapping.savedAt ? (
        <p className="-mt-2 text-sm text-muted-foreground">
          Saved <DateDisplay value={mapping.savedAt} className="tabular-nums" />.
        </p>
      ) : null}
      <ul aria-label="Column mapping" className="divide-y divide-border/70 border-y border-border">
        {mapping.fields.map((field) => {
          const column = draft[field.field]
          const label = importFieldLabel(field.field)
          const repeated = column !== undefined && (columnUse.get(column) ?? 0) > 1
          return (
            <li key={field.field} className="grid gap-1 py-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
              <span className="text-sm">{label}</span>
              <div className="min-w-0">
                {isWriter ? (
                  <Select
                    value={column ?? NOT_READ}
                    onValueChange={(value) =>
                      setDraft((current) => {
                        const next = { ...current }
                        if (value === NOT_READ) delete next[field.field]
                        else next[field.field] = value
                        return next
                      })
                    }
                  >
                    <SelectTrigger aria-label={`Column for ${label}`} aria-invalid={repeated || undefined} className="w-full max-w-80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOT_READ}>Not in the file</SelectItem>
                      {batch.columns.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className={cn('text-sm', column === undefined && 'text-muted-foreground')}>{column ?? 'Not in the file'}</span>
                )}
                {repeated ? <p className="mt-1 text-xs text-destructive">This column is chosen for another field too.</p> : null}
                {isWriter && field.suggestedColumn !== undefined && field.suggestedColumn !== column ? (
                  <p className="mt-1 text-xs text-muted-foreground">Suggested from the headings: {field.suggestedColumn}</p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

const ROW_COLUMNS: DataTableColumn<PortfolioImportRowCheck>[] = [
  { id: 'row', header: 'Row', align: 'right', className: 'w-14', cell: (row) => <span className="tabular-nums">{row.rowNumber}</span> },
  {
    id: 'result',
    header: 'Result',
    className: 'w-40',
    cell: (row) => <StatusDot tone={IMPORT_ROW_RESULT_DISPLAY[row.result].tone}>{IMPORT_ROW_RESULT_DISPLAY[row.result].label}</StatusDot>,
  },
  {
    id: 'property',
    header: 'Property',
    hideBelow: 'md',
    cell: (row) => {
      const code = row.values.propertyCode
      const name = row.property?.label ?? row.values.propertyName
      if (!code && !name) return <span className="text-muted-foreground">—</span>
      return (
        <span className="text-sm">
          {code ? <span className="font-medium tabular-nums">{code}</span> : null}
          {code && name ? <span className="text-muted-foreground"> · </span> : null}
          {name}
        </span>
      )
    },
  },
  {
    id: 'unit',
    header: 'Unit',
    hideBelow: 'sm',
    cell: (row) => row.values.unitNumber ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: 'tenant',
    header: 'Tenant',
    hideBelow: 'lg',
    cell: (row) =>
      row.tenant ? (
        <span className="grid text-sm">
          <span>{row.tenant.tenant?.label ?? (row.tenant.name || '—')}</span>
          <span className="text-xs text-muted-foreground">{IMPORT_TENANT_RESULT_DISPLAY[row.tenant.result].label}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
]

function RowReason({ row, memberName }: { row: PortfolioImportRowCheck; memberName: (userId: EntityId | undefined) => string | undefined }) {
  return (
    <div className="space-y-2">
      <RowResult row={row} />
      {row.resolution ? <RowChanges row={row} memberName={memberName} /> : null}
    </div>
  )
}

/** What the manager changed on the row, signed off with who changed it and when. */
function RowChanges({ row, memberName }: { row: PortfolioImportRowCheck; memberName: (userId: EntityId | undefined) => string | undefined }) {
  const resolution = row.resolution
  if (!resolution) return null
  return (
    <div className="space-y-1 border-l border-border pl-3 text-xs text-muted-foreground">
      <ul aria-label={`Changes to row ${row.rowNumber}`} className="space-y-0.5">
        {resolution.corrections.map((correction) => (
          <li key={correction.field}>
            <span className="text-foreground">{importFieldLabel(correction.field)}</span>: corrected from{' '}
            {correction.fileValue === undefined ? 'empty' : formatImportValue(correction.field, correction.fileValue)} to{' '}
            {correction.value === '' ? 'empty' : formatImportValue(correction.field, correction.value)}
          </li>
        ))}
        {resolution.linkedProperty ? (
          <li>
            Linked to <span className="text-foreground">{resolution.linkedProperty.label}</span>
            {resolution.linkedUnit ? <>, unit {resolution.linkedUnit.label}</> : null}
          </li>
        ) : resolution.linkedUnit ? (
          <li>
            Linked to unit <span className="text-foreground">{resolution.linkedUnit.label}</span>
          </li>
        ) : null}
        {resolution.linkedTenant ? (
          <li>
            Tenant confirmed as <span className="text-foreground">{resolution.linkedTenant.label}</span>
          </li>
        ) : null}
        {resolution.tenantSuggestionsRejected ? <li>Suggested tenants rejected: a new tenant is created</li> : null}
        {resolution.skipped ? <li>Skipped</li> : null}
      </ul>
      <SignOff by={memberName(resolution.changedByUserId) ?? 'A former member'} at={resolution.changedAt} className="text-xs" />
    </div>
  )
}

function RowResult({ row }: { row: PortfolioImportRowCheck }) {
  if (row.conflicts.length > 0) {
    return (
      <ul className="space-y-1 text-sm">
        {row.conflicts.map((conflict) => (
          <li key={conflict.field}>
            <span className="font-medium">{importFieldLabel(conflict.field)}</span>
            <span className="text-muted-foreground">: the file has </span>
            <span>{formatImportValue(conflict.field, conflict.value)}</span>
            <span className="text-muted-foreground">
              , {conflict.otherRowNumber !== undefined ? `row ${conflict.otherRowNumber} has ` : 'LeaseGuard has '}
            </span>
            <span>{formatImportValue(conflict.field, conflict.existingValue)}</span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <ul className={cn('space-y-1 text-sm', (row.result === 'new' || row.result === 'match' || row.result === 'skipped') && 'text-muted-foreground')}>
      {row.reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  )
}

function RowPreview({ batch }: { batch: PortfolioImport }) {
  const isWriter = useIsCompanyWriter()
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })
  const memberName = (userId: EntityId | undefined) =>
    userId ? members.data?.items.find((member) => member.id.toLowerCase() === userId.toLowerCase())?.fullName : undefined
  const [selected, setSelected] = useState<PortfolioImportRowCheck | undefined>()
  const [result, setResult] = useState<PortfolioImportRowResult | undefined>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const preview = usePortfolioImportPreviewQuery(batch.id, batch.updatedAt, { result, page, pageSize })
  const counts = preview.data?.counts
  const all = counts ? PORTFOLIO_IMPORT_ROW_RESULTS.reduce((sum, key) => sum + counts[key], 0) : undefined

  function choose(next: PortfolioImportRowResult | undefined) {
    setResult(next)
    setPage(1)
  }

  const columns: DataTableColumn<PortfolioImportRowCheck>[] = [
    ...ROW_COLUMNS,
    { id: 'reason', header: 'Reason', cell: (row) => <RowReason row={row} memberName={memberName} /> },
    ...(isWriter
      ? [
          {
            id: 'fix',
            header: 'Fix',
            align: 'right' as const,
            className: 'w-20',
            cell: (row: PortfolioImportRowCheck) => (
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(row)} aria-label={`Fix row ${row.rowNumber}`}>
                Fix
              </Button>
            ),
          },
        ]
      : []),
  ]
  // The drawer follows the row as the preview is read again after each change.
  const selectedRow = selected ? (preview.data?.items.find((row) => row.rowNumber === selected.rowNumber) ?? selected) : undefined

  const filters: { value: PortfolioImportRowResult | undefined; label: string; count: number | undefined }[] = [
    { value: undefined, label: 'All rows', count: all },
    ...PORTFOLIO_IMPORT_ROW_RESULTS.map((value) => ({ value, label: IMPORT_ROW_RESULT_DISPLAY[value].label, count: counts?.[value] })),
  ]

  return (
    <section aria-label="Rows checked" className="space-y-3">
      <SectionHeader
        title="Rows checked"
        description={
          isWriter
            ? 'Each row is checked against the properties, units and tenants already in LeaseGuard. Fix a row to correct a value, link it to an existing record, confirm or reject a suggested tenant, or skip it; you can leave rows unresolved and come back to this import later. Nothing is added until the import is approved.'
            : 'Each row is checked against the properties, units and tenants already in LeaseGuard. Nothing is added until the import is approved.'
        }
      />
      <div role="group" aria-label="Show rows" className="flex flex-wrap gap-x-1 gap-y-1 border-b border-border">
        {filters.map((filter) => {
          const active = filter.value === result
          return (
            <button
              key={filter.label}
              type="button"
              aria-pressed={active}
              onClick={() => choose(filter.value)}
              className={cn(
                '-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                active ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {filter.label}
              {filter.count !== undefined ? <span className="text-xs tabular-nums text-muted-foreground">{formatCount(filter.count)}</span> : null}
            </button>
          )
        })}
      </div>
      <DataTable
        caption={`Rows of ${batch.fileName} checked against LeaseGuard`}
        columns={columns}
        rows={preview.data?.items ?? []}
        getRowId={(row) => String(row.rowNumber)}
        isLoading={preview.isPending}
        error={preview.isError ? preview.error : null}
        onRetry={() => void preview.refetch()}
        emptyState={
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {result ? `No rows are ${IMPORT_ROW_RESULT_DISPLAY[result].label.toLowerCase()}.` : 'The file has no rows.'}
          </p>
        }
        {...(preview.data && preview.data.total > 0
          ? {
              pagination: {
                page,
                pageSize,
                total: preview.data.total,
                onPageChange: setPage,
                onPageSizeChange: (size: number) => {
                  setPageSize(size)
                  setPage(1)
                },
              },
            }
          : {})}
      />
      {selectedRow ? (
        <RowResolutionDrawer
          key={selectedRow.rowNumber}
          batch={batch}
          row={selectedRow}
          open
          onOpenChange={(open) => {
            if (!open) setSelected(undefined)
          }}
          memberName={memberName}
        />
      ) : null}
    </section>
  )
}
