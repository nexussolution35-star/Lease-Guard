import {
  ageArrears,
  arrearsByTenant,
  describeAgeingBucket,
  isoToday,
  shouldSuppressArrearsReminder,
  tenantCommunicationBlockers,
  type Communication,
  type LeaseListItem,
  type Statement,
  type Tenant,
} from '@leaseguard/domain'
import { BadgeCheck, Pencil } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { formatSAPhoneNumber } from '@/components/forms/phone'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  AppLink,
  ConfirmationDialog,
  CurrencyDisplay,
  DataTable,
  DateDisplay,
  EmptyState,
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
import { useArrangementList } from '@/features/arrangements/api/queries'
import { useCommunicationList } from '@/features/communications/api/queries'
import { useLeaseList } from '@/features/leases/api/queries'
import { LeaseTermBars } from '@/features/leases/components/LeaseTermBars'
import { useStatementList } from '@/features/statements/api/queries'
import { TenantUnitsSection } from '@/features/unit-assignments/components/TenantUnitsSection'
import { useMemberList } from '@/features/users/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'
import { labelFor } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { useValidateTenantWhatsApp } from '../api/queries'
import { REMINDER_BLOCKER_COPY, whatsappNumberStatus } from '../whatsappStatus'
import { TenantFormDialog } from './TenantFormDialog'

export interface TenantDetailScreenProps {
  tenant: Tenant
}

const LEASES_SHOWN = 25
const STATEMENTS_SHOWN = 10
const COMMUNICATIONS_SHOWN = 10
/** In the `lg` rail each detail reads as one row, label left and value right, as in a ledger. */
const RAIL_ITEM = 'lg:grid lg:grid-cols-[7.5rem_minmax(0,1fr)] lg:items-baseline lg:gap-x-3 lg:space-y-0 lg:[&>dt]:font-normal'
const RETRY = 'Try again in a moment.'

/** A member's name only when it is loaded: a sign-off never shows a placeholder as if it were a person. */
type SignerOf = (userId: string | undefined) => string | undefined

/** Who signed a record off and when; a sign-off whose member cannot be named still shows that it happened. */
function SignedOff({ by, at, signedLabel, className }: { by: string | undefined; at: string | undefined; signedLabel: string; className?: string }) {
  if (by) return <SignOff by={by} at={at} {...(className ? { className } : {})} />
  return (
    <span className={cn('text-sm text-muted-foreground', className)}>
      {signedLabel}
      {at ? (
        <>
          {' · '}
          <DateDisplay value={at} className="tabular-nums" />
        </>
      ) : null}
    </span>
  )
}

function statementColumns(signerOf: SignerOf): DataTableColumn<Statement>[] {
  return [
    {
      id: 'statementDate',
      header: 'Statement',
      cell: (statement) => (
        <>
          <AppLink to={`/statements/${encodeURIComponent(statement.id)}`} className="font-medium text-foreground tabular-nums hover:underline">
            <DateDisplay value={statement.statementDate} />
          </AppLink>
          <span className="block text-xs text-muted-foreground tabular-nums">
            <DateDisplay value={statement.periodStart} /> – <DateDisplay value={statement.periodEnd} />
          </span>
        </>
      ),
    },
    { id: 'status', header: 'Status', cell: (statement) => <StatusBadge status={statement.status} /> },
    {
      id: 'closingBalance',
      header: 'Closing balance',
      align: 'right',
      hideBelow: 'sm',
      // Figures count only once a person verified them: an unverified statement's balance is not shown as if it were.
      cell: (statement) =>
        statement.status === 'verified' ? (
          <CurrencyDisplay amount={statement.closingBalance ?? statement.totalDue} />
        ) : (
          <span className="text-muted-foreground">Not verified</span>
        ),
    },
    {
      id: 'signOff',
      header: 'Verified by',
      hideBelow: 'md',
      cell: (statement) =>
        statement.status === 'verified' ? (
          <SignedOff by={signerOf(statement.verifiedByUserId)} at={statement.verifiedAt} signedLabel="Verified" />
        ) : statement.status === 'rejected' || statement.status === 'duplicate' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <SignOff pendingLabel="Awaiting review" />
        ),
    },
  ]
}

const COMMUNICATION_COLUMNS: DataTableColumn<Communication>[] = [
  {
    id: 'date',
    header: 'Date',
    cell: (message) => <DateDisplay value={message.sentAt ?? message.receivedAt ?? message.createdAt} className="tabular-nums" />,
  },
  {
    id: 'message',
    header: 'Message',
    className: 'min-w-48 whitespace-normal',
    cell: (message) => (
      <>
        <span className="font-medium text-foreground">{labelFor(message.messageType)}</span>
        <span className="block text-xs text-muted-foreground">
          {message.direction === 'inbound' ? 'From the tenant' : 'To the tenant'} · {labelFor(message.channel)}
        </span>
      </>
    ),
  },
  { id: 'status', header: 'Status', cell: (message) => <StatusBadge status={message.status} /> },
]

function leaseColumns(signerOf: SignerOf): DataTableColumn<LeaseListItem>[] {
  return [
    {
      id: 'reference',
      header: 'Lease',
      cell: (lease) => (
        <AppLink to={`/leases/${encodeURIComponent(lease.id)}`} className="font-medium text-foreground tabular-nums hover:underline">
          {lease.reference}
        </AppLink>
      ),
    },
    {
      id: 'unit',
      header: 'Unit',
      cell: (lease) => (
        <div className="min-w-0">
          <AppLink to={`/units/${encodeURIComponent(lease.unitId)}`} className="text-foreground tabular-nums hover:underline">
            {lease.unitNumber}
          </AppLink>
          <AppLink to={`/properties/${encodeURIComponent(lease.propertyId)}`} className="block truncate text-xs text-muted-foreground hover:underline">
            {lease.propertyName}
          </AppLink>
        </div>
      ),
    },
    { id: 'status', header: 'Status', hideBelow: 'sm', cell: (lease) => <StatusBadge status={lease.status} /> },
    {
      id: 'verification',
      header: 'Terms verified by',
      hideBelow: 'md',
      cell: (lease) =>
        lease.verified ? (
          <SignedOff by={signerOf(lease.verifiedByUserId)} at={lease.verifiedAt} signedLabel="Terms verified" />
        ) : (
          <SignOff pendingLabel="Terms not verified" />
        ),
    },
  ]
}

/**
 * One tenant: its WhatsApp number and whether automated reminders can reach it (and why not), its arrears aged from the
 * latest verified statement only, its units and leases with their terms drawn to scale, its statement and communication
 * history, and its details in a side rail. Writers edit the tenant and validate its WhatsApp number. Every rule is
 * enforced by the API and `@leaseguard/domain`; the screen explains it.
 */
export function TenantDetailScreen({ tenant }: TenantDetailScreenProps) {
  const isWriter = useIsCompanyWriter()
  const [editing, setEditing] = useState(false)
  const [validating, setValidating] = useState(false)
  const validate = useValidateTenantWhatsApp()
  const [today] = useState(() => isoToday(new Date()))

  const tenantId = tenant.id
  const leases = useLeaseList({ page: 1, pageSize: LEASES_SHOWN, tenantId, sort: 'commencementDate', direction: 'desc' })
  // Arrears come from verified statements only, the latest per unit the tenant rents (domain `ageArrears`), added up
  // across units; statements in review never count.
  const latestVerified = useStatementList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, tenantId, status: 'verified', sort: 'statementDate', direction: 'desc' })
  const statements = useStatementList({ page: 1, pageSize: STATEMENTS_SHOWN, tenantId, sort: 'statementDate', direction: 'desc' })
  const communications = useCommunicationList({ page: 1, pageSize: COMMUNICATIONS_SHOWN, tenantId, sort: 'createdAt', direction: 'desc' })
  const arrangements = useArrangementList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, tenantId, status: 'active' })
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })
  const signerOf: SignerOf = (userId) =>
    userId ? members.data?.items.find((member) => member.id.toLowerCase() === userId.toLowerCase())?.fullName : undefined

  const arrearsEntries = latestVerified.data ? ageArrears(latestVerified.data.items, today) : []
  const arrearsTotal = arrearsByTenant(arrearsEntries)[0]
  // The oldest balance decides the ageing shown; the outstanding amount is the total across units.
  const arrears = arrearsEntries.length > 0 ? arrearsEntries.reduce((oldest, entry) => (entry.ageDays > oldest.ageDays ? entry : oldest)) : undefined
  const latestStatement = latestVerified.data?.items[0]
  const remindersPaused = arrangements.data ? shouldSuppressArrearsReminder(tenantId, arrangements.data.items, today) : false
  const blockers = tenantCommunicationBlockers(tenant)
  const number = whatsappNumberStatus(tenant)

  async function confirmValidation() {
    try {
      const saved = await validate.mutateAsync({ id: tenant.id, whatsappNumber: tenant.whatsappNumber })
      toast.success(`${formatSAPhoneNumber(saved.whatsappNumber)} validated`, { description: `WhatsApp number of ${saved.tradingName}.` })
    } catch (error) {
      toast.error('The number was not validated', { description: describeApiError(error, RETRY) })
      throw error
    }
  }

  const total = (query: { data?: { total: number } }) => query.data?.total ?? '—'
  const loading = (query: { isPending: boolean; isError: boolean }) => query.isPending && !query.isError
  const outstanding = arrearsTotal?.outstanding ?? 0

  return (
    <section>
      <PageHeader
        title={tenant.tradingName}
        status={
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            {tenant.legalName !== tenant.tradingName ? (
              <>
                <span className="font-medium text-foreground">{tenant.legalName}</span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span>{labelFor(tenant.businessType)}</span>
            <span aria-hidden="true">·</span>
            <StatusBadge status={tenant.status} />
          </p>
        }
        actions={
          isWriter ? (
            <Button type="button" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          ) : null
        }
      />

      {/* DOM order is the phone order: figures, then the work, then details. From `lg` the details move into a right rail. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <MetricGrid className="lg:col-start-1 lg:row-start-1 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <MetricCard
            lead
            label="Outstanding"
            value={latestVerified.isSuccess ? <CurrencyDisplay amount={outstanding} tone="none" /> : '—'}
            tone={outstanding > 0 ? 'warning' : 'neutral'}
            description={arrears ? describeAgeingBucket(arrears.bucket) : 'From verified statements'}
            isLoading={loading(latestVerified)}
          />
          <MetricCard label="Statements" value={total(statements)} isLoading={loading(statements)} />
          <MetricCard label="Messages" value={total(communications)} isLoading={loading(communications)} />
          <MetricCard label="Leases" value={total(leases)} isLoading={loading(leases)} />
        </MetricGrid>

        <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-2">
          <section aria-label="WhatsApp and reminders" className="space-y-3">
            <SectionHeader
              title="WhatsApp and reminders"
              actions={
                isWriter && !tenant.whatsappVerified ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setValidating(true)}>
                    <BadgeCheck aria-hidden="true" />
                    Validate number
                  </Button>
                ) : undefined
              }
            />
            <div className="divide-y divide-border rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">{formatSAPhoneNumber(tenant.whatsappNumber)}</p>
                  <StatusDot tone={number.tone}>{number.label}</StatusDot>
                </div>
                {tenant.whatsappVerified ? (
                  <SignedOff by={signerOf(tenant.whatsappValidatedByUserId)} at={tenant.whatsappValidatedAt} signedLabel="Validated" />
                ) : (
                  <SignOff pendingLabel="Awaiting validation" />
                )}
              </div>
              <div className="px-4 py-3 text-sm">
                {blockers.length === 0 ? (
                  <p className="text-muted-foreground">
                    Automated reminders are on: statements and payment reminders reach this number, each after a property manager approves it.
                    {remindersPaused ? ' Arrears reminders are paused while a payment arrangement is active.' : ''}
                  </p>
                ) : (
                  <>
                    <p className="font-medium text-foreground">Automated reminders are off</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                      {blockers.map((blocker) => (
                        <li key={blocker}>{REMINDER_BLOCKER_COPY[blocker]}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </section>

          <section aria-label="Arrears" className="space-y-3">
            <SectionHeader title="Arrears" description="Aged from the latest verified statement; statements still in review do not count." />
            {latestVerified.isPending ? (
              <LoadingState label="Loading the arrears…" rows={2} />
            ) : latestVerified.isError ? (
              <ErrorState title="Could not load the arrears" error={describeApiError(latestVerified.error, RETRY)} onRetry={() => void latestVerified.refetch()} />
            ) : !latestStatement ? (
              <EmptyState title="No verified statements yet" description="Arrears appear once a statement for this tenant has been verified." className="py-0" />
            ) : (
              <div className="rounded-lg border border-border px-4 py-3">
                <InformationGrid columns={3} className="gap-y-3">
                  <InformationItem label="Outstanding" value={<CurrencyDisplay amount={outstanding} />} />
                  <InformationItem
                    label="Age"
                    value={arrears ? `${arrears.ageDays} days (${describeAgeingBucket(arrears.bucket)})` : 'Nothing outstanding'}
                  />
                  <InformationItem
                    label="Statement"
                    value={
                      <AppLink to={`/statements/${encodeURIComponent(latestStatement.id)}`} className="text-foreground tabular-nums hover:underline">
                        <DateDisplay value={latestStatement.statementDate} />
                      </AppLink>
                    }
                  />
                </InformationGrid>
                {remindersPaused ? (
                  <p className="mt-3 border-t border-border pt-3 text-sm">
                    <StatusDot tone="info">Payment arrangement active: arrears reminders are paused</StatusDot>
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <TenantUnitsSection tenant={tenant} canWrite={isWriter} />

          <section aria-label="Unit and lease" className="space-y-3">
            <SectionHeader
              title="Unit and lease"
              description={leases.data && leases.data.total > LEASES_SHOWN ? `The latest ${LEASES_SHOWN} of ${leases.data.total} leases.` : undefined}
            />
            {leases.isPending ? (
              <LoadingState label="Loading the leases…" rows={2} />
            ) : leases.isError ? (
              <ErrorState title="Could not load the leases" error={describeApiError(leases.error, RETRY)} onRetry={() => void leases.refetch()} />
            ) : leases.data.total === 0 ? (
              <EmptyState title="No lease yet" description="The tenant's unit and lease appear here once a lease is recorded for it." className="py-0" />
            ) : (
              <>
                <div className="rounded-lg border border-border px-4 pt-4 pb-3">
                  <LeaseTermBars leases={leases.data.items} today={today} />
                </div>
                <DataTable caption={`Leases of ${tenant.tradingName}`} columns={leaseColumns(signerOf)} rows={leases.data.items} getRowId={(lease) => lease.id} />
              </>
            )}
          </section>

          <section aria-label="Statement history" className="space-y-3">
            <SectionHeader
              title="Statement history"
              description={
                statements.data && statements.data.total > STATEMENTS_SHOWN
                  ? `The latest ${STATEMENTS_SHOWN} of ${statements.data.total} statements.`
                  : 'Statements imported for this tenant, newest first.'
              }
            />
            {statements.isPending ? (
              <LoadingState label="Loading the statements…" />
            ) : statements.isError ? (
              <ErrorState title="Could not load the statements" error={describeApiError(statements.error, RETRY)} onRetry={() => void statements.refetch()} />
            ) : statements.data.total === 0 ? (
              <EmptyState title="No statements yet" description="Statements uploaded for this tenant appear here." className="py-0" />
            ) : (
              <DataTable
                caption={`Statements of ${tenant.tradingName}`}
                columns={statementColumns(signerOf)}
                rows={statements.data.items}
                getRowId={(statement) => statement.id}
              />
            )}
          </section>

          <section aria-label="Communication history" className="space-y-3">
            <SectionHeader
              title="Communication history"
              description={
                communications.data && communications.data.total > COMMUNICATIONS_SHOWN
                  ? `The latest ${COMMUNICATIONS_SHOWN} of ${communications.data.total} messages.`
                  : 'Messages to and from this tenant, newest first.'
              }
            />
            {communications.isPending ? (
              <LoadingState label="Loading the messages…" />
            ) : communications.isError ? (
              <ErrorState title="Could not load the messages" error={describeApiError(communications.error, RETRY)} onRetry={() => void communications.refetch()} />
            ) : communications.data.total === 0 ? (
              <EmptyState title="No messages yet" description="Statements and payment reminders sent to this tenant appear here." className="py-0" />
            ) : (
              <DataTable
                caption={`Messages with ${tenant.tradingName}`}
                columns={COMMUNICATION_COLUMNS}
                rows={communications.data.items}
                getRowId={(message) => message.id}
              />
            )}
          </section>
        </div>

        <section aria-label="Details" className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-border lg:pl-8">
          <SectionHeader title="Details" className="[&_h2]:text-sm" />
          <InformationGrid columns={1} className="gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
            <InformationItem
              label="Contact person"
              className={RAIL_ITEM}
              value={
                <>
                  <span className="block">{tenant.primaryContact.fullName}</span>
                  {tenant.primaryContact.role ? <span className="block text-muted-foreground">{tenant.primaryContact.role}</span> : null}
                </>
              }
            />
            <InformationItem label="Phone" value={<span className="tabular-nums">{formatSAPhoneNumber(tenant.primaryContact.phone)}</span>} className={RAIL_ITEM} />
            <InformationItem label="Contact email" value={tenant.primaryContact.email} className={RAIL_ITEM} />
            <InformationItem label="Accounts email" value={tenant.email} className={RAIL_ITEM} />
            <InformationItem label="Registration" value={tenant.registrationNumber} className={RAIL_ITEM} />
            {tenant.accountReference ? <InformationItem label="Account reference" value={tenant.accountReference} className={RAIL_ITEM} /> : null}
            <InformationItem label="VAT number" value={tenant.vatNumber} className={RAIL_ITEM} />
            <InformationItem label="Industry" value={tenant.industry || undefined} className={RAIL_ITEM} />
            <InformationItem label="Added" value={<DateDisplay value={tenant.createdAt} className="tabular-nums" />} className={RAIL_ITEM} />
            <InformationItem label="Notes" value={tenant.notes} className={cn(RAIL_ITEM, 'sm:col-span-2 lg:col-span-1')} />
          </InformationGrid>
        </section>
      </div>

      {isWriter ? <TenantFormDialog open={editing} onOpenChange={setEditing} tenant={tenant} /> : null}
      <ConfirmationDialog
        open={validating}
        onOpenChange={setValidating}
        title={`Validate ${formatSAPhoneNumber(tenant.whatsappNumber)}?`}
        description={`Confirm that ${tenant.primaryContact.fullName} of ${tenant.tradingName} uses this number for WhatsApp. Statements and payment reminders can then be sent to it, each after a property manager approves it. Your name and the date are recorded.`}
        confirmLabel="Validate number"
        onConfirm={confirmValidation}
        isPending={validate.isPending}
      />
    </section>
  )
}
