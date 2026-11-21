import { RENEWAL_DEADLINE_THRESHOLDS, type RenewalDeadlineRow } from '@leaseguard/domain'

import { AppLink, DataTable, DateDisplay, MetricCard, MetricGrid, SectionHeader, StatusBadge, StatusDot, type DataTableColumn } from '@/components/shared'
import { labelFor } from '@/lib/labels'

import { useReport } from '../api/queries'
import { toCsv, type CsvColumn } from '../csv'
import { formatDayList, formatDaysFrom } from '../format'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>
const months = (value: number) => `${value} ${value === 1 ? 'month' : 'months'}`

/** A deadline's status. `passed` reads as a missed deadline here (the shared label is the generic "Passed"). */
const deadlineStatus = (row: RenewalDeadlineRow) =>
  row.status === 'passed' ? <StatusDot tone="danger">Deadline passed</StatusDot> : <StatusBadge status={row.status} />
const deadlineLabel = (row: RenewalDeadlineRow) => (row.status === 'passed' ? 'Deadline passed' : labelFor(row.status))

const COLUMNS: DataTableColumn<RenewalDeadlineRow>[] = [
  {
    id: 'lease',
    header: 'Lease',
    rowHeader: true,
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <AppLink to={`/leases/${encodeURIComponent(row.leaseId)}`} className="font-medium text-foreground tabular-nums hover:underline">
          {row.reference}
        </AppLink>
        <AppLink to={`/tenants/${encodeURIComponent(row.tenantId)}`} className="text-xs text-muted-foreground hover:underline">
          {row.tenantName}
        </AppLink>
      </span>
    ),
  },
  {
    id: 'property',
    header: 'Property',
    hideBelow: 'md',
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <AppLink to={`/properties/${encodeURIComponent(row.propertyId)}`} className="hover:underline">
          {row.propertyName}
        </AppLink>
        <span className="text-xs text-muted-foreground tabular-nums">Unit {row.unitNumber}</span>
      </span>
    ),
  },
  { id: 'deadline', header: 'Notice deadline', cell: (row) => <DateDisplay value={row.deadline} /> },
  {
    id: 'days',
    header: 'Days left',
    align: 'right',
    cell: (row) => <span className={row.daysUntilDeadline < 0 && row.status !== 'exercised' ? 'tabular-nums text-destructive' : 'tabular-nums'}>{formatDaysFrom(row.daysUntilDeadline)}</span>,
  },
  { id: 'status', header: 'Status', hideBelow: 'sm', cell: deadlineStatus },
  { id: 'notice', header: 'Notice period', align: 'right', hideBelow: 'lg', cell: (row) => <span className="tabular-nums">{months(row.noticePeriodMonths)}</span> },
  { id: 'expiry', header: 'Expiry date', hideBelow: 'lg', cell: (row) => <DateDisplay value={row.expiryDate} /> },
  {
    id: 'monitoring',
    header: 'Monitoring',
    hideBelow: 'md',
    cell: (row) =>
      row.openEventId ? (
        <AppLink to={`/monitoring/${encodeURIComponent(row.openEventId)}`} className="hover:underline">
          Open event
        </AppLink>
      ) : row.warningThreshold !== undefined ? (
        `${row.warningThreshold}-day warning reached`
      ) : (
        muted('—')
      ),
  },
]

const CSV_COLUMNS: CsvColumn<RenewalDeadlineRow>[] = [
  { header: 'Lease', value: (row) => row.reference },
  { header: 'Tenant', value: (row) => row.tenantName },
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Unit', value: (row) => row.unitNumber },
  { header: 'Expiry date', value: (row) => row.expiryDate },
  { header: 'Notice period (months)', value: (row) => row.noticePeriodMonths },
  { header: 'Notice deadline', value: (row) => row.deadline },
  { header: 'Days left', value: (row) => row.daysUntilDeadline },
  { header: 'Status', value: deadlineLabel },
  { header: 'Warning threshold reached (days)', value: (row) => row.warningThreshold },
  { header: 'Open renewal event', value: (row) => row.openEventId !== undefined },
]

/**
 * Renewal deadlines: the last day written renewal notice may be given on each verified renewal option (expiry less the
 * notice period), soonest first, with the days left and its urgency, each linking to its lease and its open renewal
 * event. The CSV holds the table. Every figure comes from the reports service, worked out with the rules monitoring
 * uses; nothing is counted here.
 */
export function RenewalDeadlinesReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const query = useReport('renewal_deadlines', reportFiltersFromSearch('renewal_deadlines', search))
  const report = query.data?.data
  const rows = report?.rows ?? []

  return (
    <ReportFrame
      reportId="renewal_deadlines"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={rows.length === 0}
      emptyTitle="No renewal deadlines to report"
      emptyDescription="Verified leases with a renewal option and a notice period appear here, with the last day notice may be given."
      csv={() => toCsv(CSV_COLUMNS, rows)}
    >
      {report ? (
        <>
          <MetricGrid columns={4}>
            <MetricCard
              lead
              label="Requiring a warning"
              value={report.requiringWarning}
              {...(report.requiringWarning > 0 ? { tone: 'warning' as const } : {})}
              description={report.warningDays.length > 0 ? `Warnings at ${formatDayList(report.warningDays)}` : 'Renewal deadline monitoring is switched off'}
            />
            <MetricCard
              label={`Due within ${RENEWAL_DEADLINE_THRESHOLDS.critical} days`}
              value={report.countsByStatus.due_critical}
              {...(report.countsByStatus.due_critical > 0 ? { tone: 'danger' as const } : {})}
            />
            <MetricCard label="Deadline passed" value={report.countsByStatus.passed} {...(report.countsByStatus.passed > 0 ? { tone: 'danger' as const } : {})} />
            <MetricCard label="Options exercised" value={report.countsByStatus.exercised} />
            {report.missingNoticePeriod > 0 ? (
              <MetricCard label="No notice period" value={report.missingNoticePeriod} tone="warning" description="Renewal options without a notice period on the lease" />
            ) : null}
            {report.unverifiedLeasesExcluded > 0 ? (
              <MetricCard label="Not verified" value={report.unverifiedLeasesExcluded} tone="warning" description="Not monitored until their terms are verified" />
            ) : null}
          </MetricGrid>
          <section className="flex flex-col gap-3">
            <SectionHeader title="Notice deadlines" description="Soonest deadline first. Export CSV saves this table." />
            <DataTable caption="Renewal notice deadlines" columns={COLUMNS} rows={rows} getRowId={(row) => row.leaseId} />
          </section>
        </>
      ) : null}
    </ReportFrame>
  )
}
