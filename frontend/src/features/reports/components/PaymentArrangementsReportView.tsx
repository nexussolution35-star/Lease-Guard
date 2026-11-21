import type { ArrangementRow } from '@leaseguard/domain'

import { AppLink, CurrencyDisplay, DataTable, DateDisplay, MetricCard, MetricGrid, SectionHeader, StatusBadge, type DataTableColumn } from '@/components/shared'
import { Progress } from '@/components/ui/progress'
import { labelFor } from '@/lib/labels'

import { useReport } from '../api/queries'
import { csvAmount, toCsv, type CsvColumn } from '../csv'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>
const count = (value: number, tone?: 'danger' | 'warning') => (
  <span className={value > 0 && tone === 'danger' ? 'font-medium text-destructive tabular-nums' : value > 0 && tone === 'warning' ? 'font-medium text-warning tabular-nums' : 'tabular-nums'}>
    {value}
  </span>
)
const progressText = (row: Pick<ArrangementRow, 'paidCount' | 'totalCount'>) => `${row.paidCount} of ${row.totalCount} paid`

const COLUMNS: DataTableColumn<ArrangementRow>[] = [
  {
    id: 'tenant',
    header: 'Tenant',
    rowHeader: true,
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <AppLink to={`/arrangements/${encodeURIComponent(row.arrangementId)}`} className="font-medium text-foreground hover:underline">
          {row.tenantName}
        </AppLink>
        <span className="text-xs text-muted-foreground">
          <AppLink to={`/units/${encodeURIComponent(row.unitId)}`} className="tabular-nums hover:underline">
            Unit {row.unitNumber}
          </AppLink>
          {' · '}
          <AppLink to={`/leases/${encodeURIComponent(row.leaseId)}`} className="tabular-nums hover:underline">
            {row.leaseReference}
          </AppLink>
        </span>
      </span>
    ),
  },
  {
    id: 'property',
    header: 'Property',
    hideBelow: 'lg',
    cell: (row) => (
      <AppLink to={`/properties/${encodeURIComponent(row.propertyId)}`} className="hover:underline">
        {row.propertyName}
      </AppLink>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <StatusBadge status={row.status} />
        {row.closedOn ? (
          <span className="text-xs text-muted-foreground">
            Closed <DateDisplay value={row.closedOn} />
          </span>
        ) : null}
      </span>
    ),
  },
  { id: 'agreedOn', header: 'Agreed on', hideBelow: 'md', cell: (row) => <DateDisplay value={row.agreedOn} className="tabular-nums" /> },
  {
    id: 'progress',
    header: 'Schedule',
    hideBelow: 'sm',
    cell: (row) => (
      <span className="flex min-w-28 flex-col gap-1">
        <span className="text-xs tabular-nums">{progressText(row)}</span>
        <Progress
          value={row.totalCount > 0 ? (row.paidCount / row.totalCount) * 100 : 0}
          aria-label={`Instalments paid, ${row.tenantName}`}
          aria-valuetext={progressText(row)}
          className="h-1.5"
        />
      </span>
    ),
  },
  { id: 'missed', header: 'Missed', align: 'right', cell: (row) => count(row.missedCount, 'danger') },
  { id: 'overdue', header: 'Overdue', align: 'right', hideBelow: 'sm', cell: (row) => count(row.overdueCount, 'warning') },
  {
    id: 'next',
    header: 'Next instalment',
    hideBelow: 'md',
    cell: (row) =>
      row.nextDueDate && row.nextAmount !== undefined ? (
        <span className="flex flex-col gap-0.5">
          <DateDisplay value={row.nextDueDate} className="tabular-nums" />
          <span className="text-xs text-muted-foreground">
            <CurrencyDisplay amount={row.nextAmount} />
          </span>
        </span>
      ) : (
        muted('—')
      ),
  },
  { id: 'remaining', header: 'Remaining', align: 'right', cell: (row) => <CurrencyDisplay amount={row.remaining} /> },
]

const CSV_COLUMNS: CsvColumn<ArrangementRow>[] = [
  { header: 'Tenant', value: (row) => row.tenantName },
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Unit', value: (row) => row.unitNumber },
  { header: 'Lease', value: (row) => row.leaseReference },
  { header: 'Status', value: (row) => labelFor(row.status) },
  { header: 'Agreed on', value: (row) => row.agreedOn },
  { header: 'Closed on', value: (row) => row.closedOn },
  { header: 'Frequency', value: (row) => labelFor(row.frequency) },
  { header: 'Instalment (ZAR)', value: (row) => csvAmount(row.installmentAmount) },
  { header: 'Balance agreed (ZAR)', value: (row) => csvAmount(row.outstandingBalance) },
  { header: 'Paid (ZAR)', value: (row) => csvAmount(row.paid) },
  { header: 'Remaining (ZAR)', value: (row) => csvAmount(row.remaining) },
  { header: 'Instalments paid', value: (row) => row.paidCount },
  { header: 'Instalments', value: (row) => row.totalCount },
  { header: 'Missed', value: (row) => row.missedCount },
  { header: 'Overdue', value: (row) => row.overdueCount },
  { header: 'Next due', value: (row) => row.nextDueDate },
  { header: 'Next amount (ZAR)', value: (row) => (row.nextAmount === undefined ? undefined : csvAmount(row.nextAmount)) },
  { header: 'Arrears reminders paused', value: (row) => row.suppressArrearsReminders },
]

/**
 * Payment arrangements: every arrangement (active, proposed, defaulted, completed, cancelled) with its schedule
 * progress, its missed instalments and, while in force, its overdue and next instalments. Every figure comes from the
 * reports service, counted as the arrangement monitoring counts it. Paid means recorded as paid by a property manager:
 * LeaseGuard never takes or verifies payments, and nothing here offers to.
 */
export function PaymentArrangementsReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const query = useReport('payment_arrangements', reportFiltersFromSearch('payment_arrangements', search))
  const report = query.data?.data
  const rows = report?.rows ?? []
  const ended = report ? report.countsByStatus.completed + report.countsByStatus.defaulted + report.countsByStatus.cancelled : 0

  return (
    <ReportFrame
      reportId="payment_arrangements"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={rows.length === 0}
      emptyTitle="No payment arrangements yet"
      emptyDescription="Arrangements you record for tenants in arrears appear here with their schedule progress."
      csv={() => toCsv(CSV_COLUMNS, rows)}
    >
      {report ? (
        <>
          <MetricGrid columns={4}>
            <MetricCard
              lead
              label="Under arrangement"
              value={<CurrencyDisplay amount={report.outstandingUnderArrangement} />}
              description={`Remaining on ${report.activeCount} active ${report.activeCount === 1 ? 'arrangement' : 'arrangements'}`}
            />
            <MetricCard label="Recorded as paid" value={<CurrencyDisplay amount={report.paidToDate} />} description="Instalments a property manager confirmed" />
            <MetricCard label="Missed instalments" value={report.missedInstallments} {...(report.missedInstallments > 0 ? { tone: 'danger' as const } : {})} />
            <MetricCard
              label="Overdue instalments"
              value={report.overdueInstallments}
              description={report.graceDays > 0 ? `Open ${report.graceDays} ${report.graceDays === 1 ? 'day' : 'days'} past the due date` : 'Open past the due date'}
              {...(report.overdueInstallments > 0 ? { tone: 'warning' as const } : {})}
            />
            <MetricCard label="Proposed" value={report.countsByStatus.proposed} />
            <MetricCard
              label="Ended"
              value={ended}
              description={`${report.countsByStatus.completed} completed · ${report.countsByStatus.defaulted} defaulted · ${report.countsByStatus.cancelled} cancelled`}
            />
          </MetricGrid>
          <section className="flex flex-col gap-3">
            <SectionHeader title="Arrangements" description="Active first, then proposed and ended ones; the latest agreed first. Export CSV saves this table." />
            <DataTable caption="Payment arrangements" columns={COLUMNS} rows={rows} getRowId={(row) => row.arrangementId} />
          </section>
        </>
      ) : null}
    </ReportFrame>
  )
}
