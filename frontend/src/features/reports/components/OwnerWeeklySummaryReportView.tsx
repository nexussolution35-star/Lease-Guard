import { CircleAlert } from 'lucide-react'
import { useId } from 'react'
import { formatZAR, type OwnerSummaryAttentionItem, type OwnerWeeklySummaryPreview, type OwnerWeeklySummaryReport } from '@leaseguard/domain'

import { AppLink, CurrencyDisplay, DataTable, DateDisplay, MetricCard, MetricGrid, SectionHeader, StatusDot, type DataTableColumn } from '@/components/shared'
import { useDateFormatter } from '@/lib/dateFormat'
import { labelFor, OWNER_SUMMARY_SEND_LABELS, OWNER_SUMMARY_SEND_TONES, ownerSummarySendState } from '@/lib/labels'

import { useReport } from '../api/queries'
import { csvAmount, toCsv, type CsvColumn } from '../csv'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>
const count = (n: number) => <span className="tabular-nums">{n}</span>

/** The change since the owner's previous stored summary, signed; none on the first. */
function Change({ owner }: { owner: OwnerWeeklySummaryPreview }) {
  const { summary } = owner
  if (summary.outstandingChange === null) return muted('First summary')
  return <CurrencyDisplay amount={summary.outstandingChange} signed tone="none" />
}

function SendState({ owner }: { owner: OwnerWeeklySummaryPreview }) {
  const state = ownerSummarySendState(owner)
  return <StatusDot tone={OWNER_SUMMARY_SEND_TONES[state]}>{OWNER_SUMMARY_SEND_LABELS[state]}</StatusDot>
}

const OWNER_COLUMNS: DataTableColumn<OwnerWeeklySummaryPreview>[] = [
  {
    id: 'owner',
    header: 'Owner',
    rowHeader: true,
    cell: (owner) => (
      <span className="flex flex-col gap-0.5">
        <a href={`#owner-${owner.summary.ownerUserId}`} className="font-medium text-foreground hover:underline">
          {owner.summary.ownerName}
        </a>
        <span className="text-xs text-muted-foreground">
          {owner.summary.properties.length} {owner.summary.properties.length === 1 ? 'property' : 'properties'}
        </span>
      </span>
    ),
  },
  { id: 'outstanding', header: 'Outstanding', align: 'right', cell: (owner) => <CurrencyDisplay amount={owner.summary.totalOutstanding} /> },
  { id: 'change', header: 'Change', align: 'right', hideBelow: 'sm', cell: (owner) => <Change owner={owner} /> },
  { id: 'events', header: 'Important events', align: 'right', hideBelow: 'md', cell: (owner) => count(owner.summary.importantEvents.length) },
  { id: 'discrepancies', header: 'Discrepancies', align: 'right', hideBelow: 'lg', cell: (owner) => count(owner.summary.discrepancies.length) },
  { id: 'guarantees', header: 'Guarantees expiring', align: 'right', hideBelow: 'lg', cell: (owner) => count(owner.summary.expiringGuarantees.length) },
  { id: 'attention', header: 'Attention', align: 'right', hideBelow: 'md', cell: (owner) => count(owner.summary.attention.length) },
  { id: 'send', header: 'This week', cell: (owner) => <SendState owner={owner} /> },
]

const CSV_COLUMNS: CsvColumn<OwnerWeeklySummaryPreview>[] = [
  { header: 'Owner', value: (owner) => owner.summary.ownerName },
  { header: 'Week of', value: (owner) => owner.summary.weekStart },
  { header: 'Properties', value: (owner) => owner.summary.properties.map((p) => p.propertyName).join('; ') },
  { header: 'Outstanding (ZAR)', value: (owner) => csvAmount(owner.summary.totalOutstanding) },
  { header: 'Previous summary week', value: (owner) => owner.summary.previous?.weekStart },
  { header: 'Change since previous (ZAR)', value: (owner) => (owner.summary.outstandingChange === null ? undefined : csvAmount(owner.summary.outstandingChange)) },
  { header: 'Important events', value: (owner) => owner.summary.importantEvents.length },
  { header: 'Rental discrepancies', value: (owner) => owner.summary.discrepancies.length },
  { header: 'Guarantees expiring', value: (owner) => owner.summary.expiringGuarantees.length },
  { header: 'Items needing attention', value: (owner) => owner.summary.attention.length },
  { header: 'This week', value: (owner) => OWNER_SUMMARY_SEND_LABELS[ownerSummarySendState(owner)] },
  { header: 'Why not sent', value: (owner) => (owner.delivery?.blockers.length ? owner.delivery.blockers : owner.blockers).join('; ') },
]

const RECORD_PATHS: Readonly<Record<OwnerSummaryAttentionItem['record']['entity'], string>> = {
  monitoring_event: '/monitoring',
  payment_arrangement: '/arrangements',
  lease: '/leases',
}

/** Why nothing is sent for the company this week; the page must say so rather than stay silent. */
function CompanyBlockers({ report }: { report: OwnerWeeklySummaryReport }) {
  const titleId = useId()
  if (report.blockers.length === 0) return null
  return (
    <section aria-labelledby={titleId} className="flex gap-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={titleId} className="text-sm font-medium text-foreground">
          No owner summary is sent while this stands
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
          {report.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
        <p className="text-sm">
          <AppLink to="/settings/templates" className="font-medium text-primary hover:underline">
            Settings → Message templates
          </AppLink>
          <span className="text-muted-foreground"> · </span>
          <AppLink to="/settings/whatsapp" className="font-medium text-primary hover:underline">
            Settings → WhatsApp
          </AppLink>
        </p>
      </div>
    </section>
  )
}

function OwnerSection({ owner }: { owner: OwnerWeeklySummaryPreview }) {
  const { summary, delivery } = owner
  const { date } = useDateFormatter()
  const blockers = delivery?.status === 'blocked' ? delivery.blockers : owner.blockers
  return (
    <article id={`owner-${summary.ownerUserId}`} aria-labelledby={`owner-${summary.ownerUserId}-title`} className="flex scroll-mt-20 flex-col gap-4 break-inside-avoid">
      <header className="flex flex-col gap-1 border-b border-border pb-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 id={`owner-${summary.ownerUserId}-title`} className="text-base font-medium text-foreground">
          {summary.ownerName}
        </h2>
        <span className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          {summary.properties.map((property) => (
            <AppLink key={property.propertyId} to={`/properties/${encodeURIComponent(property.propertyId)}`} className="hover:underline">
              {property.propertyName}
            </AppLink>
          ))}
        </span>
      </header>

      <MetricGrid columns={4}>
        <MetricCard
          lead
          label="Total outstanding"
          value={<CurrencyDisplay amount={summary.totalOutstanding} />}
          description={`${summary.tenantsInArrears} ${summary.tenantsInArrears === 1 ? 'tenant' : 'tenants'} in arrears, from verified statements`}
        />
        <MetricCard
          label="Change since the previous summary"
          value={summary.outstandingChange === null ? '—' : <CurrencyDisplay amount={summary.outstandingChange} signed tone="none" />}
          description={summary.previous ? `Week of ${date(summary.previous.weekStart)}: ${formatAmount(summary.previous.totalOutstanding)}` : 'This is the owner’s first summary'}
        />
        <MetricCard label="Open monitoring events" value={summary.openEventCount} description={`${summary.importantEvents.length} critical, high or overdue`} />
        <MetricCard label="Need the owner’s attention" value={summary.attention.length} tone={summary.attention.length > 0 ? 'warning' : 'neutral'} />
      </MetricGrid>

      <section className="flex flex-col gap-2" aria-label={`WhatsApp message to ${summary.ownerName}`}>
        <SectionHeader as="h3" title="WhatsApp message" description="The approved template with this week’s values. Bank details never appear in it." actions={<SendState owner={owner} />} />
        {owner.message ? (
          <p className="max-w-prose rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm whitespace-pre-wrap text-foreground">{owner.message}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No template is chosen, so there is no message text yet. The summary line would read: {owner.values[2]}</p>
        )}
        {blockers.length > 0 ? (
          <ul aria-label="Why it is not sent" className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}
        {delivery?.communicationId ? (
          <p className="text-xs text-muted-foreground">
            Recorded in the{' '}
            <AppLink to="/communications" className="hover:underline">
              message history
            </AppLink>
            {delivery.sentAt ? (
              <>
                , sent <DateDisplay value={delivery.sentAt} style="datetime" />
              </>
            ) : null}
            {delivery.failureReason ? `: ${delivery.failureReason}` : null}
          </p>
        ) : null}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <ItemList
          title="Important monitoring events"
          empty="No critical, high-priority or overdue events."
          items={summary.importantEvents.map((event) => ({
            key: event.eventId,
            to: `/monitoring/${encodeURIComponent(event.eventId)}`,
            title: event.title,
            detail: `${event.propertyName} · ${labelFor(event.priority)}${event.overdue ? ' · overdue' : ''}`,
          }))}
        />
        <ItemList
          title="Significant rental discrepancies"
          empty="Every verified lease is billed within tolerance."
          items={summary.discrepancies.map((row) => ({
            key: row.leaseId,
            to: `/leases/${encodeURIComponent(row.leaseId)}`,
            title: `${row.tenantName} (${row.leaseReference})`,
            detail: `Billed ${formatAmount(row.billed)}, expected ${formatAmount(row.expected)}`,
          }))}
        />
        <ItemList
          title="Expiring guarantees"
          empty="No bank guarantee is inside its notice days."
          items={summary.expiringGuarantees.map((row) => ({
            key: row.leaseId,
            to: `/leases/${encodeURIComponent(row.leaseId)}`,
            title: `${row.tenantName} (${row.reference})`,
            detail: `Expires ${date(row.expiresOn)}${row.guaranteeBank ? ` · ${row.guaranteeBank}` : ''}`,
          }))}
        />
        <ItemList
          title="Needs the owner’s attention"
          empty="Nothing needs the owner’s attention."
          items={summary.attention.map((item) => ({
            key: `${item.kind}-${item.record.id}`,
            to: `${RECORD_PATHS[item.record.entity]}/${encodeURIComponent(item.record.id)}`,
            title: item.title,
            detail: item.propertyName,
          }))}
        />
      </div>
    </article>
  )
}

const formatAmount = (amount: number): string => formatZAR(amount)

function ItemList({ title, empty, items }: { title: string; empty: string; items: { key: string; to: string; title: string; detail: string }[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">
        {title} <span className="text-muted-foreground tabular-nums">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {items.map((item) => (
            <li key={item.key} className="flex flex-col gap-0.5 py-2">
              <AppLink to={item.to} className="text-sm text-foreground hover:underline">
                {item.title}
              </AppLink>
              <span className="text-xs text-muted-foreground">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * The weekly owner summary (ticket R-07): this week's WhatsApp portfolio summary of each property owner, as the reports
 * service computes it from verified records (outstanding and its change since the previous stored summary, important
 * monitoring events, significant rental discrepancies, expiring guarantees, items needing attention), the message the
 * approved template carries, and what became of this week's send. Company admins only. When no approved template is
 * chosen or no number is connected, nothing is sent and the page says why. The CSV holds the owners table.
 */
export function OwnerWeeklySummaryReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const query = useReport('owner_weekly_summary', reportFiltersFromSearch('owner_weekly_summary', search))
  const { date } = useDateFormatter()
  const report = query.data?.data
  const owners = report?.owners ?? []

  return (
    <ReportFrame
      reportId="owner_weekly_summary"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={owners.length === 0}
      emptyTitle="No property owners"
      emptyDescription="Weekly summaries go to the owners of your properties. Set a property's owner on the property to include them."
      csv={() => toCsv(CSV_COLUMNS, owners)}
    >
      {report ? (
        <>
          <CompanyBlockers report={report} />
          <MetricGrid columns={3}>
            <MetricCard label="Week of" value={date(report.weekStart)} description="Each summary covers the owner’s properties as at today" />
            <MetricCard
              label="Next send"
              value={date(report.nextSendOn)}
              description={`Every ${labelFor(report.sendWeekday)}, from the company’s own WhatsApp number`}
            />
            <MetricCard
              label="Template"
              value={report.template ? report.template.metaTemplateName : 'None chosen'}
              description={report.template ? report.template.summary : 'Choose an approved template in Settings → Message templates'}
              tone={report.template?.sendable ? 'neutral' : 'warning'}
            />
          </MetricGrid>
          <section className="flex flex-col gap-3">
            <SectionHeader title="Owners this week" description="One summary per owner, sent to owners only, never to a tenant. Export CSV saves this table." />
            <DataTable caption="Weekly owner summaries" columns={OWNER_COLUMNS} rows={owners} getRowId={(owner) => owner.summary.ownerUserId} />
          </section>
          {owners.map((owner) => (
            <OwnerSection key={owner.summary.ownerUserId} owner={owner} />
          ))}
        </>
      ) : null}
    </ReportFrame>
  )
}
