import {
  processingFailed,
  statementVerificationProblems,
  type DocumentExtractionIssue,
  type Statement,
  type StatementExtraction,
  type StatementLineItem,
} from '@leaseguard/domain'
import { BadgeCheck, Ban, Copy, RotateCw } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
  ConfirmationDialog,
  CurrencyDisplay,
  DataTable,
  DateDisplay,
  ErrorState,
  InformationGrid,
  InformationItem,
  LoadingState,
  MetricCard,
  MetricGrid,
  SectionHeader,
  SignOff,
  StatusBadge,
  StatusDot,
  type DataTableColumn,
} from '@/components/shared'
import { Button } from '@/components/ui/button'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { useLeaseQuery } from '@/features/leases/api/queries'
import { usePropertyQuery } from '@/features/properties/api/queries'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { labelFor } from '@/lib/labels'

import {
  useRejectStatement,
  useRetryStatementProcessing,
  useStatementExtraction,
  useStatementQuery,
  useVerifyStatement,
} from '../../api/queries'
import { MarkDuplicateDialog } from './MarkDuplicateDialog'
import { StatementFieldList } from './StatementFieldList'
import { StatementFileViewer } from './StatementFileViewer'
import { StatementMatchSection } from './StatementMatchSection'

const SOURCE_LABEL = (source: Statement['sourceSystem']) => (source === 'other' ? 'Other system' : source)

const LINE_COLUMNS: DataTableColumn<StatementLineItem>[] = [
  { id: 'date', header: 'Date', cell: (line) => <DateDisplay value={line.date} className="whitespace-nowrap tabular-nums" /> },
  {
    id: 'description',
    header: 'Description',
    className: 'min-w-48 whitespace-normal',
    cell: (line) => (
      <>
        {line.description}
        <span className="block text-xs text-muted-foreground">{labelFor(line.category)}</span>
      </>
    ),
  },
  { id: 'kind', header: 'Kind', hideBelow: 'sm', cell: (line) => labelFor(line.kind) },
  {
    id: 'amount',
    header: 'Amount',
    align: 'right',
    cell: (line) => <CurrencyDisplay amount={line.kind === 'charge' ? line.amount : -line.amount} tone="none" />,
  },
  {
    id: 'check',
    header: 'Check',
    hideBelow: 'md',
    cell: (line) => (line.flagged ? <StatusDot tone="warning">Check against the PDF</StatusDot> : <span className="text-muted-foreground">—</span>),
  },
]

export interface StatementReviewScreenProps {
  statement: Statement
}

/**
 * One statement (`/statements/$statementId`): the original PDF beside what was read from it. Each flagged field says
 * why and needs a confirmation or a correction; the tenant, unit and lease are chosen from the proposal or by hand; the
 * lines and the extraction's issues are listed. One primary action, Verify, offered once nothing is unresolved
 * (`statementVerificationProblems` lists what remains, the API checks again); Reject and Mark as duplicate are
 * secondary. A verified statement shows its figures and who verified it; rejected and duplicate statements say why.
 * Read-only for members who cannot write.
 */
export function StatementReviewScreen({ statement }: StatementReviewScreenProps) {
  const isWriter = useIsCompanyWriter()
  const underReview = statement.status === 'review_required'
  const canReview = isWriter && underReview
  const extraction = useStatementExtraction(statement.id)
  const lease = useLeaseQuery(statement.leaseId ?? '', { enabled: statement.leaseId !== undefined })
  const property = usePropertyQuery(statement.propertyId)
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })
  const verify = useVerifyStatement(statement.id)
  const reject = useRejectStatement(statement.id)
  const [confirmingVerify, setConfirmingVerify] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [markingDuplicate, setMarkingDuplicate] = useState(false)
  const remainingId = useId()

  /** A member's name only when it is loaded: a sign-off never shows a placeholder as if it were a person. */
  const signerOf = (userId: string | undefined) =>
    userId ? members.data?.items.find((member) => member.id.toLowerCase() === userId.toLowerCase())?.fullName : undefined

  const extracted = extraction.data ?? null
  const problems =
    underReview && extraction.isSuccess
      ? statementVerificationProblems({ statement, extraction: extracted, ...(lease.data ? { lease: lease.data } : {}) })
      : []
  const ready = underReview && extraction.isSuccess && (statement.leaseId === undefined || lease.isSuccess) && problems.length === 0
  const title = statement.statementNumber ? `Statement ${statement.statementNumber}` : statement.file.fileName

  async function confirmVerify() {
    try {
      const result = await verify.mutateAsync()
      toast.success('Statement verified', {
        description: result.monitoringQueued
          ? 'Arrears and escalation monitoring for the tenant is running now.'
          : 'Monitoring could not be started now; the daily monitoring run includes it.',
      })
    } catch (error) {
      toast.error('The statement was not verified', { description: describeApiError(error, 'Try again in a moment.') })
      throw error
    }
  }

  async function confirmReject(reason?: string) {
    try {
      await reject.mutateAsync(reason ?? '')
      toast.success('Statement rejected')
    } catch (error) {
      toast.error('The statement was not rejected', { description: describeApiError(error, 'Try again in a moment.') })
      throw error
    }
  }

  return (
    <section>
      <PageHeader
        title={title}
        status={
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            <span className="min-w-0 font-medium break-all text-foreground tabular-nums">{title}</span>
            <span aria-hidden="true">·</span>
            <span>{property.data?.name ?? (property.isPending ? '…' : 'Property')}</span>
            <span aria-hidden="true">·</span>
            <span>{SOURCE_LABEL(statement.sourceSystem)}</span>
            <span aria-hidden="true">·</span>
            <StatusBadge status={statement.status} {...(processingFailed(statement) ? { label: 'Processing failed' } : {})} />
          </p>
        }
        actions={
          canReview ? (
            <>
              <Button type="button" variant="outline" onClick={() => setRejecting(true)}>
                <Ban aria-hidden="true" />
                Reject
              </Button>
              <Button type="button" variant="outline" onClick={() => setMarkingDuplicate(true)}>
                <Copy aria-hidden="true" />
                Mark as duplicate
              </Button>
              <Button
                type="button"
                onClick={() => setConfirmingVerify(true)}
                disabled={!ready}
                {...(!ready && problems.length > 0 ? { 'aria-describedby': remainingId } : {})}
              >
                <BadgeCheck aria-hidden="true" />
                Verify
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-x-8">
        {/* DOM order is the phone order: where the statement stands, the original, then the work. */}
        <div className="flex min-w-0 flex-col gap-10 lg:col-start-2 lg:row-start-1">
          <Outcome statement={statement} signerOf={signerOf} isWriter={isWriter} problems={problems} remainingId={remainingId} ready={ready} />
        </div>

        <div className="min-w-0 lg:sticky lg:top-20 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:self-start">
          <StatementFileViewer statement={statement} />
        </div>

        <div className="flex min-w-0 flex-col gap-10 lg:col-start-2 lg:row-start-2">
          <section aria-label="Extracted values" className="space-y-3">
            <SectionHeader
              title="Extracted values"
              description={
                canReview
                  ? 'Check each flagged value against the original: confirm it, or correct it. A value that was not found is entered by hand.'
                  : 'What was read from the statement, and where the review stands with each value.'
              }
            />
            {extraction.isPending ? (
              <LoadingState label="Loading the extracted values…" rows={4} />
            ) : extraction.isError ? (
              <ErrorState
                title="Could not load the extracted values"
                error={describeApiError(extraction.error, 'Try again in a moment.')}
                onRetry={() => void extraction.refetch()}
              />
            ) : extracted === null ? (
              <p className="border-y border-border py-3 text-sm text-muted-foreground">
                {statement.status === 'uploaded' || statement.status === 'processing'
                  ? 'The statement is still being read. Its values appear here once processing finishes.'
                  : 'Nothing was read from this statement.'}
              </p>
            ) : (
              <StatementFieldList statementId={statement.id} fields={extracted.fields} issues={extracted.issues ?? []} canReview={canReview} signerOf={signerOf} />
            )}
          </section>

          <StatementMatchSection statement={statement} extraction={extracted} canReview={canReview} />

          <section aria-label="Statement lines" className="space-y-3">
            <SectionHeader title="Statement lines" description="Charges, payments and credits as read from the statement." />
            {statement.lineItems.length === 0 ? (
              <p className="border-y border-border py-3 text-sm text-muted-foreground">No lines were read from this statement.</p>
            ) : (
              <DataTable caption={`Lines of ${title}`} columns={LINE_COLUMNS} rows={[...statement.lineItems]} getRowId={(line) => line.id} />
            )}
          </section>

          {extracted ? <IssueList issues={extracted.issues ?? []} /> : null}

          <Details statement={statement} extraction={extracted} uploader={signerOf(statement.uploadedByUserId)} propertyName={property.data?.name} />
        </div>
      </div>

      {canReview ? (
        <>
          <ConfirmationDialog
            open={confirmingVerify}
            onOpenChange={setConfirmingVerify}
            title="Verify this statement?"
            description="Confirm you have checked every value against the original statement. Its figures become the monitoring record for the tenant (a record, never a payment), arrears and escalation monitoring run for them now, and your name and the time are recorded."
            confirmLabel="Verify"
            onConfirm={confirmVerify}
            isPending={verify.isPending}
          />
          <ConfirmationDialog
            open={rejecting}
            onOpenChange={setRejecting}
            title="Reject this statement?"
            description="A rejected statement is kept but never counts for monitoring. The reason is recorded with your name and the time."
            confirmLabel="Reject"
            destructive
            requireReason
            reasonLabel="Why is it rejected?"
            onConfirm={confirmReject}
            isPending={reject.isPending}
          />
          {markingDuplicate ? <MarkDuplicateDialog statement={statement} onClose={() => setMarkingDuplicate(false)} /> : null}
        </>
      ) : null}
    </section>
  )
}

interface OutcomeProps {
  statement: Statement
  signerOf: (userId: string | undefined) => string | undefined
  isWriter: boolean
  problems: readonly string[]
  remainingId: string
  /** Nothing remains (from `statementVerificationProblems`, once the extraction and lease are loaded). */
  ready: boolean
}

/** Where the statement stands: verified with its figures and sign-off, rejected or a duplicate with why, or what remains. */
function Outcome({ statement, signerOf, isWriter, problems, remainingId, ready }: OutcomeProps) {
  const retry = useRetryStatementProcessing()
  const duplicateOf = useStatementQuery(statement.duplicateOfStatementId ?? '', { enabled: statement.duplicateOfStatementId !== undefined })

  async function retryProcessing() {
    try {
      await retry.mutateAsync(statement.id)
      toast.success('Queued for processing again')
    } catch (error) {
      toast.error('The statement was not queued', { description: describeApiError(error, 'Try again in a moment.') })
    }
  }

  if (statement.status === 'verified') {
    const by = signerOf(statement.verifiedByUserId)
    return (
      <section aria-label="Verification" className="space-y-3">
        <SectionHeader title="Verification" description="Checked against the original statement; these figures are the tenant's monitoring record." />
        <div className="border-y border-border py-3">
          {by ? (
            <SignOff by={by} at={statement.verifiedAt} />
          ) : (
            <span className="text-sm text-foreground">
              Verified
              {statement.verifiedAt ? (
                <>
                  <span className="text-muted-foreground"> · </span>
                  <DateDisplay value={statement.verifiedAt} className="text-muted-foreground tabular-nums" />
                </>
              ) : null}
            </span>
          )}
        </div>
        {/* The panel sits beside the PDF, so the strip picks its column count from its own width (cells at least
            11rem) rather than forcing three narrow columns. */}
        <MetricGrid columns={2} className="grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))]">
          <MetricCard lead label="Outstanding balance" value={<CurrencyDisplay amount={statement.closingBalance} />} tone={(statement.closingBalance ?? 0) > 0 ? 'danger' : 'neutral'} />
          <MetricCard label="Total due" value={<CurrencyDisplay amount={statement.totalDue} tone="none" />} />
          <MetricCard label="Opening balance" value={<CurrencyDisplay amount={statement.openingBalance} tone="none" />} />
          <MetricCard label="Rental charged" value={<CurrencyDisplay amount={statement.rentalCharged} tone="none" />} />
          <MetricCard label="Additional charges" value={<CurrencyDisplay amount={statement.additionalCharges} tone="none" />} />
          <MetricCard label="Payments received" value={<CurrencyDisplay amount={statement.paymentsReceived} tone="none" />} />
        </MetricGrid>
      </section>
    )
  }

  if (statement.status === 'rejected') {
    return (
      <section aria-label="Verification" className="space-y-3">
        <SectionHeader title="Rejected" description="A rejected statement is kept but never counts for monitoring." />
        <div className="space-y-1 border-y border-border py-3 text-sm">
          <StatusDot tone="danger">Rejected</StatusDot>
          <p>{statement.rejectionReason ?? 'No reason was recorded.'}</p>
        </div>
      </section>
    )
  }

  if (statement.status === 'duplicate') {
    const other = duplicateOf.data
    return (
      <section aria-label="Verification" className="space-y-3">
        <SectionHeader title="Duplicate" description="A duplicate is kept but never counts for monitoring." />
        <div className="space-y-1 border-y border-border py-3 text-sm">
          <StatusDot tone="neutral">Duplicate</StatusDot>
          {statement.duplicateOfStatementId ? (
            <p>
              It repeats{' '}
              <AppLink to={`/statements/${encodeURIComponent(statement.duplicateOfStatementId)}`} className="font-medium text-foreground hover:underline">
                {other ? (other.statementNumber ? `statement ${other.statementNumber}` : other.file.fileName) : 'the other statement'}
              </AppLink>
              .
            </p>
          ) : (
            <p className="text-muted-foreground">The other statement is not recorded.</p>
          )}
        </div>
      </section>
    )
  }

  if (statement.status === 'uploaded' || statement.status === 'processing') {
    return (
      <section aria-label="Verification" className="space-y-3">
        <SectionHeader title="Verification" />
        <div className="border-y border-border py-3">
          <SignOff pendingLabel="Being read: nothing to review yet" />
        </div>
      </section>
    )
  }

  // Under review.
  return (
    <section aria-label="Verification" className="space-y-3">
      <SectionHeader
        title="Verification"
        description="Its figures count for monitoring only once a company admin or property manager verifies it."
      />
      <div className="space-y-3 border-y border-border py-3">
        <SignOff pendingLabel="Not verified" />
        {processingFailed(statement) ? (
          <div className="space-y-2 text-sm">
            <StatusDot tone="danger">Processing failed</StatusDot>
            <p className="text-muted-foreground">{statement.processingError}</p>
            {isWriter ? (
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={() => void retryProcessing()} disabled={retry.isPending}>
                  <RotateCw aria-hidden="true" className={retry.isPending ? 'motion-safe:animate-spin' : undefined} />
                  {retry.isPending ? 'Queueing…' : 'Retry processing'}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {problems.length > 0 ? (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Before it can be verified</h3>
            <ul id={remainingId} className="space-y-1 text-sm">
              {problems.map((problem) => (
                <li key={problem}>
                  <StatusDot tone="warning">{problem}</StatusDot>
                </li>
              ))}
            </ul>
          </div>
        ) : ready ? (
          <StatusDot tone="success">Every value is resolved and the tenant, unit and lease are set: ready to verify.</StatusDot>
        ) : null}
      </div>
    </section>
  )
}

const SEVERITY_TONE = { error: 'danger', warning: 'warning' } as const
const ISSUE_LABELS: Partial<Record<DocumentExtractionIssue['code'], string>> = {
  ocr_used: 'Read with OCR',
  scanned_without_ocr: 'Scanned, not read',
  typed_value_mismatch: 'Differs from what was typed',
  hint_mismatch: 'Not an expected value',
}

/** What the extraction reported: each issue as dot and text, with the field it concerns. */
function IssueList({ issues }: { issues: readonly DocumentExtractionIssue[] }) {
  return (
    <section aria-label="Issues" className="space-y-3">
      <SectionHeader title="Issues" description="What the extraction reported about this statement." />
      {issues.length === 0 ? (
        <p className="border-y border-border py-3 text-sm text-muted-foreground">No issues were reported.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.field ?? 'statement'}-${index}`} className="space-y-0.5 py-2.5 text-sm">
              <StatusDot tone={SEVERITY_TONE[issue.severity]}>
                {ISSUE_LABELS[issue.code] ?? labelFor(issue.code)}
                {issue.field ? <span className="text-muted-foreground"> · {labelFor(issue.field)}</span> : null}
              </StatusDot>
              <p className="text-muted-foreground">{issue.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Details({
  statement,
  extraction,
  uploader,
  propertyName,
}: {
  statement: Statement
  extraction: StatementExtraction | null
  uploader: string | undefined
  propertyName: string | undefined
}) {
  return (
    <section aria-label="Details" className="space-y-3">
      <SectionHeader title="Details" />
      <InformationGrid columns={2} className="gap-y-3">
        <InformationItem
          label="Property"
          value={
            <AppLink to={`/properties/${encodeURIComponent(statement.propertyId)}`} className="text-foreground hover:underline">
              {propertyName ?? 'Property'}
            </AppLink>
          }
        />
        <InformationItem label="Source system" value={SOURCE_LABEL(statement.sourceSystem)} />
        <InformationItem label="Statement number" value={statement.statementNumber} />
        <InformationItem label="Statement date" value={statement.statementDate ? <DateDisplay value={statement.statementDate} className="tabular-nums" /> : undefined} />
        <InformationItem
          label="Period"
          value={
            statement.periodStart && statement.periodEnd ? (
              <span className="tabular-nums">
                <DateDisplay value={statement.periodStart} /> – <DateDisplay value={statement.periodEnd} />
              </span>
            ) : undefined
          }
        />
        <InformationItem
          label="Uploaded"
          value={
            <span className="tabular-nums">
              {uploader ? `${uploader} · ` : null}
              <DateDisplay value={statement.uploadedAt} />
            </span>
          }
        />
        {extraction ? (
          <InformationItem
            label="Read by"
            value={
              <span className="tabular-nums">
                {extraction.engine} · {Math.round(extraction.overallConfidence * 100)}% overall confidence
              </span>
            }
          />
        ) : null}
      </InformationGrid>
    </section>
  )
}
