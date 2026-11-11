import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PROPERTY_STATUSES, PROPERTY_TYPES, type Property, type PropertyStatus, type PropertyType } from '@leaseguard/domain'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
  DataTable,
  DataTableEmptyState,
  DataTableToolbar,
  NoActiveWorkspace,
  SingleSelectFilter,
  StatusBadge,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { LIST_PAGE_SIZE_OPTIONS, lastPageWhenPastEnd, listSearchTerm } from '@/lib/data/listParams'
import { enumOptions, labelFor } from '@/lib/labels'

import { usePropertyList } from '../api/queries'
import { PROPERTY_SORT_FIELDS, type PropertyListParams } from '../api/source'
import { PropertyFormDialog } from './PropertyFormDialog'

const AREA_FORMAT = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })

const COLUMNS: DataTableColumn<Property>[] = [
  {
    id: 'name',
    header: 'Property',
    sortable: true,
    cell: (property) => (
      <AppLink to={`/properties/${encodeURIComponent(property.id)}`} className="font-medium text-foreground hover:underline">
        {property.name}
      </AppLink>
    ),
  },
  { id: 'code', header: 'Code', sortable: true, hideBelow: 'sm', cell: (property) => <span className="font-mono text-xs">{property.code}</span> },
  { id: 'type', header: 'Type', hideBelow: 'md', cell: (property) => labelFor(property.type) },
  {
    id: 'location',
    header: 'Location',
    hideBelow: 'lg',
    cell: (property) => `${property.address.city}, ${property.address.province}`,
  },
  {
    id: 'gla',
    header: 'GLA (m²)',
    align: 'right',
    hideBelow: 'lg',
    cell: (property) => <span className="tabular-nums">{AREA_FORMAT.format(property.grossLettableAreaSqm)}</span>,
  },
  { id: 'status', header: 'Status', cell: (property) => <StatusBadge status={property.status} /> },
]

const STATUS_OPTIONS = enumOptions(PROPERTY_STATUSES)
const TYPE_OPTIONS = enumOptions(PROPERTY_TYPES)

function isSortField(field: string): field is (typeof PROPERTY_SORT_FIELDS)[number] {
  return (PROPERTY_SORT_FIELDS as readonly string[]).includes(field)
}

export interface PropertyListScreenProps {
  params: PropertyListParams
  /** Called with the complete next list state (the route stores it in the URL). */
  onParamsChange: (next: PropertyListParams) => void
}

/**
 * Properties of the active workspace: search, status/type filters, sorting and paging, with
 * loading, error, empty and no-workspace states. Rows open the property detail screen. This is the
 * reference list screen for the other features.
 */
export function PropertyListScreen({ params, onParamsChange }: PropertyListScreenProps) {
  const navigate = useNavigate()
  const query = usePropertyList(params)
  const isWriter = useIsCompanyWriter()
  const [adding, setAdding] = useState(false)
  const isFiltered = listSearchTerm(params.search) !== undefined || params.status !== undefined || params.type !== undefined

  /** Changing search, filters, sort or page size returns to page 1. */
  const update = (patch: Partial<PropertyListParams>) => onParamsChange({ ...params, page: 1, ...patch })
  const clearFilters = () => update({ search: undefined, status: undefined, type: undefined })
  const sort: DataTableSort | undefined = params.sort ? { field: params.sort, direction: params.direction ?? 'asc' } : undefined

  // A page past the end of a non-empty list (stale link, workspace switch, records removed) moves to
  // the last page instead of showing an empty list with no way back.
  const settled = query.isPlaceholderData ? undefined : query.data
  const lastPage = settled ? lastPageWhenPastEnd(params.page, settled) : null
  useEffect(() => {
    if (lastPage !== null) onParamsChange({ ...params, page: lastPage })
  }, [lastPage, params, onParamsChange])

  const addButton = isWriter ? (
    <Button type="button" onClick={() => setAdding(true)}>
      <Plus aria-hidden="true" />
      Add property
    </Button>
  ) : null
  const header = (
    <PageHeader title="Properties" description="Every property in this workspace. Open one to see its units, active leases and the monitoring events that need attention." actions={addButton} />
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
          caption="Properties in this workspace"
          columns={COLUMNS}
          rows={page?.items ?? []}
          getRowId={(property) => property.id}
          isLoading={query.isPending || isPastEnd}
          error={query.isError ? query.error : null}
          onRetry={() => void query.refetch()}
          sort={sort}
          onSortChange={(next) => {
            if (isSortField(next.field)) update({ sort: next.field, direction: next.direction })
          }}
          onRowClick={(property) => void navigate({ to: '/properties/$propertyId', params: { propertyId: property.id } })}
          emptyState={
            <DataTableEmptyState
              isFiltered={isFiltered}
              onClearFilters={clearFilters}
              {...(isFiltered
                ? {}
                : {
                    title: 'No properties yet',
                    description: isWriter ? 'Add the first property of this workspace.' : 'Properties added to this workspace appear here.',
                  })}
            />
          }
          toolbar={
            <DataTableToolbar
              search={{
                value: params.search ?? '',
                onChange: (search) => update({ search: search.trim() === '' ? undefined : search }),
                placeholder: 'Search name, code or description…',
                label: 'Search properties',
              }}
              filters={
                <>
                  <SingleSelectFilter<PropertyStatus>
                    label="Status"
                    allLabel="All statuses"
                    value={params.status}
                    options={STATUS_OPTIONS}
                    onChange={(status) => update({ status })}
                  />
                  <SingleSelectFilter<PropertyType>
                    label="Type"
                    allLabel="All types"
                    value={params.type}
                    options={TYPE_OPTIONS}
                    onChange={(type) => update({ type })}
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
        <PropertyFormDialog
          open={adding}
          onOpenChange={setAdding}
          onSaved={(property) => void navigate({ to: '/properties/$propertyId', params: { propertyId: property.id } })}
        />
      ) : null}
    </section>
  )
}
