import { useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { formatSADate, type AgeingBucketLabel, type StatementArrearsEntry } from '@leaseguard/domain'

import {
  AppLink,
  CurrencyDisplay,
  DataTable,
  DateDisplay,
  MetricCard,
  MetricGrid,
  SectionHeader,
  SignOff,
  StatusDot,
  VerificationBadge,
  type DataTableColumn,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useMemberList } from '@/features/users/api/queries'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { cn } from '@/lib/utils'

import { useStatementArrears } from '../api/arrearsQueries'

/** "Current", "30 days", "120+ days": the bucket's name as the page shows it. */
function bucketName(bucket: AgeingBucketLabel): string {
  return bucket === 'current' ? 'Current' : `${bucket} days`
}

const statementPath = (entry: StatementArrearsEntry) => `/statements/${encodeURIComponent(entry.statementId)}`

function columns(verifierName: (entry: StatementArrearsEntry) => string | undefined): DataTableColumn<StatementArrearsEntry>[] {
  return [
    {
      id: 'tenant',
      header: 'Tenant',
      cell: (entry) => (
        <div className="flex min-w-0 max-w-64 flex-col items-start gap-1">
          <span className="truncate font-medium text-foreground">{entry.tenantName || 'Unnamed tenant'}</span>
          {entry.underArrangement ? (
            <StatusDot tone="info">{entry.remindersSuppressed ? 'Payment arrangement · reminders paused' : 'Payment arrangement'}</StatusDot>
          ) : null}
        </div>
      ),
    },
    {
      id: 'property',
      header: 'Property and unit',
      hideBelow: 'md',
      cell: (entry) => (
        <span>
          {entry.propertyName}
          {entry.unitNumber ? (
            <>
              <span className="text-muted-foreground"> · </span>
              <span className="tabular-nums">{entry.unitNumber}</span>
            </>
          ) : null}
        </span>
      ),
    },
    {
      id: 'statement',
      header: 'Verified statement',
      cell: (entry) => (
        <AppLink to={statementPath(entry)} className="whitespace-nowrap text-foreground hover:underline" onClick={(event) => event.stopPropagation()}>
          <DateDisplay value={entry.statementDate} />
        </AppLink>
      ),
    },
    {
      id: 'age',
      header: 'Age',
      hideBelow: 'sm',
      cell: (entry) => (
        <span className="whitespace-nowrap tabular-nums">
          {entry.ageDays} {entry.ageDays === 1 ? 'day' : 'days'}
          <span className="text-muted-foreground"> · {bucketName(entry.bucket)}</span>
        </span>
      ),
    },
    { id: 'outstanding', header: 'Outstanding', align: 'right', cell: (entry) => <CurrencyDisplay amount={entry.outstanding} /> },
    {
      id: 'verifiedBy',
      header: 'Verified by',
      hideBelow: 'lg',
      cell: (entry) => {
        const by = verifierName(entry)
        return by ? <SignOff by={by} at={entry.verifiedAt} /> : <VerificationBadge verified {...(entry.verifiedAt ? { verifiedAt: entry.verifiedAt } : {})} />
      },
    },
  ]
}

/**
 * What the verified statements say the workspace is owed: the total outstanding, the tenants in arrears, the amount in
 * each of the company's ageing buckets and the statements still waiting for review. Every figure comes from the API
 * (each tenant's latest verified statement, calculated by the domain arrears rules); the screen only shows them. Each
 * figure opens the statements behind it: the totals and buckets list the tenants, each row opening its statement, and
 * the review figure opens the statements waiting for review.
 */
export function StatementArrearsSummary() {
  const navigate = useNavigate()
  const query = useStatementArrears()
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })
  const [bucket, setBucket] = useState<AgeingBucketLabel | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const memberNames = new Map((members.data?.items ?? []).map((member) => [member.id.toLowerCase(), member.fullName]))
  const verifierName = (entry: StatementArrearsEntry) => (entry.verifiedByUserId ? memberNames.get(entry.verifiedByUserId.toLowerCase()) : undefined)

  const summary = query.data
  const isLoading = query.isPending
  const showTenants = (next: AgeingBucketLabel | null) => {
    setBucket(next)
    tableRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  const rows = (summary?.entries ?? []).filter((entry) => bucket === null || entry.bucket === bucket)
  const underArrangement = summary?.tenantsUnderArrangement ?? 0

  return (
    <section aria-labelledby="statement-arrears-heading" className="mb-10 space-y-3">
      <h2 id="statement-arrears-heading" className="sr-only">
        Outstanding balances
      </h2>
      <MetricGrid columns={3}>
        <MetricCard
          lead
          label="Total outstanding"
          value={summary ? <CurrencyDisplay amount={summary.totalOutstanding} tone="none" /> : '—'}
          description={summary ? 'From verified statements only' : undefined}
          isLoading={isLoading}
          onClick={() => showTenants(null)}
        />
        <MetricCard
          label="Tenants in arrears"
          tone={summary && summary.tenantsInArrears > 0 ? 'danger' : 'neutral'}
          value={summary ? summary.tenantsInArrears : '—'}
          description={underArrangement > 0 ? `${underArrangement} under a payment arrangement` : undefined}
          isLoading={isLoading}
          onClick={() => showTenants(null)}
        />
        <MetricCard
          label="Waiting for review"
          tone={summary && summary.pendingReview > 0 ? 'warning' : 'neutral'}
          value={summary ? summary.pendingReview : '—'}
          description="Not counted until verified"
          isLoading={isLoading}
          href="/statements?status=review_required"
        />
      </MetricGrid>

      {query.isError ? null : (
        <div className="space-y-3 pt-7">
          <SectionHeader
            title="Arrears ageing"
            description={
              summary
                ? `Each tenant's latest verified statement, aged from its statement date to ${formatSADate(summary.asOf)}.`
                : "Each tenant's latest verified statement, aged from its statement date."
            }
            actions={
              bucket !== null ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setBucket(null)}>
                  Show every bucket
                </Button>
              ) : null
            }
          />
          {summary ? (
            <div
              role="group"
              aria-label="Outstanding by ageing bucket"
              className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-card *:outline *:outline-border sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]"
            >
              {summary.buckets.map((item) => {
                const selected = bucket === item.bucket
                return (
                  <button
                    key={item.bucket}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => showTenants(selected ? null : item.bucket)}
                    className={cn(
                      'flex min-w-0 flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
                      selected ? 'bg-accent' : 'bg-card',
                    )}
                  >
                    <span className="text-xs text-muted-foreground">
                      {bucketName(item.bucket)} <span className="tabular-nums">({item.description})</span>
                    </span>
                    <CurrencyDisplay amount={item.outstanding} tone="none" className="text-base font-medium text-foreground" />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {item.tenantCount} {item.tenantCount === 1 ? 'tenant' : 'tenants'}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
          <div ref={tableRef} className="scroll-mt-20">
            <DataTable
              caption={bucket === null ? 'Tenants in arrears' : `Tenants in arrears, ${bucketName(bucket)}`}
              columns={columns(verifierName)}
              rows={rows}
              getRowId={(entry) => entry.tenantId}
              isLoading={isLoading}
              onRowClick={(entry) => void navigate({ to: '/statements/$statementId', params: { statementId: entry.statementId } })}
              emptyState={
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {bucket === null ? 'No verified statement shows a balance outstanding.' : `No tenant's balance is in the ${bucketName(bucket)} bucket.`}
                </p>
              }
            />
          </div>
        </div>
      )}
      {query.isError ? (
        <p role="alert" className="text-sm text-muted-foreground">
          The arrears figures could not be loaded.{' '}
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </p>
      ) : null}
    </section>
  )
}
