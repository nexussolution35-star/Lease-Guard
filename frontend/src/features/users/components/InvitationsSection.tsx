import { isApiError } from '@leaseguard/api-client'
import { MailPlus, RotateCw, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { ConfirmationDialog, DataTable, DateDisplay, EmptyState, ErrorState, LoadingState, StatusBadge, type DataTableColumn } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { describeApiError } from '@/lib/data/apiErrors'
import { DEFAULT_LIST_PAGE_SIZE, lastPageWhenPastEnd } from '@/lib/data/listParams'
import { labelFor } from '@/lib/labels'

import { useCompanyInvitationList, useResendInvitation, useRevokeInvitation } from '../api/queries'
import type { CompanyInvitation } from '../api/source'
import { canResendInvitation, canRevokeInvitation } from '../inviteSchema'
import { invitationActionError } from '../memberErrors'

/**
 * Invitations to the active workspace, newest first (company admins only). Resend queues the email again for a
 * pending, sent or failed invitation; revoke withdraws a pending or sent one so it can no longer be accepted.
 */
export function InvitationsSection({ onInvite }: { onInvite: () => void }) {
  const [page, setPage] = useState(1)
  const pageSize = DEFAULT_LIST_PAGE_SIZE
  const query = useCompanyInvitationList({ page, pageSize, sort: 'createdAt', direction: 'desc' })
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()
  const [revoking, setRevoking] = useState<CompanyInvitation | null>(null)

  const settled = query.isPlaceholderData ? undefined : query.data
  const lastPage = settled ? lastPageWhenPastEnd(page, settled) : null
  // A page past the end (the last record on it was removed) moves to the last page; adjusted during render.
  if (lastPage !== null) setPage(lastPage)

  async function resendInvitation(invitation: CompanyInvitation) {
    try {
      await resend.mutateAsync(invitation.id)
      toast.success(`The invitation to ${invitation.email} will be sent again shortly.`)
    } catch (error) {
      const copy = invitationActionError('resend', error)
      toast.error(copy.title, { description: copy.description })
    }
  }

  async function confirmRevoke() {
    if (!revoking) return
    try {
      await revoke.mutateAsync(revoking.id)
      toast.success(`The invitation to ${revoking.email} was revoked. It can no longer be accepted.`)
    } catch (error) {
      const copy = invitationActionError('revoke', error)
      toast.error(copy.title, { description: copy.description })
      // A 409 or 404 cannot succeed on retry: close the dialog; the refreshed list shows the current state.
      if (!(isApiError(error) && (error.status === 409 || error.isNotFound))) throw error
    }
  }

  const columns: DataTableColumn<CompanyInvitation>[] = [
    {
      id: 'email',
      header: 'Email',
      cell: (invitation) => (
        <span className="flex flex-col">
          <span className="break-all font-medium text-foreground">{invitation.email}</span>
          {invitation.fullName ? <span className="text-xs text-muted-foreground">{invitation.fullName}</span> : null}
        </span>
      ),
    },
    { id: 'role', header: 'Role', cell: (invitation) => labelFor(invitation.role) },
    {
      id: 'status',
      header: 'Status',
      cell: (invitation) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge status={invitation.status} />
          {invitation.status === 'failed' && invitation.failureReason ? (
            <span className="text-xs text-destructive">{invitation.failureReason}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'sentAt',
      header: 'Last sent',
      hideBelow: 'md',
      cell: (invitation) => (invitation.sentAt ? <DateDisplay value={invitation.sentAt} style="datetime" /> : <span className="text-muted-foreground">Not yet</span>),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (invitation) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canResendInvitation(invitation.status) || (resend.isPending && resend.variables === invitation.id)}
            aria-label={`Resend invitation to ${invitation.email}`}
            onClick={() => void resendInvitation(invitation)}
          >
            <RotateCw aria-hidden="true" />
            Resend
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canRevokeInvitation(invitation.status)}
            aria-label={`Revoke invitation to ${invitation.email}`}
            onClick={() => setRevoking(invitation)}
          >
            <XCircle aria-hidden="true" />
            Revoke
          </Button>
        </div>
      ),
    },
  ]

  const isPastEnd = query.data !== undefined && query.data.items.length === 0 && query.data.total > 0
  return (
    <>
      {query.isPending || isPastEnd ? (
        <LoadingState label="Loading the invitations…" />
      ) : query.isError ? (
        <ErrorState title="Could not load the invitations" error={describeApiError(query.error, 'Try again in a moment.')} onRetry={() => void query.refetch()} />
      ) : query.data.total === 0 ? (
        <EmptyState
          icon={MailPlus}
          title="No invitations yet"
          description="Invite colleagues to give them access to this workspace."
          action={
            <Button type="button" variant="outline" size="sm" onClick={onInvite}>
              <MailPlus aria-hidden="true" />
              Invite a colleague
            </Button>
          }
        />
      ) : (
        <DataTable
          caption="Invitations to this workspace"
          columns={columns}
          rows={query.data.items}
          getRowId={(invitation) => invitation.id}
          pagination={query.data.total > pageSize ? { page, pageSize, total: query.data.total, onPageChange: setPage } : undefined}
        />
      )}
      <ConfirmationDialog
        open={revoking !== null}
        onOpenChange={(open) => (open ? undefined : setRevoking(null))}
        title={revoking ? `Revoke the invitation to ${revoking.email}?` : 'Revoke the invitation?'}
        description="The invitation can no longer be accepted. Nobody loses access: revoking never removes a member. You can invite this person again later."
        confirmLabel="Revoke invitation"
        destructive
        onConfirm={confirmRevoke}
        isPending={revoke.isPending}
      />
    </>
  )
}
