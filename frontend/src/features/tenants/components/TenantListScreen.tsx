import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TENANT_STATUSES, type EntityId, type TenantListItem, type TenantStatus } from '@leaseguard/domain'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
  DataTable,
  DataTableEmptyState,
  DataTableToolbar,
  NoActiveWorkspace,
  SingleSelectFilter,
  StatusBadge,
  StatusDot,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { usePropertyList } from '@/features/properties/api'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { LIST_PAGE_SIZE_OPTIONS, MAX_LIST_PAGE_SIZE, lastPageWhenPastEnd, listSearchTerm } from '@/lib/data/listParams'
import { enumOptions } from '@/lib/labels'

import { useTenantList } from '../api/queries'
import { TENANT_SORT_FIELDS, type TenantListParams } from '../api/source'
import { whatsappNumberStatus } from '../whatsappStatus'
import { TenantFormDialog } from './TenantFormDialog'

const NONE = <span className="text-muted-foreground">None</span>

const COLUMNS: DataTableColumn<TenantListItem>[] = [
  {
    id: 'tradingName',
    header: 'Tenant',
    sortable: true,
    cell: (tenant) => (
      <div className="min-w-0">
        <AppLink to={`/tenants/${encodeURIComponent(tenant.id)}`} className="font-medium text-foreground hover:underline">
          {tenant.tradingName}
        </AppLink>
        {tenant.legalName !== tenant.tradingName ? <div className="truncate text-xs text-muted-foreground">{tenant.legalName}</div> : null}
      </div>
    ),
  },
  {
    id: 'contact',
    header: 'Contact person',
    hideBelow: 'md',
    cell: (tenant) => (
      <div className="min-w-0">
        <div>{tenant.primaryContact.fullName}</div>
        <div className="truncate text-xs text-muted-foreground">{tenant.primaryContact.role}</div>
      </div>
    ),
  },
  {
    id: 'unit',
    header: 'Unit',
    hideBelow: 'sm',
    // The units the tenant holds now (by its current lease or assigned without one), else its current lease's unit.
    cell: (tenant) => {
      const [first, ...more] = tenant.currentUnits ?? []
      const unit = first ?? tenant.currentLease
      if (!unit) return NONE
      return (
        <div className="min-w-0">
          <div className="tabular-nums">
            {unit.unitNumber}
            {more.length > 0 ? <span className="text-muted-foreground"> +{more.length} more</span> : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">{unit.propertyName}</div>
        </div>
      )
    },
  },
  {
    id: 'lease',
    header: 'Lease',
    hideBelow: 'lg',
    cell: (tenant) =>
      tenant.currentLease ? (
        <AppLink
          to={`/leases/${encodeURIComponent(tenant.currentLease.leaseId)}`}
          className="tabular-nums text-foreground hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {tenant.currentLease.reference}
        </AppLink>
      ) : (
        NONE
      ),
  },
  {
    id: 'whatsapp',
    header: 'WhatsApp',
    hideBelow: 'md',
    cell: (tenant) => {
      const status = whatsappNumberStatus(tenant)
      return <StatusDot tone={status.tone}>{status.label}</StatusDot>
    },
  },
  { id: 'status', header: 'Status', sortable: true, cell: (tenant) => <StatusBadge status={tenant.status} /> },
]

const STATUS_OPTIONS = enumOptions(TENANT_STATUSES)

/** Every property of the workspace for the property filter (one page at the API maximum). */
const PROPERTY_OPTIONS_PARAMS = { page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'name', direction: 'asc' } as const

function isSortField(field: string): field is (typeof TENANT_SORT_FIELDS)[number] {
  return (TENANT_SORT_FIELDS as readonly string[]).includes(field)
}

export interface TenantListScreenProps {
  params: TenantListParams
  /** Called with the complete next list state (the route stores it in the URL). */
  onParamsChange: (next: TenantListParams) => void
}

/**
 * Tenants of the active workspace: search, status and property filters, sorting and paging. Each row shows the
 * contact person, the unit and lease reference of the tenant's current lease, whether its WhatsApp number is
 * validated, and its status in words. Rows open the tenant detail screen; writers add tenants.
 */
export function TenantListScreen({ params, onParamsChange }: TenantListScreenProps) {
  const navigate = useNavigate()
  const isWriter = useIsCompanyWriter()
  const [adding, setAdding] = useState(false)
  const query = useTenantList(params)
  const properties = usePropertyList(PROPERTY_OPTIONS_PARAMS)
  const propertyOptions = (properties.data?.items ?? []).map((property) => ({ value: property.id as EntityId, label: property.name }))
  const isFiltered = listSearchTerm(params.search) !== undefined || params.status !== undefined || params.propertyId !== undefined

  /** Changing search, filters, sort or page size returns to page 1. */
  const update = (patch: Partial<TenantListParams>) => onParamsChange({ ...params, page: 1, ...patch })
  const clearFilters = () => update({ search: undefined, status: undefined, propertyId: undefined })
  const sort: DataTableSort | undefined = params.sort ? { field: params.sort, direction: params.direction ?? 'asc' } : undefined

  // A page past the end of a non-empty list moves to the last page instead of an empty list with no way back.
  const settled = query.isPlaceholderData ? undefined : query.data
  const lastPage = settled ? lastPageWhenPastEnd(params.page, settled) : null
  useEffect(() => {
    if (lastPage !== null) onParamsChange({ ...params, page: lastPage })
  }, [lastPage, params, onParamsChange])

  const header = (
    <PageHeader
      title="Tenants"
      description="Every tenant in this workspace, with the unit and lease they occupy and whether their WhatsApp number is validated for reminders."
      actions={
        isWriter ? (
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add tenant
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
          caption="Tenants in this workspace"
          columns={COLUMNS}
          rows={page?.items ?? []}
          getRowId={(tenant) => tenant.id}
          isLoading={query.isPending || isPastEnd}
          error={query.isError ? query.error : null}
          onRetry={() => void query.refetch()}
          sort={sort}
          onSortChange={(next) => {
            if (isSortField(next.field)) update({ sort: next.field, direction: next.direction })
          }}
          onRowClick={(tenant) => void navigate({ to: '/tenants/$tenantId', params: { tenantId: tenant.id } })}
          emptyState={
            <DataTableEmptyState
              isFiltered={isFiltered}
              onClearFilters={clearFilters}
              {...(isFiltered
                ? {}
                : { title: 'No tenants yet', description: isWriter ? 'Add the first tenant of this workspace.' : 'Tenants added to this workspace appear here.' })}
            />
          }
          toolbar={
            <DataTableToolbar
              search={{
                value: params.search ?? '',
                onChange: (search) => update({ search: search.trim() === '' ? undefined : search }),
                placeholder: 'Search tenant or contact person…',
                label: 'Search tenants',
              }}
              filters={
                <>
                  <SingleSelectFilter<TenantStatus>
                    label="Status"
                    allLabel="All statuses"
                    value={params.status}
                    options={STATUS_OPTIONS}
                    onChange={(status) => update({ status })}
                  />
                  <SingleSelectFilter<EntityId>
                    label="Property"
                    allLabel="All properties"
                    value={params.propertyId}
                    options={propertyOptions}
                    onChange={(propertyId) => update({ propertyId })}
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
        <TenantFormDialog
          open={adding}
          onOpenChange={setAdding}
          onSaved={(tenant) => void navigate({ to: '/tenants/$tenantId', params: { tenantId: tenant.id } })}
        />
      ) : null}
    </section>
  )
}
