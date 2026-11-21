import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import {
  EVENT_PRIORITIES,
  MONITORING_DUE_WINDOWS,
  MONITORING_EVENT_STATUSES,
  MONITORING_EVENT_TYPES,
  UNASSIGNED_FILTER,
  type EventPriority,
  type MonitoringDueWindow,
  type MonitoringEventListItem,
  type MonitoringEventType,
} from '@leaseguard/domain'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
  DataTable,
  DataTableEmptyState,
  DataTableToolbar,
  DateDisplay,
  NoActiveWorkspace,
  PriorityBadge,
  SingleSelectFilter,
  StatusBadge,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useLeaseList } from '@/features/leases/api/queries'
import { usePropertyList } from '@/features/properties/api/queries'
import { useTenantList } from '@/features/tenants/api/queries'
import { useUnitList } from '@/features/units/api/queries'
import { useMemberList } from '@/features/users/api/queries'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { LIST_PAGE_SIZE_OPTIONS, MAX_LIST_PAGE_SIZE, lastPageWhenPastEnd, listSearchTerm } from '@/lib/data/listParams'
import { enumOptions, labelFor, MONITORING_STATUS_GROUP_LABELS } from '@/lib/labels'

import { useMonitoringEventList } from '../api/queries'
import { MONITORING_EVENT_SORT_FIELDS } from '../api/source'
import {
  MONITORING_STATUS_GROUPS,
  monitoringListParamsFrom,
  type MonitoringListSearch,
  type MonitoringStatusFilter,
} from '../listSearch'

const TYPE_OPTIONS = enumOptions(MONITORING_EVENT_TYPES)
// Highest first: the order a manager scans priorities in.
const PRIORITY_OPTIONS = enumOptions([...EVENT_PRIORITIES].reverse())
const DUE_OPTIONS = enumOptions(MONITORING_DUE_WINDOWS)
const STATUS_OPTIONS: { value: MonitoringStatusFilter; label: string }[] = [
  ...MONITORING_STATUS_GROUPS.map((group) => ({ value: group, label: MONITORING_STATUS_GROUP_LABELS[group] })),
  ...enumOptions(MONITORING_EVENT_STATUSES),
]

/** The filters a "clear" removes; paging and sort stay. */
const FILTER_KEYS = ['search', 'type', 'priority', 'status', 'propertyId', 'unitId', 'tenantId', 'leaseId', 'assignee', 'due'] as const

function isSortField(field: string): field is (typeof MONITORING_EVENT_SORT_FIELDS)[number] {
  return (MONITORING_EVENT_SORT_FIELDS as readonly string[]).includes(field)
}

/** Options for a filter whose list may not hold the selected value (another page of records): it still shows as selected. */
function withSelected(options: { value: string; label: string }[], selected: string | undefined, fallback: string) {
  if (selected && !options.some((option) => option.value === selected)) return [...options, { value: selected, label: fallback }]
  return options
}

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>

function columns(): DataTableColumn<MonitoringEventListItem>[] {
  return [
    {
      id: 'event',
      header: 'Event',
      cell: (event) => (
        <div className="flex min-w-56 max-w-80 flex-col gap-0.5">
          <AppLink to={`/monitoring/${encodeURIComponent(event.id)}`} className="font-medium text-foreground hover:underline">
            {event.title}
          </AppLink>
          <span className="text-xs text-muted-foreground">{labelFor(event.type)}</span>
          <p className="line-clamp-2 text-xs text-muted-foreground" title={event.description}>
            {event.description}
          </p>
        </div>
      ),
    },
    { id: 'priority', header: 'Priority', sortable: true, cell: (event) => <PriorityBadge priority={event.priority} /> },
    { id: 'status', header: 'Status', cell: (event) => <StatusBadge status={event.status} /> },
    {
      id: 'property',
      header: 'Property and unit',
      hideBelow: 'md',
      cell: (event) => (
        <span>
          {event.propertyName || muted('—')}
          {event.unitNumber ? (
            <>
              <span className="text-muted-foreground"> · </span>
              <span className="tabular-nums">{event.unitNumber}</span>
            </>
          ) : null}
        </span>
      ),
    },
    { id: 'tenant', header: 'Tenant', hideBelow: 'lg', cell: (event) => event.tenantName ?? muted('—') },
    {
      id: 'lease',
      header: 'Lease',
      hideBelow: 'lg',
      cell: (event) =>
        event.leaseId ? (
          <AppLink to={`/leases/${encodeURIComponent(event.leaseId)}`} className="whitespace-nowrap tabular-nums hover:underline">
            {event.leaseReference ?? 'Lease'}
          </AppLink>
        ) : (
          (event.leaseReference ?? muted('—'))
        ),
    },
    {
      id: 'recommendedAction',
      header: 'Recommended action',
      hideBelow: 'lg',
      cell: (event) => (
        <p className="line-clamp-2 min-w-48 max-w-72" title={event.recommendedAction}>
          {event.recommendedAction}
        </p>
      ),
    },
    { id: 'identifiedOn', header: 'Identified', sortable: true, hideBelow: 'sm', cell: (event) => <DateDisplay value={event.identifiedOn} /> },
    {
      id: 'dueDate',
      header: 'Due',
      sortable: true,
      cell: (event) => (event.dueDate ? <DateDisplay value={event.dueDate} /> : muted('No due date')),
    },
    {
      id: 'assignee',
      header: 'Assigned to',
      hideBelow: 'md',
      cell: (event) => event.assigneeName ?? muted(event.assignedToUserId ? 'Former member' : 'Unassigned'),
    },
  ]
}

export interface MonitoringEventListScreenProps {
  params: MonitoringListSearch
  /** Called with the complete next list state (the route stores it in the URL). */
  onParamsChange: (next: MonitoringListSearch) => void
}

/**
 * Monitoring events of the active workspace: type, priority, status, property, unit, tenant, lease, due-date and
 * assignee filters, a search on title, description and lease reference, sorting and paging, all kept in the URL.
 * Every row names its property, unit, tenant, lease and assignee (from the API) and shows priority and status as
 * mark and text. Events are raised by monitoring from verified records; nothing is created here. Rows open the event.
 */
export function MonitoringEventListScreen({ params, onParamsChange }: MonitoringEventListScreenProps) {
  const navigate = useNavigate()
  const query = useMonitoringEventList(monitoringListParamsFrom(params))
  const options = { page: 1, pageSize: MAX_LIST_PAGE_SIZE, direction: 'asc' } as const
  const inProperty = params.propertyId ? { propertyId: params.propertyId } : {}
  const properties = usePropertyList({ ...options, sort: 'name' })
  const units = useUnitList({ ...options, sort: 'unitNumber', ...inProperty })
  const tenants = useTenantList({ ...options, sort: 'tradingName', ...inProperty })
  const leases = useLeaseList({ ...options, sort: 'reference', ...inProperty })
  const members = useMemberList({ ...options, sort: 'fullName' })

  const isFiltered = listSearchTerm(params.search) !== undefined || FILTER_KEYS.some((key) => key !== 'search' && params[key] !== undefined)

  /** Changing search, filters, sort or page size returns to page 1. */
  const update = (patch: Partial<MonitoringListSearch>) => onParamsChange({ ...params, page: 1, ...patch })
  const clearFilters = () => update(Object.fromEntries(FILTER_KEYS.map((key) => [key, undefined])))
  const sort: DataTableSort = { field: params.sort, direction: params.direction }

  // A page past the end of a non-empty list (stale link, workspace switch, events closed elsewhere) moves to the last
  // page instead of showing an empty list with no way back.
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
  const unitOptions = withSelected(
    (units.data?.items ?? []).map((unit) => ({
      value: unit.id,
      // Without a property chosen, the property tells units with the same number apart.
      label: params.propertyId ? unit.unitNumber : `${unit.property.name} · ${unit.unitNumber}`,
    })),
    params.unitId,
    'Selected unit',
  )
  const tenantOptions = withSelected(
    (tenants.data?.items ?? []).map((tenant) => ({ value: tenant.id, label: tenant.tradingName })),
    params.tenantId,
    'Selected tenant',
  )
  const leaseOptions = withSelected(
    (leases.data?.items ?? []).map((lease) => ({ value: lease.id, label: `${lease.reference} · ${lease.tenantName}` })),
    params.leaseId,
    'Selected lease',
  )
  const assigneeOptions = withSelected(
    [
      { value: UNASSIGNED_FILTER, label: 'Unassigned' },
      ...(members.data?.items ?? []).map((member) => ({ value: member.id, label: member.fullName })),
    ],
    params.assignee,
    'Selected member',
  )

  const header = (
    <PageHeader
      title="Monitoring"
      description="Findings from verified leases and statements: escalation discrepancies, expiries, renewal deadlines, guarantees, arrears and statements to review. Findings are never sent to tenants."
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
  // Records exist but this page has none: keep loading while moving to the last page, never "no events yet".
  const isPastEnd = page !== undefined && page.items.length === 0 && page.total > 0
  return (
    <section>
      {header}
      <DataTable
        caption="Monitoring events in this workspace"
        columns={columns()}
        rows={page?.items ?? []}
        getRowId={(event) => event.id}
        isLoading={query.isPending || isPastEnd}
        error={query.isError ? query.error : null}
        onRetry={() => void query.refetch()}
        sort={sort}
        onSortChange={(next) => {
          if (isSortField(next.field)) update({ sort: next.field, direction: next.direction })
        }}
        onRowClick={(event) => void navigate({ to: '/monitoring/$eventId', params: { eventId: event.id } })}
        emptyState={
          <DataTableEmptyState
            isFiltered={isFiltered}
            onClearFilters={clearFilters}
            {...(isFiltered
              ? {}
              : {
                  title: 'No monitoring events yet',
                  description:
                    'Monitoring raises events from verified leases and verified statements. They appear here as soon as one is found.',
                })}
          />
        }
        toolbar={
          <DataTableToolbar
            search={{
              value: params.search ?? '',
              onChange: (search) => update({ search: search.trim() === '' ? undefined : search }),
              placeholder: 'Search title, description or lease…',
              label: 'Search monitoring events',
            }}
            filters={
              <>
                <SingleSelectFilter<MonitoringEventType>
                  label="Event type"
                  allLabel="All event types"
                  value={params.type}
                  options={TYPE_OPTIONS}
                  onChange={(type) => update({ type })}
                />
                <SingleSelectFilter<EventPriority>
                  label="Priority"
                  allLabel="All priorities"
                  value={params.priority}
                  options={PRIORITY_OPTIONS}
                  onChange={(priority) => update({ priority })}
                />
                <SingleSelectFilter<MonitoringStatusFilter>
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
                  // Units, tenants and leases are listed for the chosen property, so a choice made for another goes.
                  onChange={(propertyId) => update({ propertyId, unitId: undefined, tenantId: undefined, leaseId: undefined })}
                />
                <SingleSelectFilter<string>
                  label="Unit"
                  allLabel="All units"
                  value={params.unitId}
                  options={unitOptions}
                  onChange={(unitId) => update({ unitId })}
                />
                <SingleSelectFilter<string>
                  label="Tenant"
                  allLabel="All tenants"
                  value={params.tenantId}
                  options={tenantOptions}
                  onChange={(tenantId) => update({ tenantId })}
                />
                <SingleSelectFilter<string>
                  label="Lease"
                  allLabel="All leases"
                  value={params.leaseId}
                  options={leaseOptions}
                  onChange={(leaseId) => update({ leaseId })}
                />
                <SingleSelectFilter<MonitoringDueWindow>
                  label="Due date"
                  allLabel="Any due date"
                  value={params.due}
                  options={DUE_OPTIONS}
                  onChange={(due) => update({ due })}
                />
                <SingleSelectFilter<string>
                  label="Assigned to"
                  allLabel="Anyone or no one"
                  value={params.assignee}
                  options={assigneeOptions}
                  onChange={(assignee) => update({ assignee })}
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
    </section>
  )
}
