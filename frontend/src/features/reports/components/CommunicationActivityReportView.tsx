import {
  DELIVERY_OUTCOMES,
  type ApprovalAgeBucket,
  type CommunicationActivityRow,
  type CommunicationGroupFigures,
  type DeliveryOutcome,
  type MessageType,
  type PendingApprovalRow,
} from '@leaseguard/domain'

import { AppLink, DataTable, DateDisplay, MetricCard, MetricGrid, SectionHeader, StatusBadge, type DataTableColumn } from '@/components/shared'
import { DELIVERY_OUTCOME_LABELS, labelFor } from '@/lib/labels'

import { useReport } from '../api/queries'
import { toCsv, type CsvColumn } from '../csv'
import { formatRate } from '../format'
import { reportFiltersFromSearch } from '../reportSearch'
import { ReportFrame } from './ReportFrame'
import { frameQueryOf, type ReportViewProps } from './reportViewProps'

const count = (value: number) => <span className="tabular-nums">{value}</span>
const muted = (text: string) => <span className="text-muted-foreground">{text}</span>

/** A wait in hours as people say it: hours under two days, whole days after. */
function waitingFor(hours: number): string {
  if (hours < 1) return 'Under an hour'
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const days = Math.floor(hours / 24)
  return `${days} days`
}

/** Minutes as `45 min`, `3 h 20 min` or `2 days 4 h`. */
function turnaround(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days} days` : `${days} days ${hours % 24} h`
}

/** The counterparty, linking to the tenant when the message is a tenant's. */
function counterpartyCell(row: CommunicationActivityRow) {
  const name = row.counterpartyName ?? labelFor(row.recipientType)
  return (
    <span className="flex flex-col gap-0.5">
      {row.tenantId ? (
        <AppLink to={`/tenants/${encodeURIComponent(row.tenantId)}`} className="hover:underline">
          {name}
        </AppLink>
      ) : (
        <span>{name}</span>
      )}
      <span className="text-xs text-muted-foreground">{labelFor(row.recipientType)}</span>
    </span>
  )
}

/** The message type, with the statement it carries when it carries one. */
function typeCell(row: CommunicationActivityRow) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium text-foreground">{labelFor(row.messageType)}</span>
      {row.statementId ? (
        <AppLink to={`/statements/${encodeURIComponent(row.statementId)}`} className="text-xs text-muted-foreground hover:underline">
          Statement
        </AppLink>
      ) : null}
    </span>
  )
}

const propertyCell = (row: CommunicationActivityRow) =>
  row.propertyId && row.propertyName ? (
    <AppLink to={`/properties/${encodeURIComponent(row.propertyId)}`} className="hover:underline">
      {row.propertyName}
    </AppLink>
  ) : (
    muted('—')
  )

const PENDING_COLUMNS: DataTableColumn<PendingApprovalRow>[] = [
  {
    id: 'type',
    header: 'Message',
    rowHeader: true,
    cell: (row) => (
      <AppLink to="/communications/approvals" className="font-medium text-foreground hover:underline">
        {labelFor(row.messageType)}
      </AppLink>
    ),
  },
  { id: 'to', header: 'To', cell: counterpartyCell },
  { id: 'property', header: 'Property', hideBelow: 'md', cell: propertyCell },
  { id: 'requested', header: 'Requested', hideBelow: 'sm', cell: (row) => <DateDisplay value={row.approvalRequestedAt} style="datetime" className="tabular-nums" /> },
  { id: 'waiting', header: 'Waiting', align: 'right', cell: (row) => <span className="tabular-nums">{waitingFor(row.waitingHours)}</span> },
]

const AGE_COLUMNS: DataTableColumn<{ bucket: ApprovalAgeBucket; count: number }>[] = [
  { id: 'bucket', header: 'Waiting', rowHeader: true, cell: (row) => labelFor(row.bucket) },
  { id: 'count', header: 'Messages', align: 'right', cell: (row) => count(row.count) },
]

const FAILED_COLUMNS: DataTableColumn<CommunicationActivityRow>[] = [
  { id: 'type', header: 'Message', rowHeader: true, cell: typeCell },
  { id: 'to', header: 'To', cell: counterpartyCell },
  { id: 'property', header: 'Property', hideBelow: 'lg', cell: propertyCell },
  { id: 'date', header: 'Recorded', hideBelow: 'sm', cell: (row) => <DateDisplay value={row.createdAt} style="datetime" className="tabular-nums" /> },
  { id: 'reason', header: 'Why it failed', hideBelow: 'md', cell: (row) => <span className="text-sm">{row.failureReason ?? '—'}</span> },
]

function figureColumns<T extends CommunicationGroupFigures>(): DataTableColumn<T>[] {
  return [
    { id: 'total', header: 'Messages', align: 'right', cell: (row) => count(row.total) },
    { id: 'outbound', header: 'Sent by you', align: 'right', hideBelow: 'md', cell: (row) => count(row.outbound) },
    { id: 'inbound', header: 'Received', align: 'right', hideBelow: 'md', cell: (row) => count(row.inbound) },
    { id: 'delivered', header: 'Delivered', align: 'right', cell: (row) => count(row.delivered) },
    { id: 'failed', header: 'Failed', align: 'right', cell: (row) => count(row.failed) },
    { id: 'pending', header: 'Awaiting approval', align: 'right', hideBelow: 'sm', cell: (row) => count(row.pendingApproval) },
  ]
}

type TypeFigures = CommunicationGroupFigures & { messageType: MessageType }
type PropertyFigures = CommunicationGroupFigures & { propertyId: string | null; propertyName: string | null }

const TYPE_COLUMNS: DataTableColumn<TypeFigures>[] = [
  { id: 'type', header: 'Message type', rowHeader: true, cell: (row) => labelFor(row.messageType) },
  ...figureColumns<TypeFigures>(),
]

const PROPERTY_COLUMNS: DataTableColumn<PropertyFigures>[] = [
  {
    id: 'property',
    header: 'Property',
    rowHeader: true,
    cell: (row) =>
      row.propertyId && row.propertyName ? (
        <AppLink to={`/properties/${encodeURIComponent(row.propertyId)}`} className="font-medium text-foreground hover:underline">
          {row.propertyName}
        </AppLink>
      ) : (
        muted('No property (owner summaries, contacts)')
      ),
  },
  ...figureColumns<PropertyFigures>(),
]

const OUTCOME_COLUMNS: DataTableColumn<{ outcome: DeliveryOutcome; count: number; share: number | null }>[] = [
  { id: 'outcome', header: 'Delivery outcome', rowHeader: true, cell: (row) => DELIVERY_OUTCOME_LABELS[row.outcome] },
  { id: 'count', header: 'Messages', align: 'right', cell: (row) => count(row.count) },
  { id: 'share', header: 'Share', align: 'right', cell: (row) => (row.share === null ? muted('—') : formatRate(row.share)) },
]

const MESSAGE_COLUMNS: DataTableColumn<CommunicationActivityRow>[] = [
  { id: 'type', header: 'Message', rowHeader: true, cell: typeCell },
  { id: 'to', header: 'Counterparty', hideBelow: 'sm', cell: counterpartyCell },
  { id: 'property', header: 'Property', hideBelow: 'lg', cell: propertyCell },
  { id: 'date', header: 'Recorded', hideBelow: 'md', cell: (row) => <DateDisplay value={row.createdAt} style="datetime" className="tabular-nums" /> },
  { id: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
]

const CSV_COLUMNS: CsvColumn<CommunicationActivityRow>[] = [
  { header: 'Recorded on', value: (row) => row.createdOn },
  { header: 'Channel', value: (row) => labelFor(row.channel) },
  { header: 'Direction', value: (row) => labelFor(row.direction) },
  { header: 'Message type', value: (row) => labelFor(row.messageType) },
  { header: 'Counterparty type', value: (row) => labelFor(row.recipientType) },
  { header: 'Counterparty', value: (row) => row.counterpartyName },
  { header: 'Property', value: (row) => row.propertyName },
  { header: 'Status', value: (row) => labelFor(row.status) },
  { header: 'Delivery outcome', value: (row) => (row.outcome ? DELIVERY_OUTCOME_LABELS[row.outcome] : undefined) },
  { header: 'Approval', value: (row) => (row.approvalDecision ? labelFor(row.approvalDecision) : undefined) },
  { header: 'Approval requested on', value: (row) => row.approvalRequestedAt?.slice(0, 10) },
  { header: 'Failure reason', value: (row) => row.failureReason },
]

/**
 * Communication activity: the messages by type, status, delivery outcome and property, the messages waiting for a
 * property manager's approval and how long each has waited, and the messages that failed. The CSV holds the messages
 * table. Figures come from the reports service, counted as communication analytics and the dashboard count them.
 * Read-only: approving happens on the approvals screen.
 */
export function CommunicationActivityReportView({ definition, search, onSearchChange }: ReportViewProps) {
  const query = useReport('communication_activity', reportFiltersFromSearch('communication_activity', search))
  const report = query.data?.data
  const rows = report?.rows ?? []
  const outcomes = report
    ? DELIVERY_OUTCOMES.map((outcome) => ({ outcome, count: report.outcomes[outcome], share: report.handedOver > 0 ? report.outcomes[outcome] / report.handedOver : null }))
    : []

  return (
    <ReportFrame
      reportId="communication_activity"
      definition={definition}
      search={search}
      onSearchChange={onSearchChange}
      query={frameQueryOf(query)}
      {...(query.data ? { asOf: query.data.asOf } : {})}
      isEmpty={rows.length === 0}
      emptyTitle="No messages yet"
      emptyDescription="Statement and payment messages to tenants, owner summaries and replies appear here once there are any."
      csv={() => toCsv(CSV_COLUMNS, rows)}
    >
      {report ? (
        <>
          <MetricGrid columns={4}>
            <MetricCard
              lead
              label="Awaiting approval"
              value={report.approvals.pending}
              {...(report.approvals.oldestPendingHours !== null ? { description: `Longest waiting ${waitingFor(report.approvals.oldestPendingHours).toLowerCase()}` } : {})}
            />
            <MetricCard
              label="Delivered"
              value={report.deliveryRate === null ? '—' : formatRate(report.deliveryRate)}
              description={`${report.delivered} of ${report.handedOver} sent`}
            />
            <MetricCard label="Failed" value={report.failed} />
            <MetricCard label="Messages" value={report.total} description={`${report.outbound} sent by you, ${report.inbound} received`} />
            <MetricCard
              label="Approval turnaround"
              value={report.approvals.averageTurnaroundMinutes === null ? '—' : turnaround(report.approvals.averageTurnaroundMinutes)}
              description={`${report.approvals.approved} approved, ${report.approvals.rejected} rejected`}
            />
          </MetricGrid>

          <section className="flex flex-col gap-3">
            <SectionHeader title="Awaiting approval" description="Longest waiting first. Tenant messages go out only once a property manager approves them." />
            {report.pendingApprovals.length > 0 ? (
              <>
                <DataTable caption="Messages awaiting approval" columns={PENDING_COLUMNS} rows={report.pendingApprovals} getRowId={(row) => row.communicationId} />
                <DataTable caption="Messages awaiting approval by how long they have waited" columns={AGE_COLUMNS} rows={report.approvals.byAge} getRowId={(row) => row.bucket} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing is awaiting approval.</p>
            )}
          </section>

          {report.failedMessages.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeader title="Failed messages" description="Newest first. WhatsApp did not deliver these." />
              <DataTable caption="Messages that failed" columns={FAILED_COLUMNS} rows={report.failedMessages} getRowId={(row) => row.communicationId} />
            </section>
          ) : null}

          <section className="flex flex-col gap-3">
            <SectionHeader title="Delivery" description="What became of the messages handed to WhatsApp for sending." />
            <DataTable caption="Delivery outcomes" columns={OUTCOME_COLUMNS} rows={outcomes} getRowId={(row) => row.outcome} />
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader title="By message type" />
            <DataTable caption="Messages by type" columns={TYPE_COLUMNS} rows={report.byType} getRowId={(row) => row.messageType} />
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader title="By property" />
            <DataTable caption="Messages by property" columns={PROPERTY_COLUMNS} rows={report.byProperty} getRowId={(row) => row.propertyId ?? 'none'} />
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader title="Messages" description="Newest first. Export CSV saves this table." />
            <DataTable caption="Every message" columns={MESSAGE_COLUMNS} rows={rows} getRowId={(row) => row.communicationId} />
          </section>
        </>
      ) : null}
    </ReportFrame>
  )
}
