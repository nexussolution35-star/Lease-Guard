import { isApiError } from '@leaseguard/api-client'
import { AlertCircle, Check, Info, MailCheck, Paperclip, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { TextAreaField, zodResolver } from '@/components/forms'
import { PageHeader } from '@/components/layout/PageHeader'
import { AppLink, DataTablePagination, DateDisplay, EmptyState, ErrorState, FormDialog, LoadingState, NoActiveWorkspace } from '@/components/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form } from '@/components/ui/form'
import { useIsCompanyWriter } from '@/features/account/useActiveRole'
import { useTenantQuery } from '@/features/tenants/api/queries'
import { describeApiError } from '@/lib/data/apiErrors'
import { lastPageWhenPastEnd } from '@/lib/data/listParams'
import { isAwaitingWorkspace } from '@/lib/data/queries'
import { labelFor } from '@/lib/labels'

import { useApproveCommunication, usePendingApprovals, useRejectCommunication } from '../api/queries'
import type { PendingApproval } from '../api/source'

/** Longest note or reason the API accepts. */
const NOTE_MAX_LENGTH = 1000

export interface ApprovalsQueueProps {
  page: number
  pageSize: number
  onPageChange: (page: number) => void
}

/**
 * Messages awaiting approval in the active workspace, oldest request first. Every member can see the queue;
 * company admins and property managers approve (the message is queued for delivery) or reject it with a reason.
 * Approving asks the API's outbound gate first: when delivery would refuse the message, every reason is shown
 * on the message and it stays pending until it is fixed or rejected.
 */
export function ApprovalsQueue({ page, pageSize, onPageChange }: ApprovalsQueueProps) {
  const query = usePendingApprovals({ page, pageSize })
  const canDecide = useIsCompanyWriter()

  // A page past the end of a queue that still has messages (the last message on a later page was decided,
  // a stale `?page=` link, a workspace switch) moves to the last page instead of saying nothing is waiting.
  const settled = query.isPlaceholderData ? undefined : query.data
  const lastPage = settled ? lastPageWhenPastEnd(page, settled) : null
  useEffect(() => {
    if (lastPage !== null) onPageChange(lastPage)
  }, [lastPage, onPageChange])

  // Messages exist but this page has none: keep loading while moving to the last page, never "nothing waiting".
  const isPastEnd = query.data !== undefined && query.data.items.length === 0 && query.data.total > 0
  const header = (
    <PageHeader
      title="Message approvals"
      description="Tenant statement and payment messages wait here for a property manager's approval before they are sent."
    />
  )

  if (isAwaitingWorkspace(query)) {
    return (
      <section>
        {header}
        <NoActiveWorkspace />
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {header}
      <Alert>
        <Info aria-hidden="true" />
        <AlertDescription>
          {canDecide
            ? 'Approved messages are sent on WhatsApp from this workspace’s connected number. Before approving, LeaseGuard checks everything delivery checks; if the message cannot be sent, it shows what to fix.'
            : 'Only company admins and property managers can approve or reject messages. You can see what is waiting.'}
        </AlertDescription>
      </Alert>
      {query.isPending || isPastEnd ? (
        <LoadingState label="Loading messages awaiting approval…" rows={3} />
      ) : query.isError ? (
        <ErrorState title="Could not load messages awaiting approval" error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.total === 0 ? (
        <EmptyState icon={MailCheck} title="Nothing awaiting approval" description="Tenant messages that need a decision appear here." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {query.data.total === 1 ? '1 message awaiting approval' : `${query.data.total} messages awaiting approval`}
          </p>
          <ol className="space-y-4" aria-label="Messages awaiting approval">
            {query.data.items.map((pending) => (
              <li key={pending.approval.id}>
                <PendingMessage pending={pending} canDecide={canDecide} />
              </li>
            ))}
          </ol>
          {query.data.total > pageSize ? (
            <DataTablePagination page={page} pageSize={pageSize} total={query.data.total} onPageChange={onPageChange} />
          ) : null}
        </>
      )}
    </section>
  )
}

/** Who the message goes to: the tenant's trading name when it is a tenant message. */
function Recipient({ pending }: { pending: PendingApproval }) {
  const { communication } = pending
  const tenantId = communication.tenantId ?? ''
  const tenant = useTenantQuery(tenantId, { enabled: communication.tenantId !== undefined })
  if (communication.tenantId === undefined) return <span>{labelFor(communication.recipientType)}</span>
  return (
    <AppLink to={`/tenants/${encodeURIComponent(communication.tenantId)}`} className="font-medium text-primary hover:underline">
      {tenant.data?.tradingName ?? 'View tenant'}
    </AppLink>
  )
}

function PendingMessage({ pending, canDecide }: { pending: PendingApproval; canDecide: boolean }) {
  const headingId = useId()
  const { communication, approval } = pending
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null)
  const [blockers, setBlockers] = useState<readonly string[]>([])

  return (
    <Card role="article" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId} className="flex flex-wrap items-center gap-2">
          {labelFor(communication.messageType)}
          <Badge variant="outline">{labelFor(communication.recipientType)}</Badge>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            To <Recipient pending={pending} />
          </span>
          {communication.counterpartyNumber ? <span>· {communication.counterpartyNumber}</span> : null}
          <span>· from {communication.companyNumber}</span>
          <span>
            · requested <DateDisplay value={approval.requestedAt} style="datetime" />
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
          {communication.body}
        </p>
        {communication.attachment ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Paperclip aria-hidden="true" className="size-4" />
            {communication.attachment.fileName}
          </p>
        ) : null}
        {blockers.length > 0 ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>This message cannot be sent yet</AlertTitle>
            <AlertDescription>
              <p>Fix the following, then approve again, or reject the message:</p>
              <ul className="list-disc pl-5">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {canDecide ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => setDialog('approve')}>
              <Check aria-hidden="true" />
              Approve
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setDialog('reject')}>
              <X aria-hidden="true" />
              Reject
            </Button>
          </div>
        ) : null}
      </CardContent>
      {canDecide ? (
        <>
          <ApproveDialog
            open={dialog === 'approve'}
            onOpenChange={(open) => setDialog(open ? 'approve' : null)}
            communicationId={communication.id}
            onBlocked={(reasons) => {
              setBlockers(reasons)
              setDialog(null)
            }}
            onApproved={() => setBlockers([])}
          />
          <RejectDialog open={dialog === 'reject'} onOpenChange={(open) => setDialog(open ? 'reject' : null)} communicationId={communication.id} />
        </>
      ) : null}
    </Card>
  )
}

const approveSchema = z.object({ note: z.string().max(NOTE_MAX_LENGTH, 'At most 1 000 characters') })
type ApproveValues = z.infer<typeof approveSchema>

function ApproveDialog({
  open,
  onOpenChange,
  communicationId,
  onBlocked,
  onApproved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  communicationId: string
  /** The API refused (422): delivery would refuse the message for these reasons. */
  onBlocked: (reasons: readonly string[]) => void
  onApproved: () => void
}) {
  const approve = useApproveCommunication()
  const form = useForm<ApproveValues>({ resolver: zodResolver(approveSchema), defaultValues: { note: '' } })
  const { reset } = form
  useEffect(() => {
    if (open) reset({ note: '' })
  }, [open, reset])
  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async ({ note }) => {
    const trimmed = note.trim()
    try {
      await approve.mutateAsync({ communicationId, ...(trimmed ? { note: trimmed } : {}) })
      onApproved()
      toast.success('Message approved and queued for sending')
      onOpenChange(false)
    } catch (failure) {
      if (isApiError(failure) && failure.status === 422 && failure.messages.length > 0) {
        onBlocked(failure.messages)
        return
      }
      form.setError('root', { type: 'server', message: describeApiError(failure, 'The message could not be approved. Try again.') })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Approve message"
      description="The message is queued and sent on WhatsApp. You are recorded as the approver."
      submitLabel="Approve and send"
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
    >
      <Form {...form}>
        {rootError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}
        <TextAreaField control={form.control} name="note" label="Note" description="Optional: kept with the approval." maxLength={NOTE_MAX_LENGTH} rows={3} />
      </Form>
    </FormDialog>
  )
}

const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'Give a reason for rejecting the message').max(NOTE_MAX_LENGTH, 'At most 1 000 characters'),
})
type RejectValues = z.input<typeof rejectSchema>

function RejectDialog({ open, onOpenChange, communicationId }: { open: boolean; onOpenChange: (open: boolean) => void; communicationId: string }) {
  const reject = useRejectCommunication()
  const form = useForm<RejectValues, unknown, z.output<typeof rejectSchema>>({ resolver: zodResolver(rejectSchema), defaultValues: { reason: '' } })
  const { reset } = form
  useEffect(() => {
    if (open) reset({ reason: '' })
  }, [open, reset])
  const rootError = form.formState.errors.root?.message

  const submit = form.handleSubmit(async ({ reason }) => {
    try {
      await reject.mutateAsync({ communicationId, reason })
      toast.success('Message rejected')
      onOpenChange(false)
    } catch (failure) {
      form.setError('root', { type: 'server', message: describeApiError(failure, 'The message could not be rejected. Try again.') })
    }
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Reject message"
      description="The message is never sent. The reason is kept with the decision and in the audit trail."
      submitLabel="Reject message"
      onSubmit={() => submit()}
      isPending={form.formState.isSubmitting}
    >
      <Form {...form}>
        {rootError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{rootError}</AlertDescription>
          </Alert>
        ) : null}
        <TextAreaField control={form.control} name="reason" label="Reason" maxLength={NOTE_MAX_LENGTH} rows={3} required />
      </Form>
    </FormDialog>
  )
}
