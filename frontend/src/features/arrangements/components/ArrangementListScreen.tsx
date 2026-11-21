import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  ARRANGEMENT_STATUSES,
  arrangementProgress,
  isoToday,
  nextInstallment,
  overdueInstallments,
  shouldSuppressArrearsReminder,
  type ArrangementStatus,
  type ISODate,
  type PaymentArrangementListItem,
} from '@leaseguard/domain'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
  CurrencyDisplay,
  DataTable,
  DataTableEmptyState,
  DataTableToolbar,
  DateDisplay,
  NoActiveWorkspace,
  SingleSelectFilter,
  StatusBadge,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { usePropertyList } from '@/features/properties/api/queries'
import { useTenantList } from '@/features/tenants/api/queries'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { LIST_PAGE_SIZE_OPTIONS, MAX_LIST_PAGE_SIZE, lastPageWhenPastEnd, listSearchTerm } from '@/lib/data/listParams'
import { enumOptions } from '@/lib/labels'

import { useArrangementList } from '../api/queries'
import { ARRANGEMENT_SORT_FIELDS } from '../api/source'
import type { ArrangementListSearch } from '../listSearch'
import { ArrangementFormDialog } from './ArrangementFormDialog'

const STATUS_OPTIONS = enumOptions(ARRANGEMENT_STATUSES)

/** The filters a "clear" removes; paging and sort stay. */
const FILTER_KEYS = ['search', 'status', 'propertyId', 'tenantId'] as const

function isSortField(field: string): field is (typeof ARRANGEMENT_SORT_FIELDS)[number] {
  return (ARRANGEMENT_SORT_FIELDS as readonly string[]).includes(field)
}

/** Options for a filter whose list may not hold the selected value (another page of records): it still shows as selected. */
function withSelected(options: { value: string; label: string }[], selected: string | undefined, fallback: string) {
  if (selected && !options.some((option) => option.value === selected)) return [...options, { value: selected, label: fallback }]
  return options
}

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>

function columns(today: ISODate): DataTableColumn<PaymentArrangementListItem>[] {
  return [
    {
      id: 'tenant',
      header: 'Tenant',
      rowHeader: true,
      cell: (arrangement) => (
        <AppLink to={`/arrangements/${encodeURIComponent(arrangement.id)}`} className="font-medium text-foreground hover:underline">
          {arrangement.tenantName || 'Tenant'}
        </AppLink>
      ),
    },
    {
      id: 'property',
      header: 'Property and unit',
      hideBelow: 'md',
      cell: (arrangement) => (
        <span>
          {arrangement.propertyName || muted('—')}
          <span className="text-muted-foreground"> · </span>
          <span className="tabular-nums">{arrangement.unitNumber}</span>
        </span>
      ),
    },
    { id: 'lease', header: 'Lease', hideBelow: 'lg', cell: (arrangement) => <span className="tabular-nums">{arrangement.leaseReference}</span> },
    {
      id: 'status',
      header: 'Status',
      cell: (arrangement) => (
        <div className="flex flex-col gap-0.5">
          <StatusBadge status={arrangement.status} />
          {shouldSuppressArrearsReminder(arrangement.tenantId, [arrangement], today) ? (
            <span className="text-xs text-muted-foreground">Arrears reminders paused</span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'balance',
      header: 'Balance agreed',
      align: 'right',
      cell: (arrangement) => <CurrencyDisplay amount={arrangement.outstandingBalance} />,
    },
    {
      id: 'progress',
      header: 'Instalments paid',
      hideBelow: 'sm',
      cell: (arrangement) => {
        const progress = arrangementProgress(arrangement)
        const overdue = arrangement.status === 'active' ? overdueInstallments(arrangement, today).length : 0
        return (
          <div className="flex flex-col gap-0.5 tabular-nums">
            <span>
              {progress.paidCount} of {progress.totalCount}
            </span>
            {overdue > 0 ? <span className="text-xs text-muted-foreground">{overdue} past due, not confirmed</span> : null}
          </div>
        )
      },
    },
    {
      id: 'next',
      header: 'Next instalment',
      hideBelow: 'md',
      cell: (arrangement) => {
        const next = arrangement.status === 'active' || arrangement.status === 'proposed' ? nextInstallment(arrangement, today) : undefined
        if (!next) return muted('—')
        return (
          <span className="whitespace-nowrap tabular-nums">
            <DateDisplay value={next.dueDate} />
            <span className="text-muted-foreground"> · </span>
            <CurrencyDisplay amount={next.amount} />
          </span>
        )
      },
    },
    { id: 'agreedOn', header: 'Agreed', sortable: true, hideBelow: 'sm', cell: (arrangement) => <DateDisplay value={arrangement.agreedOn} /> },
    {
      id: 'firstInstallmentDate',
      header: 'First instalment',
      sortable: true,
      hideBelow: 'lg',
      cell: (arrangement) => <DateDisplay value={arrangement.firstInstallmentDate} />,
    },
  ]
}

export interface ArrangementListScreenProps {
  params: ArrangementListSearch
  /** Called with the complete next list state (the route stores it in the URL). */
  onParamsChange: (next: ArrangementListSearch) => void
}

/**
 * Payment arrangements of the active workspace: status, property and tenant filters, a search on the notes, sorting
 * and paging, all kept in the URL. Each row names its tenant, property, unit and lease (from the API) and shows its
 * progress and next instalment worked out by `@leaseguard/domain`. These are records of what tenants agreed; LeaseGuard
 * never takes a payment. Company admins and property managers record new ones here.
 */
export function ArrangementListScreen({ params, onParamsChange }: ArrangementListScreenProps) {
  const navigate = useNavigate()
  const isWriter = useIsCompanyWriter()
  const [recording, setRecording] = useState(false)
  const query = useArrangementList(params)
  const options = { page: 1, pageSize: MAX_LIST_PAGE_SIZE, direction: 'asc' } as const
  const properties = usePropertyList({ ...options, sort: 'name' })
  const tenants = useTenantList({ ...options, sort: 'tradingName', ...(params.propertyId ? { propertyId: params.propertyId } : {}) })
  // The date when the screen opened; progress and the next instalment are worked out as of this day.
  const [today] = useState(() => isoToday(new Date()))

  const isFiltered = listSearchTerm(params.search) !== undefined || FILTER_KEYS.some((key) => key !== 'search' && params[key] !== undefined)

  /** Changing search, filters, sort or page size returns to page 1. */
  const update = (patch: Partial<ArrangementListSearch>) => onParamsChange({ ...params, page: 1, ...patch })
  const clearFilters = () => update(Object.fromEntries(FILTER_KEYS.map((key) => [key, undefined])))
  const sort: DataTableSort = { field: params.sort, direction: params.direction }

  // A page past the end of a non-empty list (stale link, workspace switch) moves to the last page.
  const settled = query.isPlaceholderData ? undefined : query.data
  const lastPage = settled ? lastPageWhenPastEnd(params.page, settled) : null
  useEffect(() => {
    if (lastPage !== null) onParamsChange({ ...params, page: lastPage })
  }, [lastPage, params, onParamsChange])

  const propertyOptions = withSelected(
    (properties.data?.items ?? []).map((property) => ({ value: property.id, label: property.name })),
    params.propertyId,
    'Selected property',
  )
  const tenantOptions = withSelected(
    (tenants.data?.items ?? []).map((tenant) => ({ value: tenant.id, label: tenant.tradingName })),
    params.tenantId,
    'Selected tenant',
  )

  const header = (
    <PageHeader
      title="Payment arrangements"
      description="What tenants agreed to pay off their arrears, and each instalment's outcome. LeaseGuard keeps the record; it never takes or processes a payment."
      actions={
        isWriter ? (
          <Button type="button" onClick={() => setRecording(true)}>
            <Plus aria-hidden="true" />
            Record arrangement
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
  // Records exist but this page has none: keep loading while moving to the last page, never "no arrangements yet".
  const isPastEnd = page !== undefined && page.items.length === 0 && page.total > 0
  return (
    <section>
      {header}
      <div aria-busy={query.isFetching || undefined}>
        <DataTable
          caption="Payment arrangements in this workspace"
          columns={columns(today)}
          rows={page?.items ?? []}
          getRowId={(arrangement) => arrangement.id}
          isLoading={query.isPending || isPastEnd}
          error={query.isError ? query.error : null}
          onRetry={() => void query.refetch()}
          sort={sort}
          onSortChange={(next) => {
            if (isSortField(next.field)) update({ sort: next.field, direction: next.direction })
          }}
          onRowClick={(arrangement) => void navigate({ to: '/arrangements/$arrangementId', params: { arrangementId: arrangement.id } })}
          emptyState={
            <DataTableEmptyState
              isFiltered={isFiltered}
              onClearFilters={clearFilters}
              {...(isFiltered
                ? {}
                : {
                    title: 'No payment arrangements yet',
                    description: isWriter
                      ? 'Record an arrangement when a tenant agrees to pay off arrears in instalments. Normal arrears reminders pause while it is active.'
                      : 'Arrangements recorded in this workspace appear here.',
                  })}
            />
          }
          toolbar={
            <DataTableToolbar
              search={{
                value: params.search ?? '',
                onChange: (search) => update({ search: search.trim() === '' ? undefined : search }),
                placeholder: 'Search notes…',
                label: 'Search payment arrangements',
              }}
              filters={
                <>
                  <SingleSelectFilter<ArrangementStatus>
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
                    // Tenants are listed for the chosen property, so a tenant chosen for another goes.
                    onChange={(propertyId) => update({ propertyId, tenantId: undefined })}
                  />
                  <SingleSelectFilter<string>
                    label="Tenant"
                    allLabel="All tenants"
                    value={params.tenantId}
                    options={tenantOptions}
                    onChange={(tenantId) => update({ tenantId })}
                  />
                </>
              }
              actions={
                isFiltered ? (
                  <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
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
      {isWriter ? (
        <ArrangementFormDialog
          open={recording}
          onOpenChange={setRecording}
          {...(params.tenantId ? { initialTenantId: params.tenantId } : {})}
          onSaved={(arrangement) => void navigate({ to: '/arrangements/$arrangementId', params: { arrangementId: arrangement.id } })}
        />
      ) : null}
    </section>
  )
}
