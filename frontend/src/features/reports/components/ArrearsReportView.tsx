import type { ArrearsBucketRow, ArrearsRow } from '@leaseguard/domain'

import { AppLink, CurrencyDisplay, DataTable, DateDisplay, MetricCard, MetricGrid, SectionHeader, StatusDot, type DataTableColumn } from '@/components/shared'

import { useReport } from '../api/queries'
import { csvAmount, toCsv, type CsvColumn } from '../csv'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

/** "Current", "30 days", "120+ days": an ageing bucket's name, as the Statements page shows it. */
const bucketName = (bucket: string): string => (bucket === 'current' ? 'Current' : `${bucket} days`)
const muted = (text: string) => <span className="text-muted-foreground">{text}</span>
const dayCount = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`

const BUCKET_COLUMNS: DataTableColumn<ArrearsBucketRow>[] = [
  { id: 'bucket', header: 'Ageing bucket', rowHeader: true, cell: (row) => bucketName(row.bucket) },
  { id: 'days', header: 'Age', hideBelow: 'sm', cell: (row) => muted(row.description) },
  { id: 'tenants', header: 'Tenants', align: 'right', cell: (row) => <span className="tabular-nums">{row.tenantCount}</span> },
  { id: 'amount', header: 'Outstanding', align: 'right', cell: (row) => <CurrencyDisplay amount={row.amount} /> },
]

const ROW_COLUMNS: DataTableColumn<ArrearsRow>[] = [
  {
    id: 'tenant',
    header: 'Tenant',
    rowHeader: true,
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <AppLink to={`/tenants/${encodeURIComponent(row.tenantId)}`} className="font-medium text-foreground hover:underline">
          {row.tenantName}
        </AppLink>
        <span className="text-xs text-muted-foreground">
          {row.unitId && row.unitNumber ? (
            <AppLink to={`/units/${encodeURIComponent(row.unitId)}`} className="tabular-nums hover:underline">
              Unit {row.unitNumber}
            </AppLink>
          ) : null}
          {row.unitNumber && row.leaseReference ? ' · ' : null}
          {row.leaseId && row.leaseReference ? (
            <AppLink to={`/leases/${encodeURIComponent(row.leaseId)}`} className="tabular-nums hover:underline">
              {row.leaseReference}
            </AppLink>
          ) : null}
        </span>
      </span>
    ),
  },
  {
    id: 'property',
    header: 'Property',
    hideBelow: 'md',
    cell: (row) => (
      <AppLink to={`/properties/${encodeURIComponent(row.propertyId)}`} className="hover:underline">
        {row.propertyName}
      </AppLink>
    ),
  },
  {
    id: 'statement',
    header: 'Statement',
    hideBelow: 'sm',
    cell: (row) => (
      <AppLink to={`/statements/${encodeURIComponent(row.statementId)}`} className="tabular-nums hover:underline">
        <DateDisplay value={row.statementDate} />
      </AppLink>
    ),
  },
  {
    id: 'age',
    header: 'Age',
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <span className="tabular-nums">{dayCount(row.ageDays)}</span>
        <span className="text-xs text-muted-foreground">{bucketName(row.bucket)}</span>
      </span>
    ),
  },
  {
    id: 'arrangement',
    header: 'Arrangement',
    hideBelow: 'md',
    cell: (row) =>
      row.underArrangement ? (
        <span className="flex flex-col gap-0.5">
          {row.arrangementId ? (
            <AppLink to={`/arrangements/${encodeURIComponent(row.arrangementId)}`} className="hover:underline">
              <StatusDot tone="info">Under arrangement</StatusDot>
            </AppLink>
          ) : (
            <StatusDot tone="info">Under arrangement</StatusDot>
          )}
          <span className="text-xs text-muted-foreground">{row.remindersSuppressed ? 'Arrears reminders paused' : 'Reminders not paused'}</span>
        </span>
      ) : (
        muted('—')
      ),
  },
  { id: 'outstanding', header: 'Outstanding', align: 'right', cell: (row) => <CurrencyDisplay amount={row.outstanding} /> },
]

const CSV_COLUMNS: CsvColumn<ArrearsRow>[] = [
  { header: 'Tenant', value: (row) => row.tenantName },
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Unit', value: (row) => row.unitNumber },
  { header: 'Lease', value: (row) => row.leaseReference },
  { header: 'Statement date', value: (row) => row.statementDate },
  { header: 'Outstanding (ZAR)', value: (row) => csvAmount(row.outstanding) },
  { header: 'Age (days)', value: (row) => row.ageDays },
  { header: 'Ageing bucket', value: (row) => bucketName(row.bucket) },
  { header: 'Under arrangement', value: (row) => row.underArrangement },
  { header: 'Reminders paused', value: (row) => row.remindersSuppressed },
]

/**
 * Arrears ageing: what the latest verified statement of each tenant's unit says is outstanding, aged into the
 * company's buckets, with the tenants under an active payment arrangement marked (still in arrears; their normal
 * reminders may be paused). Every figure comes from the reports service, counted as the Statements page and the
 * dashboard count it. The CSV holds the accounts table. A monitoring report: nothing here takes a payment.
 */
export function ArrearsReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const query = useReport('arrears', reportFiltersFromSearch('arrears', search))
  const report = query.data?.data
  const rows = report?.rows ?? []

  return (
    <ReportFrame
      reportId="arrears"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={rows.length === 0}
      emptyTitle="No arrears"
      emptyDescription="No verified statement shows a balance outstanding. Balances appear here once statements are verified."
      csv={() => toCsv(CSV_COLUMNS, rows)}
    >
      {report ? (
        <>
          <MetricGrid columns={4}>
            <MetricCard
              lead
              label="Total outstanding"
              value={<CurrencyDisplay amount={report.totalOutstanding} />}
              tone={report.totalOutstanding > 0 ? 'danger' : 'neutral'}
              description={`${report.tenantCount} ${report.tenantCount === 1 ? 'tenant' : 'tenants'} in arrears`}
            />
            <MetricCard
              label="Under arrangement"
              value={<CurrencyDisplay amount={report.outstandingUnderArrangement} />}
              description={`${report.tenantsUnderArrangement} ${report.tenantsUnderArrangement === 1 ? 'tenant' : 'tenants'}, still owed`}
            />
            <MetricCard label="Reminders paused" value={report.tenantsWithRemindersSuppressed} description="Tenants whose arrangement pauses arrears reminders" />
          </MetricGrid>
          <section className="flex flex-col gap-3">
            <SectionHeader title="By ageing bucket" description="Aged from the statement date into your arrears monitoring buckets." />
            <DataTable caption="Outstanding by ageing bucket" columns={BUCKET_COLUMNS} rows={report.buckets} getRowId={(row) => row.bucket} />
          </section>
          <section className="flex flex-col gap-3">
            <SectionHeader title="Accounts in arrears" description="One row per tenant and unit, from its latest verified statement. Export CSV saves this table." />
            <DataTable caption="Accounts in arrears" columns={ROW_COLUMNS} rows={rows} getRowId={(row) => row.statementId} />
          </section>
        </>
      ) : null}
    </ReportFrame>
  )
}
