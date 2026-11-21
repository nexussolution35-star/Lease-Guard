import { formatZAR, type ExpiryBucket, type LeaseExpiryRow, type ZAR } from '@leaseguard/domain'

import { AppLink, CurrencyDisplay, DataTable, DateDisplay, MetricCard, MetricGrid, SectionHeader, StatusBadge, type DataTableColumn } from '@/components/shared'
import { labelFor } from '@/lib/labels'

import { useReport } from '../api/queries'
import { csvAmount, toCsv, type CsvColumn } from '../csv'
import { formatDayList, formatDaysFrom } from '../format'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

const count = (value: number) => <span className="tabular-nums">{value}</span>
const muted = (text: string) => <span className="text-muted-foreground">{text}</span>

interface BucketTotal {
  bucket: ExpiryBucket
  count: number
  monthlyRental: ZAR
}

const BUCKET_COLUMNS: DataTableColumn<BucketTotal>[] = [
  { id: 'bucket', header: 'Expiry', rowHeader: true, cell: (row) => labelFor(row.bucket) },
  { id: 'count', header: 'Leases', align: 'right', cell: (row) => count(row.count) },
  { id: 'rental', header: 'Monthly rental', align: 'right', cell: (row) => <CurrencyDisplay amount={row.monthlyRental} /> },
]

const LEASE_COLUMNS: DataTableColumn<LeaseExpiryRow>[] = [
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
        <AppLink to={`/units/${encodeURIComponent(row.unitId)}`} className="text-xs text-muted-foreground tabular-nums hover:underline">
          Unit {row.unitNumber}
        </AppLink>
      </span>
    ),
  },
  { id: 'expiry', header: 'Expiry date', cell: (row) => <DateDisplay value={row.expiryDate} /> },
  {
    id: 'days',
    header: 'Days to expiry',
    align: 'right',
    cell: (row) => <span className={row.daysUntilExpiry < 0 ? 'tabular-nums text-destructive' : 'tabular-nums'}>{formatDaysFrom(row.daysUntilExpiry)}</span>,
  },
  { id: 'bucket', header: 'Expiry', hideBelow: 'sm', cell: (row) => <StatusBadge status={row.bucket} /> },
  { id: 'rental', header: 'Monthly rental', align: 'right', hideBelow: 'lg', cell: (row) => <CurrencyDisplay amount={row.monthlyRental} /> },
  { id: 'renewal', header: 'Renewal option', hideBelow: 'lg', cell: (row) => (row.renewalOptionAvailable ? 'Available' : muted('None')) },
  {
    id: 'monitoring',
    header: 'Monitoring',
    hideBelow: 'md',
    cell: (row) =>
      row.openEventId ? (
        <AppLink to={`/monitoring/${encodeURIComponent(row.openEventId)}`} className="hover:underline">
          Open event
        </AppLink>
      ) : row.noticeThreshold !== undefined ? (
        `${row.noticeThreshold}-day notice reached`
      ) : (
        muted('—')
      ),
  },
]

const CSV_COLUMNS: CsvColumn<LeaseExpiryRow>[] = [
  { header: 'Lease', value: (row) => row.reference },
  { header: 'Tenant', value: (row) => row.tenantName },
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Unit', value: (row) => row.unitNumber },
  { header: 'Expiry date', value: (row) => row.expiryDate },
  { header: 'Days to expiry', value: (row) => row.daysUntilExpiry },
  { header: 'Expiry', value: (row) => labelFor(row.bucket) },
  { header: 'Monthly rental (ZAR)', value: (row) => csvAmount(row.monthlyRental) },
  { header: 'Renewal option available', value: (row) => row.renewalOptionAvailable },
  { header: 'Notice threshold reached (days)', value: (row) => row.noticeThreshold },
  { header: 'Open expiry event', value: (row) => row.openEventId !== undefined },
]

/**
 * Lease expiry: verified leases by when they expire (expired, within 3 months, 3–6, 6–12 months, later), then lease by
 * lease, soonest first, each linking to its lease and its open expiry event. The CSV holds the leases table. Every
 * figure comes from the reports service, worked out with the rules monitoring uses; nothing is counted here.
 */
export function LeaseExpiryReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const query = useReport('lease_expiry', reportFiltersFromSearch('lease_expiry', search))
  const report = query.data?.data
  const rows = report?.rows ?? []
  const soon = report?.buckets.find((bucket) => bucket.bucket === 'months_0_3')

  return (
    <ReportFrame
      reportId="lease_expiry"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={rows.length === 0}
      emptyTitle="No verified leases to report"
      emptyDescription={
        report && report.unverifiedLeasesExcluded > 0
          ? `${report.unverifiedLeasesExcluded} ${report.unverifiedLeasesExcluded === 1 ? 'lease is' : 'leases are'} waiting for verification. Verified leases appear here.`
          : 'Add and verify your leases, and their expiry dates appear here.'
      }
      csv={() => toCsv(CSV_COLUMNS, rows)}
    >
      {report ? (
        <>
          <MetricGrid columns={4}>
            <MetricCard
              lead
              label="Expiring within 3 months"
              value={soon?.count ?? 0}
              {...(soon && soon.count > 0 ? { tone: 'warning' as const } : {})}
              description={`${formatZAR(soon?.monthlyRental ?? 0)} monthly rental`}
            />
            <MetricCard label="Expired" value={report.expiredCount} {...(report.expiredCount > 0 ? { tone: 'danger' as const, description: 'Expiry date passed, lease still active' } : {})} />
            <MetricCard
              label="Within notice"
              value={report.withinNoticeCount}
              description={report.noticeDays.length > 0 ? `Notice at ${formatDayList(report.noticeDays)}` : 'Lease expiry monitoring is switched off'}
            />
            <MetricCard
              label="Not verified"
              value={report.unverifiedLeasesExcluded}
              {...(report.unverifiedLeasesExcluded > 0 ? { tone: 'warning' as const } : {})}
              description="Not monitored until their terms are verified"
            />
          </MetricGrid>
          <section className="flex flex-col gap-3">
            <SectionHeader title="By expiry" description="Calendar months from the as-at date." />
            <DataTable caption="Leases by expiry" columns={BUCKET_COLUMNS} rows={report.buckets} getRowId={(row) => row.bucket} />
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader title="Leases" description="Verified leases, soonest expiry first. Export CSV saves this table." />
            <DataTable caption="Leases and their expiry" columns={LEASE_COLUMNS} rows={rows} getRowId={(row) => row.leaseId} />
          </section>
        </>
      ) : null}
    </ReportFrame>
  )
}
