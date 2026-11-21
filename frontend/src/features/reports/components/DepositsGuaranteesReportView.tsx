import { formatZAR, type SecurityRow } from '@leaseguard/domain'

import { AppLink, CurrencyDisplay, DataTable, DateDisplay, MetricCard, MetricGrid, SectionHeader, StatusBadge, StatusDot, type DataTableColumn } from '@/components/shared'
import { labelFor } from '@/lib/labels'

import { useReport } from '../api/queries'
import { csvAmount, toCsv, type CsvColumn } from '../csv'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>
const none = () => (
  <span className="text-muted-foreground">
    <span aria-hidden="true">—</span>
    <span className="sr-only">None</span>
  </span>
)
const dayCount = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`

/** A shortfall: a non-zero one is the danger figure (the only figure that takes colour), zero stays plain. */
function Shortfall({ amount }: { amount: number }) {
  return amount > 0 ? <CurrencyDisplay amount={amount} className="font-medium text-destructive" /> : <CurrencyDisplay amount={0} className="text-muted-foreground" />
}

/** "in 9 days", "today", "20 days ago": the time to the guarantee's expiry, from the API's day count. */
function expiryDistance(days: number): string {
  if (days === 0) return 'Expires today'
  return days > 0 ? `In ${dayCount(days)}` : `${dayCount(-days)} ago`
}

const COLUMNS: DataTableColumn<SecurityRow>[] = [
  {
    id: 'lease',
    header: 'Lease',
    rowHeader: true,
    cell: (row) => (
      <span className="flex flex-col gap-0.5">
        <AppLink to={`/leases/${encodeURIComponent(row.leaseId)}`} className="font-medium text-foreground tabular-nums hover:underline">
          {row.reference}
        </AppLink>
        <span className="text-xs text-muted-foreground">
          <AppLink to={`/tenants/${encodeURIComponent(row.tenantId)}`} className="hover:underline">
            {row.tenantName}
          </AppLink>
          {' · '}
          <AppLink to={`/units/${encodeURIComponent(row.unitId)}`} className="tabular-nums hover:underline">
            Unit {row.unitNumber}
          </AppLink>
        </span>
        {row.needsAttention ? <StatusDot tone="danger" className="text-xs">Needs attention</StatusDot> : null}
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
    id: 'deposit',
    header: 'Deposit',
    align: 'right',
    hideBelow: 'sm',
    cell: (row) =>
      row.depositAmount === undefined ? (
        none()
      ) : (
        <span className="flex flex-col items-end gap-0.5">
          <CurrencyDisplay amount={row.depositAmount} />
          <span className="text-xs text-muted-foreground">
            {row.depositRequired !== undefined ? (
              <>
                of <CurrencyDisplay amount={row.depositRequired} /> required
              </>
            ) : (
              'No basis recorded'
            )}
          </span>
        </span>
      ),
  },
  { id: 'depositShortfall', header: 'Deposit short', align: 'right', hideBelow: 'md', cell: (row) => (row.depositAmount === undefined ? none() : <Shortfall amount={row.depositShortfall} />) },
  {
    id: 'guarantee',
    header: 'Guarantee',
    align: 'right',
    cell: (row) =>
      row.guaranteeAmount === undefined ? (
        none()
      ) : (
        <span className="flex flex-col items-end gap-0.5">
          <CurrencyDisplay amount={row.guaranteeAmount} />
          <span className="text-xs text-muted-foreground">
            {row.guaranteeRequired !== undefined ? (
              <>
                of <CurrencyDisplay amount={row.guaranteeRequired} /> required
              </>
            ) : (
              `${row.guaranteeBank ?? ''} ${row.guaranteeReference ?? ''}`.trim()
            )}
          </span>
        </span>
      ),
  },
  { id: 'guaranteeShortfall', header: 'Guarantee short', align: 'right', cell: (row) => (row.guaranteeAmount === undefined ? none() : <Shortfall amount={row.guaranteeShortfall} />) },
  {
    id: 'expiry',
    header: 'Guarantee expiry',
    hideBelow: 'sm',
    cell: (row) =>
      row.guaranteeExpiresOn && row.guaranteeState ? (
        <span className="flex flex-col gap-0.5">
          <StatusBadge status={row.guaranteeState} />
          <span className="text-xs text-muted-foreground">
            <DateDisplay value={row.guaranteeExpiresOn} />
            {row.guaranteeDaysUntilExpiry !== undefined && (row.guaranteeState === 'active' || row.guaranteeState === 'expiring' || row.guaranteeState === 'expired')
              ? ` · ${expiryDistance(row.guaranteeDaysUntilExpiry)}`
              : null}
          </span>
        </span>
      ) : (
        muted('No guarantee')
      ),
  },
]

const optionalAmount = (amount: number | undefined) => (amount === undefined ? undefined : csvAmount(amount))

const CSV_COLUMNS: CsvColumn<SecurityRow>[] = [
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Lease', value: (row) => row.reference },
  { header: 'Tenant', value: (row) => row.tenantName },
  { header: 'Unit', value: (row) => row.unitNumber },
  { header: 'Expected monthly rental (ZAR)', value: (row) => csvAmount(row.expectedMonthlyRental) },
  { header: 'Deposit held (ZAR)', value: (row) => optionalAmount(row.depositAmount) },
  { header: 'Deposit held by', value: (row) => (row.depositHeldBy ? labelFor(row.depositHeldBy) : undefined) },
  { header: 'Deposit basis (months)', value: (row) => row.depositBasisMonths },
  { header: 'Deposit required (ZAR)', value: (row) => optionalAmount(row.depositRequired) },
  { header: 'Deposit shortfall (ZAR)', value: (row) => (row.depositAmount === undefined ? undefined : csvAmount(row.depositShortfall)) },
  { header: 'Guarantee bank', value: (row) => row.guaranteeBank },
  { header: 'Guarantee reference', value: (row) => row.guaranteeReference },
  { header: 'Guarantee amount (ZAR)', value: (row) => optionalAmount(row.guaranteeAmount) },
  { header: 'Guarantee basis (months)', value: (row) => row.guaranteeBasisMonths },
  { header: 'Guarantee required (ZAR)', value: (row) => optionalAmount(row.guaranteeRequired) },
  { header: 'Guarantee shortfall (ZAR)', value: (row) => (row.guaranteeAmount === undefined ? undefined : csvAmount(row.guaranteeShortfall)) },
  { header: 'Guarantee expiry', value: (row) => row.guaranteeExpiresOn },
  { header: 'Guarantee state', value: (row) => (row.guaranteeState ? labelFor(row.guaranteeState) : undefined) },
  { header: 'Days until expiry', value: (row) => row.guaranteeDaysUntilExpiry },
  { header: 'Needs attention', value: (row) => row.needsAttention },
]

/**
 * Deposits and guarantees: per verified lease, the deposit and bank guarantee held, the cover the lease requires now
 * (basis months of the escalated rental) and any shortfall, and when the guarantee expires. Short and expiring
 * guarantees are marked. Every figure comes from the reports service, worked out as lease monitoring works it out.
 * The CSV holds the leases table. A monitoring report: nothing here claims or calls a guarantee.
 */
export function DepositsGuaranteesReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const query = useReport('deposits_guarantees', reportFiltersFromSearch('deposits_guarantees', search))
  const report = query.data?.data
  const rows = report?.rows ?? []
  const shortfall = report ? report.depositShortfallTotal + report.guaranteeShortfallTotal : 0
  const noticeDays = report?.guaranteeNoticeDays ?? []

  return (
    <ReportFrame
      reportId="deposits_guarantees"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={rows.length === 0}
      emptyTitle="No deposits or guarantees"
      emptyDescription="Verified leases with a deposit or a bank guarantee appear here, with the cover they require."
      csv={() => toCsv(CSV_COLUMNS, rows)}
    >
      {report ? (
        <>
          <MetricGrid columns={4}>
            <MetricCard
              lead
              label="Guarantee shortfall"
              value={<CurrencyDisplay amount={report.guaranteeShortfallTotal} />}
              tone={report.guaranteeShortfallTotal > 0 ? 'danger' : 'neutral'}
              description={`${report.leasesWithShortfall} ${report.leasesWithShortfall === 1 ? 'lease' : 'leases'} short of cover`}
            />
            <MetricCard label="Guarantees in force" value={<CurrencyDisplay amount={report.totalGuarantees} />} description="Active and expiring guarantees" />
            <MetricCard
              label="Deposits held"
              value={<CurrencyDisplay amount={report.totalDeposits} />}
              tone={report.depositShortfallTotal > 0 ? 'danger' : 'neutral'}
              description={report.depositShortfallTotal > 0 ? `${formatZAR(report.depositShortfallTotal)} short of the required cover` : 'No deposit short of its basis'}
            />
            <MetricCard
              label="Expiring guarantees"
              value={report.expiringGuarantees}
              tone={report.expiringGuarantees > 0 ? 'warning' : 'neutral'}
              {...(noticeDays.length > 0 ? { description: `Within ${dayCount(noticeDays[0] ?? 0)}` } : {})}
            />
            <MetricCard label="Expired guarantees" value={report.expiredGuarantees} tone={report.expiredGuarantees > 0 ? 'danger' : 'neutral'} />
          </MetricGrid>
          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Leases"
              description={`Required cover is the basis months times the rental the verified terms expect today.${
                noticeDays.length > 0 ? ` A guarantee is expiring once it is within ${dayCount(noticeDays[0] ?? 0)} of its expiry date.` : ''
              } Export CSV saves this table.`}
            />
            <DataTable caption="Deposits and guarantees by lease" columns={COLUMNS} rows={rows} getRowId={(row) => row.leaseId} />
            {shortfall > 0 ? (
              <p className="text-xs text-muted-foreground">
                Deposits and guarantees together are <CurrencyDisplay amount={shortfall} /> short of the required cover.
              </p>
            ) : null}
          </section>
          {report.unverifiedLeasesExcluded > 0 ? (
            <p className="text-sm text-muted-foreground">
              {report.unverifiedLeasesExcluded} {report.unverifiedLeasesExcluded === 1 ? 'lease with a deposit or guarantee is' : 'leases with a deposit or guarantee are'} not
              listed: {report.unverifiedLeasesExcluded === 1 ? 'its' : 'their'} terms are not verified yet, so {report.unverifiedLeasesExcluded === 1 ? 'it drives' : 'they drive'} no monitoring.
            </p>
          ) : null}
        </>
      ) : null}
    </ReportFrame>
  )
}
