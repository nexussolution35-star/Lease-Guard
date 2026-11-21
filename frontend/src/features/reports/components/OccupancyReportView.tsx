import type { OccupancyFigures, OccupancyUnitRow, UnitType } from '@leaseguard/domain'

import { AppLink, DataTable, MetricCard, MetricGrid, SectionHeader, StatusBadge, type DataTableColumn } from '@/components/shared'
import { labelFor } from '@/lib/labels'

import { useReport } from '../api/queries'
import { toCsv, type CsvColumn } from '../csv'
import { formatArea, formatRate } from '../format'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

const count = (value: number) => <span className="tabular-nums">{value}</span>
const muted = (text: string) => <span className="text-muted-foreground">{text}</span>

/** The occupancy figures columns, after the group's own column. */
function figureColumns<T extends OccupancyFigures>(): DataTableColumn<T>[] {
  return [
    { id: 'total', header: 'Units', align: 'right', cell: (row) => count(row.total) },
    { id: 'occupied', header: 'Occupied', align: 'right', cell: (row) => count(row.occupied) },
    { id: 'vacant', header: 'Vacant', align: 'right', cell: (row) => count(row.vacant) },
    { id: 'underOffer', header: 'Under offer', align: 'right', hideBelow: 'md', cell: (row) => count(row.underOffer) },
    { id: 'unavailable', header: 'Unavailable', align: 'right', hideBelow: 'md', cell: (row) => count(row.unavailable) },
    { id: 'rate', header: 'Occupancy', align: 'right', cell: (row) => formatRate(row.occupancyRate) },
    { id: 'area', header: 'Occupied area', align: 'right', hideBelow: 'lg', cell: (row) => `${formatArea(row.occupiedAreaSqm)} of ${formatArea(row.floorAreaSqm)}` },
  ]
}

type PropertyFigures = OccupancyFigures & { propertyId: string; propertyName: string }
type TypeFigures = OccupancyFigures & { unitType: UnitType }

const PROPERTY_COLUMNS: DataTableColumn<PropertyFigures>[] = [
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
  ...figureColumns<PropertyFigures>(),
]

const TYPE_COLUMNS: DataTableColumn<TypeFigures>[] = [
  { id: 'unitType', header: 'Unit type', rowHeader: true, cell: (row) => labelFor(row.unitType) },
  ...figureColumns<TypeFigures>(),
]

const UNIT_COLUMNS: DataTableColumn<OccupancyUnitRow>[] = [
  {
    id: 'unit',
    header: 'Unit',
    rowHeader: true,
    cell: (row) => (
      <AppLink to={`/units/${encodeURIComponent(row.unitId)}`} className="font-medium text-foreground tabular-nums hover:underline">
        {row.unitNumber}
      </AppLink>
    ),
  },
  { id: 'property', header: 'Property', cell: (row) => row.propertyName },
  { id: 'type', header: 'Type', hideBelow: 'md', cell: (row) => labelFor(row.unitType) },
  { id: 'area', header: 'Floor area', align: 'right', hideBelow: 'lg', cell: (row) => formatArea(row.floorAreaSqm) },
  { id: 'status', header: 'Occupancy', cell: (row) => <StatusBadge status={row.occupancyStatus} /> },
  {
    id: 'tenant',
    header: 'Current tenant',
    hideBelow: 'sm',
    cell: (row) =>
      row.tenantId && row.tenantName ? (
        <span className="flex flex-col gap-0.5">
          <AppLink to={`/tenants/${encodeURIComponent(row.tenantId)}`} className="hover:underline">
            {row.tenantName}
          </AppLink>
          <span className="text-xs text-muted-foreground">
            {row.tenantSource === 'lease' && row.leaseId ? (
              <>
                Lease{' '}
                <AppLink to={`/leases/${encodeURIComponent(row.leaseId)}`} className="tabular-nums hover:underline">
                  {row.leaseReference ?? 'lease'}
                </AppLink>
              </>
            ) : (
              'Assigned without a lease'
            )}
          </span>
        </span>
      ) : (
        muted('—')
      ),
  },
]

const CSV_COLUMNS: CsvColumn<OccupancyUnitRow>[] = [
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Unit', value: (row) => row.unitNumber },
  { header: 'Unit type', value: (row) => labelFor(row.unitType) },
  { header: 'Floor area (m²)', value: (row) => row.floorAreaSqm },
  { header: 'Occupancy', value: (row) => labelFor(row.occupancyStatus) },
  { header: 'Current tenant', value: (row) => row.tenantName },
  { header: 'Tenant from', value: (row) => (row.tenantSource === 'lease' ? 'Lease' : row.tenantSource === 'assignment' ? 'Assignment' : undefined) },
  { header: 'Lease', value: (row) => row.leaseReference },
]

/**
 * Occupancy: the portfolio's occupancy in one strip, then by property, by unit type and unit by unit with each unit's
 * current tenant (its lease's tenant, else its assigned tenant). The CSV holds the units table. Figures come from the
 * reports service, counted as the dashboard counts them.
 */
export function OccupancyReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const query = useReport('occupancy', reportFiltersFromSearch('occupancy', search))
  const report = query.data?.data
  const units = report?.units ?? []

  return (
    <ReportFrame
      reportId="occupancy"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={units.length === 0}
      emptyTitle="No units yet"
      emptyDescription="Add units to your properties, and their occupancy appears here."
      csv={() => toCsv(CSV_COLUMNS, units)}
    >
      {report ? (
        <>
          <MetricGrid columns={4}>
            <MetricCard lead label="Occupancy" value={formatRate(report.totals.occupancyRate)} description={`${report.totals.occupied} of ${report.totals.total} units occupied`} />
            <MetricCard label="Vacant" value={report.totals.vacant} />
            <MetricCard label="Under offer" value={report.totals.underOffer} />
            <MetricCard label="Unavailable" value={report.totals.unavailable} />
            <MetricCard label="Occupied area" value={formatArea(report.totals.occupiedAreaSqm)} description={`of ${formatArea(report.totals.floorAreaSqm)} floor area`} />
          </MetricGrid>
          <section className="flex flex-col gap-3">
            <SectionHeader title="By property" />
            <DataTable caption="Occupancy by property" columns={PROPERTY_COLUMNS} rows={report.byProperty} getRowId={(row) => row.propertyId} />
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader title="By unit type" />
            <DataTable caption="Occupancy by unit type" columns={TYPE_COLUMNS} rows={report.byUnitType} getRowId={(row) => row.unitType} />
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader title="Units" description="A unit's current tenant comes from its lease, else from its assignment. Export CSV saves this table." />
            <DataTable caption="Units and their current tenants" columns={UNIT_COLUMNS} rows={units} getRowId={(row) => row.unitId} />
          </section>
        </>
      ) : null}
    </ReportFrame>
  )
}

