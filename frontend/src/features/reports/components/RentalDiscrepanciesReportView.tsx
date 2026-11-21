import type { RentalDiscrepancyRow } from '@leaseguard/domain'

import { AppLink, CurrencyDisplay, DataTable, DateDisplay, MetricCard, MetricGrid, SectionHeader, StatusBadge, type DataTableColumn } from '@/components/shared'
import { labelFor } from '@/lib/labels'

import { useReport } from '../api/queries'
import { csvAmount, toCsv, type CsvColumn } from '../csv'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>
const outcome = (row: RentalDiscrepancyRow) => (row.withinTolerance ? 'within_tolerance' : 'outside_tolerance')
const rowId = (row: RentalDiscrepancyRow) => `${row.leaseId}:${row.statementId ?? row.eventId ?? 'none'}`

const COLUMNS: DataTableColumn<RentalDiscrepancyRow>[] = [
  {
    id: 'lease',
    header: 'Lease',
    rowHeader: true,
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <AppLink to={`/leases/${encodeURIComponent(row.leaseId)}`} className="font-medium text-foreground tabular-nums hover:underline">
          {row.leaseReference}
        </AppLink>
        <span className="text-xs text-muted-foreground">
          <AppLink to={`/tenants/${encodeURIComponent(row.tenantId)}`} className="hover:underline">
            {row.tenantName}
          </AppLink>
          {` · ${row.propertyName}`}
          {row.unitNumber ? ` · ${row.unitNumber}` : null}
        </span>
      </span>
    ),
  },
  {
    id: 'statement',
    header: 'Statement',
    hideBelow: 'md',
    cell: (row) =>
      row.statementId ? (
        <span className="flex flex-col gap-0.5">
          <AppLink to={`/statements/${encodeURIComponent(row.statementId)}`} className="hover:underline">
            {row.statementDate ? <DateDisplay value={row.statementDate} /> : 'Statement'}
          </AppLink>
          {row.periodStart ? (
            <span className="text-xs text-muted-foreground">
              Period from <DateDisplay value={row.periodStart} />
            </span>
          ) : null}
          {row.current ? null : <span className="text-xs text-muted-foreground">Earlier statement</span>}
        </span>
      ) : (
        muted('—')
      ),
  },
  { id: 'expected', header: 'Expected', align: 'right', hideBelow: 'sm', cell: (row) => <CurrencyDisplay amount={row.expected} /> },
  { id: 'billed', header: 'Billed', align: 'right', hideBelow: 'sm', cell: (row) => <CurrencyDisplay amount={row.billed} /> },
  { id: 'difference', header: 'Difference', align: 'right', cell: (row) => <CurrencyDisplay amount={row.difference} tone="none" signed /> },
  { id: 'outcome', header: 'Comparison', cell: (row) => <StatusBadge status={outcome(row)} /> },
  {
    id: 'event',
    header: 'Event',
    hideBelow: 'lg',
    cell: (row) =>
      row.eventId ? (
        <AppLink to={`/monitoring/${encodeURIComponent(row.eventId)}`} className="hover:underline">
          {row.eventStatus ? <StatusBadge status={row.eventStatus} /> : 'Open the event'}
        </AppLink>
      ) : row.withinTolerance ? (
        muted('—')
      ) : (
        muted('No event yet')
      ),
  },
  {
    id: 'calculation',
    header: 'Calculation',
    hideBelow: 'lg',
    cell: (row) =>
      row.steps.length > 0 ? (
        <details className="group text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{`${row.steps.length} steps`}</summary>
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-4 text-xs tabular-nums">
            {row.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </details>
      ) : (
        muted('—')
      ),
  },
]

const CSV_COLUMNS: CsvColumn<RentalDiscrepancyRow>[] = [
  { header: 'Lease', value: (row) => row.leaseReference },
  { header: 'Tenant', value: (row) => row.tenantName },
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Unit', value: (row) => row.unitNumber },
  { header: 'Statement date', value: (row) => row.statementDate },
  { header: 'Billing period start', value: (row) => row.periodStart },
  { header: 'Expected rental (R)', value: (row) => csvAmount(row.expected) },
  { header: 'Billed rental (R)', value: (row) => csvAmount(row.billed) },
  { header: 'Difference (R)', value: (row) => csvAmount(row.difference) },
  { header: 'Comparison', value: (row) => labelFor(outcome(row)) },
  { header: 'Latest statement', value: (row) => row.current },
  { header: 'Event status', value: (row) => (row.eventStatus ? labelFor(row.eventStatus) : undefined) },
  { header: 'Calculation', value: (row) => row.steps.join(' | ') },
]

/**
 * Rental discrepancies: for each verified lease, the rental billed on its latest verified statement against the
 * escalated contractual rental, with the difference and the calculation step by step, linking to the lease, the
 * statement and the monitoring event. The CSV holds the table. Figures come from the reports service, compared as
 * lease monitoring compares them.
 */
export function RentalDiscrepanciesReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const query = useReport('rental_discrepancies', reportFiltersFromSearch('rental_discrepancies', search))
  const report = query.data?.data
  const rows = report?.rows ?? []

  return (
    <ReportFrame
      reportId="rental_discrepancies"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={rows.length === 0}
      emptyTitle="No rental to compare yet"
      emptyDescription="Verify a lease's terms and a statement that bills its rental, and the comparison appears here."
      csv={() => toCsv(CSV_COLUMNS, rows)}
    >
      {report ? (
        <>
          <MetricGrid columns={4}>
            <MetricCard
              lead
              label="Monthly difference"
              value={<CurrencyDisplay amount={report.totalMonthlyDifference} tone="none" signed />}
              description="Expected less billed, outside tolerance"
            />
            <MetricCard label="Under-billed" value={<CurrencyDisplay amount={report.underBilled} />} />
            <MetricCard label="Over-billed" value={<CurrencyDisplay amount={report.overBilled} />} />
            <MetricCard label="Outside tolerance" value={report.outsideToleranceCount} description={`Of ${report.leasesCompared} leases compared`} />
            <MetricCard label="Open discrepancy events" value={report.openEventCount} />
            <MetricCard
              label="Not compared"
              value={report.awaitingStatement + report.unverifiedLeasesExcluded}
              description={`${report.awaitingStatement} awaiting a verified statement, ${report.unverifiedLeasesExcluded} awaiting verification`}
            />
          </MetricGrid>
          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Billed against expected rental"
              description="Expected is the contractual rental escalated to the start of the billed period. A positive difference is rental billed short. Export CSV saves this table."
            />
            <DataTable caption="Billed against expected rental per lease" columns={COLUMNS} rows={rows} getRowId={rowId} />
          </section>
        </>
      ) : null}
    </ReportFrame>
  )
}
