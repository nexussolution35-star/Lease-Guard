import { useNavigate } from '@tanstack/react-router'
import { RotateCw, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  processingFailed,
  STATEMENT_SOURCES,
  STATEMENT_STATUSES,
  verifiedClosingBalance,
  type StatementListItem,
  type StatementSource,
  type StatementStatus,
} from '@leaseguard/domain'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
  ConfirmationDialog,
  CurrencyDisplay,
  DataTable,
  DataTableEmptyState,
  DataTableToolbar,
  DateDisplay,
  FilterChips,
  NoActiveWorkspace,
  SignOff,
  SingleSelectFilter,
  StatusBadge,
  VerificationBadge,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { usePropertyList } from '@/features/properties/api/queries'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { LIST_PAGE_SIZE_OPTIONS, MAX_LIST_PAGE_SIZE, lastPageWhenPastEnd, listSearchTerm } from '@/lib/data/listParams'
import { enumOptions } from '@/lib/labels'

import { useRetryStatementProcessing, useStatementList, useVerifyStatements } from '../api/queries'
import { STATEMENT_SORT_FIELDS, type StatementsVerificationResult } from '../api/source'
import type { StatementListSearch } from '../listSearch'
import { StatementSelectionBar, StatementVerificationOutcome } from './StatementBulkVerification'

const STATUS_OPTIONS = enumOptions(STATEMENT_STATUSES)
const SOURCE_OPTIONS = STATEMENT_SOURCES.map((source) => ({ value: source, label: source === 'other' ? 'Other system' : source }))

function isSortField(field: string): field is (typeof STATEMENT_SORT_FIELDS)[number] {
  return (STATEMENT_SORT_FIELDS as readonly string[]).includes(field)
}

interface RowActions {
  verifierName: (statement: StatementListItem) => string | undefined
  /** Set for writers: queues a failed statement's processing again. */
  retry?: (statement: StatementListItem) => void
  retryingId?: string
}

/**
 * Status as dot and text; a failed extraction also says why, and writers can queue it again. A statement under review
 * with nothing left unresolved says it is ready to verify.
 */
function StatusCell({ statement, retry, retrying }: { statement: StatementListItem; retry?: RowActions['retry']; retrying: boolean }) {
  if (statement.readyToVerify) {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <StatusBadge status={statement.status} />
        <span className="text-xs text-muted-foreground">Ready to verify</span>
      </div>
    )
  }
  if (!processingFailed(statement)) return <StatusBadge status={statement.status} />
  return (
    <div className="flex max-w-72 flex-col items-start gap-1">
      <StatusBadge status={statement.status} label="Processing failed" />
      <p className="line-clamp-2 text-xs text-muted-foreground" title={statement.processingError}>
        {statement.processingError}
      </p>
      {retry ? (
        <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={() => retry(statement)}>
          <RotateCw aria-hidden="true" className={retrying ? 'motion-safe:animate-spin' : undefined} />
          {retrying ? 'Queueing…' : 'Retry processing'}
        </Button>
      ) : null}
    </div>
  )
}

/** Who verified it and when; statements still waiting on a person carry the pending mark. */
function VerifiedByCell({ statement, by }: { statement: StatementListItem; by: string | undefined }) {
  if (statement.status === 'verified') {
    // No name on record (a former member): the verified mark without initials.
    return by ? <SignOff by={by} at={statement.verifiedAt} /> : <VerificationBadge verified {...(statement.verifiedAt ? { verifiedAt: statement.verifiedAt } : {})} />
  }
  if (statement.status === 'rejected' || statement.status === 'duplicate') {
    return <span className="text-muted-foreground">—</span>
  }
  return <SignOff pendingLabel="Not verified" />
}

function columns({ verifierName, retry, retryingId }: RowActions): DataTableColumn<StatementListItem>[] {
  return [
    {
      id: 'file',
      header: 'Statement',
      cell: (statement) => (
        <div className="flex min-w-0 max-w-64 flex-col">
          <AppLink
            to={`/statements/${encodeURIComponent(statement.id)}`}
            className="truncate font-medium text-foreground hover:underline"
            title={statement.file.fileName}
          >
            {statement.file.fileName}
          </AppLink>
          {statement.statementNumber ? (
            <span className="text-xs text-muted-foreground tabular-nums">No. {statement.statementNumber}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'tenant',
      header: 'Tenant',
      cell: (statement) => statement.tenantName ?? <span className="text-muted-foreground">Not matched</span>,
    },
    {
      id: 'property',
      header: 'Property and unit',
      hideBelow: 'md',
      cell: (statement) => (
        <span>
          {statement.propertyName}
          {statement.unitNumber ? (
            <>
              <span className="text-muted-foreground"> · </span>
              <span className="tabular-nums">{statement.unitNumber}</span>
            </>
          ) : null}
        </span>
      ),
    },
    {
      id: 'period',
      header: 'Period',
      hideBelow: 'sm',
      cell: (statement) =>
        statement.periodStart || statement.periodEnd ? (
          <span className="whitespace-nowrap">
            <DateDisplay value={statement.periodStart} />
            <span className="text-muted-foreground"> – </span>
            <DateDisplay value={statement.periodEnd} />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: 'statementDate', header: 'Statement date', sortable: true, hideBelow: 'lg', cell: (statement) => <DateDisplay value={statement.statementDate} /> },
    {
      id: 'sourceSystem',
      header: 'Source',
      hideBelow: 'lg',
      cell: (statement) => SOURCE_OPTIONS.find((option) => option.value === statement.sourceSystem)?.label ?? statement.sourceSystem,
    },
    { id: 'uploadedAt', header: 'Uploaded', sortable: true, hideBelow: 'lg', cell: (statement) => <DateDisplay value={statement.uploadedAt} /> },
    {
      id: 'closingBalance',
      header: 'Closing balance',
      align: 'right',
      cell: (statement) => <CurrencyDisplay amount={verifiedClosingBalance(statement)} />,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (statement) => <StatusCell statement={statement} {...(retry ? { retry } : {})} retrying={retryingId === statement.id} />,
    },
    { id: 'verifiedBy', header: 'Verified by', hideBelow: 'md', cell: (statement) => <VerifiedByCell statement={statement} by={verifierName(statement)} /> },
  ]
}

export interface StatementListScreenProps {
  params: StatementListSearch
  /** Called with the complete next list state (the route stores it in the URL). */
  onParamsChange: (next: StatementListSearch) => void
  /** Shown between the page header and the list (the route puts the arrears figures here). */
  lead?: ReactNode
}

/**
 * Statements of the active workspace: status, property and source filters, a search on file name and statement
 * number, sorting and paging, all kept in the URL. A closing balance shows only once a person verified the
 * statement, with their sign-off; a statement whose automatic extraction failed says why, and writers can queue it
 * again. Writers can select the statements ready to verify (nothing unresolved, decided by the API) and verify them
 * together; each is verified on its own and the result names any that were not, with why. Rows open the statement.
 */
export function StatementListScreen({ params, onParamsChange, lead }: StatementListScreenProps) {
  const navigate = useNavigate()
  const isWriter = useIsCompanyWriter()
  const query = useStatementList(params)
  const retry = useRetryStatementProcessing()
  const verifyMany = useVerifyStatements()
  const [selection, setSelection] = useState<{ paramsKey: string; ids: string[] }>({ paramsKey: '', ids: [] })
  const [confirmingVerify, setConfirmingVerify] = useState(false)
  const [verification, setVerification] = useState<StatementsVerificationResult | null>(null)
  const properties = usePropertyList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'name', direction: 'asc' })
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })
  const memberNames = new Map((members.data?.items ?? []).map((member) => [member.id.toLowerCase(), member.fullName]))
  const verifierName = (statement: StatementListItem) =>
    statement.verifiedByUserId ? memberNames.get(statement.verifiedByUserId.toLowerCase()) : undefined

  const isFiltered =
    listSearchTerm(params.search) !== undefined ||
    params.status !== undefined ||
    params.propertyId !== undefined ||
    params.sourceSystem !== undefined ||
    params.uploadBatchId !== undefined

  /** Changing search, filters, sort or page size returns to page 1. */
  const update = (patch: Partial<StatementListSearch>) => onParamsChange({ ...params, page: 1, ...patch })
  const clearFilters = () => update({ search: undefined, status: undefined, propertyId: undefined, sourceSystem: undefined, uploadBatchId: undefined })
  const sort: DataTableSort = { field: params.sort, direction: params.direction }

  // A page past the end of a non-empty list (stale link, workspace switch, records removed) moves to
  // the last page instead of showing an empty list with no way back.
  const settled = query.isPlaceholderData ? undefined : query.data
  const lastPage = settled ? lastPageWhenPastEnd(params.page, settled) : null
  useEffect(() => {
    if (lastPage !== null) onParamsChange({ ...params, page: lastPage })
  }, [lastPage, params, onParamsChange])

  const propertyOptions = (properties.data?.items ?? []).map((property) => ({ value: property.id, label: property.name }))
  // A property in the URL that is not among the options (another workspace, or beyond the first 100) still shows as selected.
  if (params.propertyId && !propertyOptions.some((option) => option.value === params.propertyId)) {
    propertyOptions.push({ value: params.propertyId, label: 'Selected property' })
  }

  // Selection belongs to the rows on screen: another page, filter or sort starts with none selected.
  const paramsKey = JSON.stringify(params)
  const selectedIds = selection.paramsKey === paramsKey ? selection.ids : []
  const setSelectedIds = (ids: string[]) => setSelection({ paramsKey, ids })
  const readyIds = new Set((query.data?.items ?? []).filter((statement) => statement.readyToVerify).map((statement) => statement.id))
  const selected = isWriter ? selectedIds.filter((id) => readyIds.has(id)) : []

  async function verifySelected() {
    try {
      const result = await verifyMany.mutateAsync(selected)
      setVerification(result)
      setSelectedIds([])
      const verified = result.verified.length
      const refused = result.notVerified.length
      if (refused === 0) toast.success(verified === 1 ? '1 statement verified' : `${verified} statements verified`)
      else toast.warning(`${verified} verified, ${refused} not verified`, { description: 'The result lists each statement not verified and why.' })
    } catch (error) {
      toast.error('The statements were not verified', { description: describeApiError(error, 'Try again in a moment.') })
      throw error
    }
  }

  async function retryProcessing(statement: StatementListItem) {
    try {
      await retry.mutateAsync(statement.id)
      toast.success(`${statement.file.fileName} queued for processing again`)
    } catch (error) {
      toast.error(`${statement.file.fileName} was not queued`, { description: describeApiError(error, 'Try again in a moment.') })
    }
  }

  const header = (
    <PageHeader
      title="Statements"
      description="Tenant statements uploaded to this workspace. A balance counts for monitoring only once a person verifies the statement."
      actions={
        isWriter ? (
          // While statements are selected, verifying them is the view's one primary action.
          <Button asChild variant={selected.length > 0 ? 'outline' : 'default'}>
            <AppLink to="/statements/upload">
              <Upload aria-hidden="true" />
              Upload statements
            </AppLink>
          </Button>
        ) : null
      }
    />
  )

  if (isAwaitingWorkspace(query)) {
    return (
      <section>
        {header}
        <NoActiveWorkspace />
      </section>
    )
  }

  const page = query.data
  // Records exist but this page has none: keep loading while moving to the last page, never "no records yet".
  const isPastEnd = page !== undefined && page.items.length === 0 && page.total > 0
  return (
    <section>
      {header}
      {lead}
      {verification ? <StatementVerificationOutcome result={verification} onDismiss={() => setVerification(null)} /> : null}
      <ConfirmationDialog
        open={confirmingVerify}
        onOpenChange={setConfirmingVerify}
        title={selected.length === 1 ? 'Verify 1 statement?' : `Verify ${selected.length} statements?`}
        description="Each statement's reviewed values become its monitoring record, signed off by you, and arrears and escalation monitoring runs for its tenant. Each is verified and recorded on its own; any that cannot be verified are listed with the reason."
        confirmLabel="Verify"
        isPending={verifyMany.isPending}
        onConfirm={verifySelected}
      />
      <div aria-busy={query.isFetching || undefined}>
        <DataTable
          caption="Statements in this workspace"
          columns={columns({
            verifierName,
            ...(isWriter ? { retry: (statement: StatementListItem) => void retryProcessing(statement) } : {}),
            ...(retry.isPending && retry.variables ? { retryingId: retry.variables } : {}),
          })}
          rows={page?.items ?? []}
          getRowId={(statement) => statement.id}
          {...(isWriter && readyIds.size > 0
            ? {
                selectable: true,
                selectedIds: selected,
                onSelectionChange: setSelectedIds,
                isRowSelectable: (statement: StatementListItem) => statement.readyToVerify,
                rowSelectionLabel: (statement: StatementListItem) => `Select ${statement.file.fileName} to verify`,
              }
            : {})}
          isLoading={query.isPending || isPastEnd}
          error={query.isError ? query.error : null}
          onRetry={() => void query.refetch()}
          sort={sort}
          onSortChange={(next) => {
            if (isSortField(next.field)) update({ sort: next.field, direction: next.direction })
          }}
          onRowClick={(statement) => void navigate({ to: '/statements/$statementId', params: { statementId: statement.id } })}
          emptyState={
            <DataTableEmptyState
              isFiltered={isFiltered}
              onClearFilters={clearFilters}
              {...(isFiltered
                ? {}
                : {
                    title: 'No statements yet',
                    description: isWriter ? 'Upload the first tenant statements of this workspace.' : 'Statements uploaded to this workspace appear here.',
                  })}
            />
          }
          toolbar={
            <>
              <DataTableToolbar
                search={{
                  value: params.search ?? '',
                  onChange: (search) => update({ search: search.trim() === '' ? undefined : search }),
                  placeholder: 'Search file name or statement number…',
                  label: 'Search statements',
                }}
                filters={
                  <>
                    <SingleSelectFilter<StatementStatus>
                      label="Status"
                      allLabel="All statuses"
                      value={params.status}
                      options={STATUS_OPTIONS}
                      onChange={(status) => update({ status })}
                    />
                    <SingleSelectFilter<string>
                      label="Property"
                      allLabel="All properties"
                      value={params.propertyId}
                      options={propertyOptions}
                      onChange={(propertyId) => update({ propertyId })}
                    />
                    <SingleSelectFilter<StatementSource>
                      label="Source"
                      allLabel="All source systems"
                      value={params.sourceSystem}
                      options={SOURCE_OPTIONS}
                      onChange={(sourceSystem) => update({ sourceSystem })}
                    />
                    {params.uploadBatchId ? (
                      <FilterChips chips={[{ id: 'uploadBatchId', label: 'One upload batch', onRemove: () => update({ uploadBatchId: undefined }) }]} />
                    ) : null}
                    {isFiltered ? (
                      <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : null}
                  </>
                }
              />
              {selected.length > 0 ? (
                <StatementSelectionBar
                  count={selected.length}
                  isPending={verifyMany.isPending}
                  onVerify={() => setConfirmingVerify(true)}
                  onClear={() => setSelectedIds([])}
                />
              ) : null}
            </>
          }
          {...(page && !isPastEnd
            ? {
                pagination: {
                  page: page.page,
                  pageSize: page.pageSize,
                  total: page.total,
                  pageSizeOptions: [...LIST_PAGE_SIZE_OPTIONS],
                  onPageChange: (next: number) => onParamsChange({ ...params, page: next }),
                  onPageSizeChange: (pageSize: number) => update({ pageSize }),
                },
              }
            : {})}
        />
      </div>
    </section>
  )
}
