import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { OCCUPANCY_STATUSES, UNIT_TYPES, type EntityId, type OccupancyStatus, type UnitListItem, type UnitType } from '@leaseguard/domain'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
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
import { usePropertyList } from '@/features/properties/api/queries'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { LIST_PAGE_SIZE_OPTIONS, MAX_LIST_PAGE_SIZE, lastPageWhenPastEnd, listSearchTerm } from '@/lib/data/listParams'
import { enumOptions, labelFor } from '@/lib/labels'

import { useUnitList } from '../api/queries'
import { UNIT_SORT_FIELDS, type UnitListParams } from '../api/source'

const AREA_FORMAT = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 })

const NONE = <span className="text-muted-foreground">—</span>

const COLUMNS: DataTableColumn<UnitListItem>[] = [
  {
    id: 'unitNumber',
    header: 'Unit',
    sortable: true,
    cell: (unit) => (
      <AppLink to={`/units/${encodeURIComponent(unit.id)}`} className="font-medium text-foreground hover:underline">
        {unit.unitNumber}
      </AppLink>
    ),
  },
  {
    id: 'property',
    header: 'Property',
    hideBelow: 'sm',
    cell: (unit) => (
      <AppLink to={`/properties/${encodeURIComponent(unit.property.id)}`} className="text-foreground hover:underline">
        {unit.property.name}
      </AppLink>
    ),
  },
  { id: 'type', header: 'Type', hideBelow: 'lg', cell: (unit) => labelFor(unit.type) },
  {
    id: 'floorAreaSqm',
    header: 'Floor area (m²)',
    sortable: true,
    align: 'right',
    hideBelow: 'lg',
    cell: (unit) => <span className="tabular-nums">{AREA_FORMAT.format(unit.floorAreaSqm)}</span>,
  },
  {
    id: 'tenant',
    header: 'Tenant',
    cell: (unit) =>
      unit.currentTenant ? (
        <AppLink to={`/tenants/${encodeURIComponent(unit.currentTenant.id)}`} className="text-foreground hover:underline">
          {unit.currentTenant.tradingName}
        </AppLink>
      ) : (
        NONE
      ),
  },
  {
    id: 'lease',
    header: 'Lease',
    hideBelow: 'md',
    cell: (unit) =>
      unit.currentLease ? (
        <span className="flex flex-col">
          <AppLink to={`/leases/${encodeURIComponent(unit.currentLease.id)}`} className="text-foreground tabular-nums hover:underline">
            {unit.currentLease.reference}
          </AppLink>
          <span className="text-xs text-muted-foreground">
            Expires <DateDisplay value={unit.currentLease.expiryDate} className="tabular-nums" />
          </span>
        </span>
      ) : (
        NONE
      ),
  },
  { id: 'occupancyStatus', header: 'Occupancy', sortable: true, cell: (unit) => <StatusBadge status={unit.occupancyStatus} /> },
]

const TYPE_OPTIONS = enumOptions(UNIT_TYPES)
const OCCUPANCY_OPTIONS = enumOptions(OCCUPANCY_STATUSES)

function isSortField(field: string): field is (typeof UNIT_SORT_FIELDS)[number] {
  return (UNIT_SORT_FIELDS as readonly string[]).includes(field)
}

/** The workspace's properties for the property filter, by name (the first page the API allows). */
function usePropertyOptions(): { value: EntityId; label: string }[] {
  const properties = usePropertyList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'name', direction: 'asc' })
  return (properties.data?.items ?? []).map((property) => ({ value: property.id, label: property.name }))
}

export interface UnitListScreenProps {
  params: UnitListParams
  /** Called with the complete next list state (the route stores it in the URL). */
  onParamsChange: (next: UnitListParams) => void
}

/**
 * Units of the active workspace: search by unit number, property / unit type / occupancy filters,
 * sorting and paging, with loading, error, empty and no-workspace states. An occupied unit shows the
 * tenant and lease of its active lease. Rows open the unit detail screen. Units are added from their
 * property, so this view has no primary action of its own.
 */
export function UnitListScreen({ params, onParamsChange }: UnitListScreenProps) {
  const navigate = useNavigate()
  const query = useUnitList(params)
  const propertyOptions = usePropertyOptions()
  const isFiltered =
    listSearchTerm(params.search) !== undefined ||
    params.propertyId !== undefined ||
    params.type !== undefined ||
    params.occupancyStatus !== undefined

  /** Changing search, filters, sort or page size returns to page 1. */
  const update = (patch: Partial<UnitListParams>) => onParamsChange({ ...params, page: 1, ...patch })
  const clearFilters = () => update({ search: undefined, propertyId: undefined, type: undefined, occupancyStatus: undefined })
  const sort: DataTableSort | undefined = params.sort ? { field: params.sort, direction: params.direction ?? 'asc' } : undefined

  // A page past the end of a non-empty list (stale link, workspace switch, records removed) moves to
  // the last page instead of showing an empty list with no way back.
  const settled = query.isPlaceholderData ? undefined : query.data
  const lastPage = settled ? lastPageWhenPastEnd(params.page, settled) : null
  useEffect(() => {
    if (lastPage !== null) onParamsChange({ ...params, page: lastPage })
  }, [lastPage, params, onParamsChange])

  const header = (
    <PageHeader
      title="Units"
      description="Every lettable unit in this workspace, with its occupancy and, when let, the tenant and lease in force."
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
          caption="Units in this workspace"
          columns={COLUMNS}
          rows={page?.items ?? []}
          getRowId={(unit) => unit.id}
          isLoading={query.isPending || isPastEnd}
          error={query.isError ? query.error : null}
          onRetry={() => void query.refetch()}
          sort={sort}
          onSortChange={(next) => {
            if (isSortField(next.field)) update({ sort: next.field, direction: next.direction })
          }}
          onRowClick={(unit) => void navigate({ to: '/units/$unitId', params: { unitId: unit.id } })}
          emptyState={
            <DataTableEmptyState
              isFiltered={isFiltered}
              onClearFilters={clearFilters}
              {...(isFiltered
                ? {}
                : { title: 'No units yet', description: 'Units added to the properties of this workspace appear here.' })}
            />
          }
          toolbar={
            <DataTableToolbar
              search={{
                value: params.search ?? '',
                onChange: (search) => update({ search: search.trim() === '' ? undefined : search }),
                placeholder: 'Search unit number…',
                label: 'Search units',
              }}
              filters={
                <>
                  <SingleSelectFilter<EntityId>
                    label="Property"
                    allLabel="All properties"
                    value={params.propertyId}
                    options={propertyOptions}
                    onChange={(propertyId) => update({ propertyId })}
                  />
                  <SingleSelectFilter<UnitType>
                    label="Unit type"
                    allLabel="All unit types"
                    value={params.type}
                    options={TYPE_OPTIONS}
                    onChange={(type) => update({ type })}
                  />
                  <SingleSelectFilter<OccupancyStatus>
                    label="Occupancy"
                    allLabel="All occupancy"
                    value={params.occupancyStatus}
                    options={OCCUPANCY_OPTIONS}
                    onChange={(occupancyStatus) => update({ occupancyStatus })}
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
    </section>
  )
}
