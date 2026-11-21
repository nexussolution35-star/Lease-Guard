import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EXPIRING_WITHIN_DAY_OPTIONS, LEASE_STATUSES, type LeaseListItem, type LeaseStatus } from '@leaseguard/domain'

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
  VerificationBadge,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { usePropertyList } from '@/features/properties/api/queries'
import { useMemberList } from '@/features/users/api/queries'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { LIST_PAGE_SIZE_OPTIONS, MAX_LIST_PAGE_SIZE, lastPageWhenPastEnd, listSearchTerm } from '@/lib/data/listParams'
import { enumOptions } from '@/lib/labels'

import { useLeaseList } from '../api/queries'
import { LEASE_SORT_FIELDS } from '../api/source'
import { leaseListParamsFrom, type LeaseListSearch, type LeaseVerificationFilter } from '../listSearch'
import { LeaseFormDialog } from './LeaseFormDialog'

const STATUS_OPTIONS = enumOptions(LEASE_STATUSES)
const VERIFICATION_OPTIONS: readonly { value: LeaseVerificationFilter; label: string }[] = [
  { value: 'unverified', label: 'Unverified' },
  { value: 'verified', label: 'Verified' },
]
const EXPIRING_OPTIONS = EXPIRING_WITHIN_DAY_OPTIONS.map((days) => ({ value: String(days), label: `Expiring within ${days} days` }))

function isSortField(field: string): field is (typeof LEASE_SORT_FIELDS)[number] {
  return (LEASE_SORT_FIELDS as readonly string[]).includes(field)
}

function columns(verifierName: (lease: LeaseListItem) => string | undefined): DataTableColumn<LeaseListItem>[] {
  return [
    {
      id: 'reference',
      header: 'Lease',
      sortable: true,
      cell: (lease) => (
        <AppLink to={`/leases/${encodeURIComponent(lease.id)}`} className="font-medium text-foreground tabular-nums hover:underline">
          {lease.reference}
        </AppLink>
      ),
    },
    { id: 'tenant', header: 'Tenant', cell: (lease) => lease.tenantName },
    {
      id: 'property',
      header: 'Property and unit',
      hideBelow: 'md',
      cell: (lease) => (
        <span>
          {lease.propertyName}
          <span className="text-muted-foreground"> · </span>
          <span className="tabular-nums">{lease.unitNumber}</span>
        </span>
      ),
    },
    { id: 'commencementDate', header: 'Starts', sortable: true, hideBelow: 'lg', cell: (lease) => <DateDisplay value={lease.commencementDate} /> },
    { id: 'expiryDate', header: 'Expires', sortable: true, hideBelow: 'sm', cell: (lease) => <DateDisplay value={lease.expiryDate} /> },
    {
      id: 'currentMonthlyRental',
      header: 'Monthly rental',
      sortable: true,
      align: 'right',
      hideBelow: 'lg',
      cell: (lease) => <CurrencyDisplay amount={lease.currentMonthlyRental} tone="none" />,
    },
    { id: 'status', header: 'Status', cell: (lease) => <StatusBadge status={lease.status} /> },
    {
      id: 'verification',
      header: 'Terms',
      cell: (lease) => {
        const by = verifierName(lease)
        return (
          <VerificationBadge
            verified={lease.verified}
            {...(lease.verifiedAt ? { verifiedAt: lease.verifiedAt } : {})}
            {...(by ? { verifiedBy: by } : {})}
          />
        )
      },
    },
  ]
}

export interface LeaseListScreenProps {
  params: LeaseListSearch
  /** Called with the complete next list state (the route stores it in the URL). */
  onParamsChange: (next: LeaseListSearch) => void
}

/**
 * Leases of the active workspace: search by reference or tenant, status, verification, property and
 * "expiring within" filters, sorting and paging, all kept in the URL. Every row carries its verification
 * mark, so unverified terms (not yet used for financial monitoring) stand out. Rows open the lease.
 */
export function LeaseListScreen({ params, onParamsChange }: LeaseListScreenProps) {
  const navigate = useNavigate()
  const isWriter = useIsCompanyWriter()
  const [adding, setAdding] = useState(false)
  const query = useLeaseList(leaseListParamsFrom(params))
  const properties = usePropertyList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'name', direction: 'asc' })
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })
  const memberNames = new Map((members.data?.items ?? []).map((member) => [member.id.toLowerCase(), member.fullName]))
  const verifierName = (lease: LeaseListItem) => (lease.verifiedByUserId ? memberNames.get(lease.verifiedByUserId.toLowerCase()) : undefined)

  const isFiltered =
    listSearchTerm(params.search) !== undefined ||
    params.status !== undefined ||
    params.verification !== undefined ||
    params.propertyId !== undefined ||
    params.expiresWithinDays !== undefined

  /** Changing search, filters, sort or page size returns to page 1. */
  const update = (patch: Partial<LeaseListSearch>) => onParamsChange({ ...params, page: 1, ...patch })
  const clearFilters = () =>
    update({ search: undefined, status: undefined, verification: undefined, propertyId: undefined, expiresWithinDays: undefined })
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

  const header = (
    <PageHeader
      title="Leases"
      description="Every lease in this workspace. Unverified terms are not used for financial monitoring until a person verifies them."
      actions={
        isWriter ? (
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add lease
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
      <div aria-busy={query.isFetching || undefined}>
        <DataTable
          caption="Leases in this workspace"
          columns={columns(verifierName)}
          rows={page?.items ?? []}
          getRowId={(lease) => lease.id}
          isLoading={query.isPending || isPastEnd}
          error={query.isError ? query.error : null}
          onRetry={() => void query.refetch()}
          sort={sort}
          onSortChange={(next) => {
            if (isSortField(next.field)) update({ sort: next.field, direction: next.direction })
          }}
          onRowClick={(lease) => void navigate({ to: '/leases/$leaseId', params: { leaseId: lease.id } })}
          emptyState={
            <DataTableEmptyState
              isFiltered={isFiltered}
              onClearFilters={clearFilters}
              {...(isFiltered ? {} : { title: 'No leases yet', description: isWriter ? 'Add the first lease of this workspace.' : 'Leases added to this workspace appear here.' })}
            />
          }
          toolbar={
            <DataTableToolbar
              search={{
                value: params.search ?? '',
                onChange: (search) => update({ search: search.trim() === '' ? undefined : search }),
                placeholder: 'Search lease reference or tenant…',
                label: 'Search leases',
              }}
              filters={
                <>
                  <SingleSelectFilter<LeaseStatus>
                    label="Status"
                    allLabel="All statuses"
                    value={params.status}
                    options={STATUS_OPTIONS}
                    onChange={(status) => update({ status })}
                  />
                  <SingleSelectFilter<LeaseVerificationFilter>
                    label="Verification"
                    allLabel="Verified and unverified"
                    value={params.verification}
                    options={VERIFICATION_OPTIONS}
                    onChange={(verification) => update({ verification })}
                  />
                  <SingleSelectFilter<string>
                    label="Property"
                    allLabel="All properties"
                    value={params.propertyId}
                    options={propertyOptions}
                    onChange={(propertyId) => update({ propertyId })}
                  />
                  <SingleSelectFilter<string>
                    label="Expiring within"
                    allLabel="Any expiry date"
                    value={params.expiresWithinDays === undefined ? undefined : String(params.expiresWithinDays)}
                    options={EXPIRING_OPTIONS}
                    onChange={(days) => update({ expiresWithinDays: days === undefined ? undefined : Number(days) })}
                  />
                  {isFiltered ? (
                    <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : null}
                </>
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
        <LeaseFormDialog open={adding} onOpenChange={setAdding} onSaved={(lease) => void navigate({ to: '/leases/$leaseId', params: { leaseId: lease.id } })} />
      ) : null}
    </section>
  )
}
