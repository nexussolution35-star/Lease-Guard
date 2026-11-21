import type { PortfolioPropertyRow } from '@leaseguard/domain'

import { AppLink, CurrencyDisplay, DataTable, MetricCard, MetricGrid, SectionHeader, StatusBadge, type DataTableColumn } from '@/components/shared'
import { labelFor } from '@/lib/labels'

import { useReport } from '../api/queries'
import { csvAmount, csvPercent, toCsv, type CsvColumn } from '../csv'
import { formatRate } from '../format'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

const count = (value: number) => <span className="tabular-nums">{value}</span>

const COLUMNS: DataTableColumn<PortfolioPropertyRow>[] = [
  {
    id: 'property',
    header: 'Property',
    rowHeader: true,
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <AppLink to={`/properties/${encodeURIComponent(row.propertyId)}`} className="font-medium text-foreground hover:underline">
          {row.propertyName}
        </AppLink>
        <span className="text-xs text-muted-foreground">{row.code}</span>
      </span>
    ),
  },
  { id: 'status', header: 'Status', hideBelow: 'md', cell: (row) => <StatusBadge status={row.status} /> },
  { id: 'units', header: 'Units', align: 'right', cell: (row) => count(row.unitCount) },
  { id: 'occupied', header: 'Occupied', align: 'right', cell: (row) => count(row.occupiedUnits) },
  { id: 'vacant', header: 'Vacant', align: 'right', hideBelow: 'sm', cell: (row) => count(row.vacantUnits) },
  { id: 'occupancy', header: 'Occupancy', align: 'right', hideBelow: 'md', cell: (row) => formatRate(row.occupancyRate) },
  { id: 'activeLeases', header: 'Active leases', align: 'right', hideBelow: 'md', cell: (row) => count(row.activeLeases) },
  { id: 'rentalRoll', header: 'Rental roll', align: 'right', hideBelow: 'lg', cell: (row) => <CurrencyDisplay amount={row.monthlyRentalRoll} /> },
  { id: 'outstanding', header: 'Outstanding', align: 'right', cell: (row) => <CurrencyDisplay amount={row.outstanding} /> },
  {
    id: 'openEvents',
    header: 'Open events',
    align: 'right',
    hideBelow: 'sm',
    cell: (row) =>
      row.openEvents > 0 ? (
        <AppLink to={`/monitoring?status=open&propertyId=${encodeURIComponent(row.propertyId)}`} className="tabular-nums hover:underline">
          {row.openEvents}
        </AppLink>
      ) : (
        count(0)
      ),
  },
]

const CSV_COLUMNS: CsvColumn<PortfolioPropertyRow>[] = [
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Code', value: (row) => row.code },
  { header: 'Status', value: (row) => labelFor(row.status) },
  { header: 'Units', value: (row) => row.unitCount },
  { header: 'Occupied units', value: (row) => row.occupiedUnits },
  { header: 'Vacant units', value: (row) => row.vacantUnits },
  { header: 'Occupancy (%)', value: (row) => csvPercent(row.occupancyRate) },
  { header: 'Active leases', value: (row) => row.activeLeases },
  { header: 'Monthly rental roll (ZAR)', value: (row) => csvAmount(row.monthlyRentalRoll) },
  { header: 'Outstanding (ZAR)', value: (row) => csvAmount(row.outstanding) },
  { header: 'Tenants in arrears', value: (row) => row.tenantsInArrears },
  { header: 'Open monitoring events', value: (row) => row.openEvents },
]

/**
 * Portfolio overview: the portfolio's figures in one strip, then one row per property. Every figure comes from the
 * reports service, counted as the dashboard counts it; nothing is added up here.
 */
export function PortfolioOverviewReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const query = useReport('portfolio_overview', reportFiltersFromSearch('portfolio_overview', search))
  const report = query.data?.data
  const rows = report?.properties ?? []

  return (
    <ReportFrame
      reportId="portfolio_overview"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={rows.length === 0}
      emptyTitle="No properties yet"
      emptyDescription="Add a property, or import your portfolio, and its figures appear here."
      csv={() => toCsv(CSV_COLUMNS, rows)}
    >
      {report ? (
        <>
          <MetricGrid columns={4}>
            <MetricCard lead label="Total outstanding" value={<CurrencyDisplay amount={report.totalOutstanding} />} tone={report.totalOutstanding > 0 ? 'danger' : 'neutral'} description={`${report.tenantsInArrears} ${report.tenantsInArrears === 1 ? 'tenant' : 'tenants'} in arrears`} />
            <MetricCard label="Properties" value={report.propertyCount} description={`${report.unitCount} units`} />
            <MetricCard label="Occupancy" value={formatRate(report.occupancyRate)} description={`${report.occupiedUnits} occupied · ${report.vacantUnits} vacant`} />
            <MetricCard label="Active leases" value={report.activeLeases} {...(report.unverifiedLeases > 0 ? { description: `${report.unverifiedLeases} awaiting verification`, tone: 'warning' as const } : {})} />
            <MetricCard label="Monthly rental roll" value={<CurrencyDisplay amount={report.monthlyRentalRoll} />} description="Active leases with verified terms" />
            <MetricCard label="Open monitoring events" value={report.openEvents} />
          </MetricGrid>
          <section className="flex flex-col gap-3">
            <SectionHeader title="By property" description="Outstanding is the latest verified statement of each tenant's unit." />
            <DataTable caption="Portfolio overview by property" columns={COLUMNS} rows={rows} getRowId={(row) => row.propertyId} />
          </section>
        </>
      ) : null}
    </ReportFrame>
  )
}
