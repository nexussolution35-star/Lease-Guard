import {
  EVENT_PRIORITIES,
  MONITORING_EVENT_STATUSES,
  MONITORING_EVENT_TYPES,
  type EventAgeBucket,
  type MonitoringEventRow,
} from '@leaseguard/domain'

import { AppLink, DataTable, DateDisplay, MetricCard, MetricGrid, PriorityBadge, SectionHeader, StatusBadge, type DataTableColumn } from '@/components/shared'
import { labelFor } from '@/lib/labels'

import { useReport } from '../api/queries'
import { toCsv, type CsvColumn } from '../csv'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

const count = (value: number) => <span className="tabular-nums">{value}</span>
const muted = (text: string) => <span className="text-muted-foreground">{text}</span>

/** `0-7` → `0–7 days`, `90+` → `More than 90 days`. */
const ageLabel = (bucket: EventAgeBucket): string => (bucket === '90+' ? 'More than 90 days' : `${bucket.replace('-', '–')} days`)
const days = (value: number) => `${value} ${value === 1 ? 'day' : 'days'}`

interface CountRow {
  id: string
  label: string
  count: number
}

const COUNT_COLUMNS = (header: string): DataTableColumn<CountRow>[] => [
  { id: 'label', header, rowHeader: true, cell: (row) => row.label },
  { id: 'count', header: 'Events', align: 'right', cell: (row) => count(row.count) },
]

interface PropertyRow {
  propertyId: string
  propertyName: string
  total: number
  open: number
  overdue: number
}

const PROPERTY_COLUMNS: DataTableColumn<PropertyRow>[] = [
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
  { id: 'total', header: 'Events', align: 'right', cell: (row) => count(row.total) },
  {
    id: 'open',
    header: 'Open',
    align: 'right',
    cell: (row) =>
      row.open > 0 ? (
        <AppLink to={`/monitoring?status=open&propertyId=${encodeURIComponent(row.propertyId)}`} className="tabular-nums hover:underline">
          {row.open}
        </AppLink>
      ) : (
        count(0)
      ),
  },
  { id: 'overdue', header: 'Overdue', align: 'right', cell: (row) => count(row.overdue) },
]

const EVENT_COLUMNS: DataTableColumn<MonitoringEventRow>[] = [
  {
    id: 'event',
    header: 'Event',
    rowHeader: true,
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <AppLink to={`/monitoring/${encodeURIComponent(row.eventId)}`} className="font-medium text-foreground hover:underline">
          {row.title}
        </AppLink>
        <span className="text-xs text-muted-foreground">{labelFor(row.type)}</span>
      </span>
    ),
  },
  { id: 'priority', header: 'Priority', cell: (row) => <PriorityBadge priority={row.priority} /> },
  { id: 'status', header: 'Status', hideBelow: 'sm', cell: (row) => <StatusBadge status={row.status} /> },
  {
    id: 'property',
    header: 'Property',
    hideBelow: 'md',
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <span>{row.propertyName}</span>
        {row.tenantName ? (
          <span className="text-xs text-muted-foreground">
            {row.tenantId ? (
              <AppLink to={`/tenants/${encodeURIComponent(row.tenantId)}`} className="hover:underline">
                {row.tenantName}
              </AppLink>
            ) : (
              row.tenantName
            )}
            {row.unitNumber ? ` · ${row.unitNumber}` : null}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'lease',
    header: 'Lease',
    hideBelow: 'lg',
    cell: (row) =>
      row.leaseId ? (
        <AppLink to={`/leases/${encodeURIComponent(row.leaseId)}`} className="tabular-nums hover:underline">
          {row.leaseReference ?? 'Lease'}
        </AppLink>
      ) : (
        muted('—')
      ),
  },
  { id: 'identified', header: 'Identified', hideBelow: 'md', cell: (row) => <DateDisplay value={row.identifiedOn} /> },
  { id: 'age', header: 'Age', align: 'right', cell: (row) => <span className="tabular-nums">{days(row.ageDays)}</span> },
  {
    id: 'due',
    header: 'Due',
    hideBelow: 'sm',
    cell: (row) =>
      row.dueDate ? (
        <span className="flex flex-col gap-0.5">
          <DateDisplay value={row.dueDate} />
          {row.overdue ? <StatusBadge status="missed" label="Overdue" /> : null}
        </span>
      ) : (
        muted('—')
      ),
  },
]

const CSV_COLUMNS: CsvColumn<MonitoringEventRow>[] = [
  { header: 'Event', value: (row) => row.title },
  { header: 'Type', value: (row) => labelFor(row.type) },
  { header: 'Priority', value: (row) => labelFor(row.priority) },
  { header: 'Status', value: (row) => labelFor(row.status) },
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Unit', value: (row) => row.unitNumber },
  { header: 'Tenant', value: (row) => row.tenantName },
  { header: 'Lease', value: (row) => row.leaseReference },
  { header: 'Identified', value: (row) => row.identifiedOn },
  { header: 'Age (days)', value: (row) => row.ageDays },
  { header: 'Due', value: (row) => row.dueDate },
  { header: 'Overdue', value: (row) => row.overdue },
]

/**
 * Lease monitoring: the open monitoring events (or the statuses chosen) in one strip, then by type, priority, status,
 * property and age, and event by event, each linking to the event. The CSV holds the events table. Figures come from
 * the reports service, counted as the monitoring list and the dashboard count them.
 */
export function LeaseMonitoringReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const filters = reportFiltersFromSearch('lease_monitoring', search)
  const query = useReport('lease_monitoring', filters)
  const report = query.data?.data
  const events = report?.events ?? []
  const showingOpen = !filters.statuses

  const byType: CountRow[] = report
    ? MONITORING_EVENT_TYPES.filter((type) => report.byType[type] > 0).map((type) => ({ id: type, label: labelFor(type), count: report.byType[type] }))
    : []
  const byPriority: CountRow[] = report
    ? [...EVENT_PRIORITIES].reverse().map((priority) => ({ id: priority, label: labelFor(priority), count: report.byPriority[priority] }))
    : []
  const byStatus: CountRow[] = report
    ? MONITORING_EVENT_STATUSES.filter((status) => report.byStatus[status] > 0).map((status) => ({ id: status, label: labelFor(status), count: report.byStatus[status] }))
    : []
  const byAge: CountRow[] = report ? report.byAge.map((row) => ({ id: row.bucket, label: ageLabel(row.bucket), count: row.count })) : []

  return (
    <ReportFrame
      reportId="lease_monitoring"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={events.length === 0}
      emptyTitle="No open monitoring events"
      emptyDescription="Monitoring raises events from verified leases and statements. Choose statuses to see resolved or dismissed events."
      csv={() => toCsv(CSV_COLUMNS, events)}
    >
      {report ? (
        <>
          <MetricGrid columns={4}>
            <MetricCard
              lead
              label={showingOpen ? 'Open events' : 'Events'}
              value={showingOpen ? report.open : report.total}
              {...(showingOpen ? {} : { description: `${report.open} still open` })}
            />
            <MetricCard label="Overdue" value={report.overdue} description="Open and past their due date" />
            <MetricCard label="Critical" value={report.byPriority.critical} />
            <MetricCard label="High" value={report.byPriority.high} />
          </MetricGrid>
          <div className="grid gap-10 lg:grid-cols-2">
            <section className="flex flex-col gap-3">
              <SectionHeader title="By type" />
              <DataTable caption="Events by type" columns={COUNT_COLUMNS('Type')} rows={byType} getRowId={(row) => row.id} />
            </section>
            <section className="flex flex-col gap-3">
              <SectionHeader title="By priority" />
              <DataTable caption="Events by priority" columns={COUNT_COLUMNS('Priority')} rows={byPriority} getRowId={(row) => row.id} />
            </section>
            <section className="flex flex-col gap-3">
              <SectionHeader title="By status" />
              <DataTable caption="Events by status" columns={COUNT_COLUMNS('Status')} rows={byStatus} getRowId={(row) => row.id} />
            </section>
            <section className="flex flex-col gap-3">
              <SectionHeader title="By age" description="Days since the event was identified." />
              <DataTable caption="Events by age" columns={COUNT_COLUMNS('Age')} rows={byAge} getRowId={(row) => row.id} />
            </section>
          </div>
          <section className="flex flex-col gap-3">
            <SectionHeader title="By property" />
            <DataTable caption="Events by property" columns={PROPERTY_COLUMNS} rows={report.byProperty} getRowId={(row) => row.propertyId} />
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Events"
              description={`${showingOpen ? 'Open events' : 'Events of the chosen statuses'}, oldest first. Export CSV saves this table.`}
            />
            <DataTable caption="Monitoring events" columns={EVENT_COLUMNS} rows={events} getRowId={(row) => row.eventId} />
          </section>
        </>
      ) : null}
    </ReportFrame>
  )
}
