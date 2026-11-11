import { Pencil, UserMinus, Users } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmationDialog, DataTable, DateDisplay, EmptyState, ErrorState, LoadingState, StatusBadge, type DataTableColumn } from '@/components/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCurrentUserId } from '@/features/account/useActiveRole'
import { describeApiError } from '@/lib/data/apiErrors'
import { DEFAULT_LIST_PAGE_SIZE, lastPageWhenPastEnd } from '@/lib/data/listParams'
import { labelFor } from '@/lib/labels'

import { useActiveAdminCount, useMemberList, useRemoveMember } from '../api/queries'
import type { CompanyMember } from '../api/source'
import { memberActions } from '../memberActions'
import { memberActionError } from '../memberErrors'
import { ChangeRoleDialog } from './ChangeRoleDialog'

const sameId = (a: string, b: string | null): boolean => b !== null && a.toLowerCase() === b.toLowerCase()

/** The member's role and join date in the active workspace (a member list carries only that membership). */
const membershipOf = (member: CompanyMember) => member.memberships[0]

function MemberActions({
  member,
  isAdmin,
  currentUserId,
  activeAdminCount,
  onChangeRole,
  onRemove,
}: {
  member: CompanyMember
  isAdmin: boolean
  currentUserId: string | null
  activeAdminCount: number | undefined
  onChangeRole: () => void
  onRemove: () => void
}) {
  const reasonId = useId()
  const role = membershipOf(member)?.role
  const actions = role ? memberActions({ id: member.id, role, status: member.status }, { currentUserId, isAdmin, activeAdminCount }) : { canChangeRole: false, canRemove: false }
  const describedBy = actions.reason ? reasonId : undefined
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!actions.canChangeRole} aria-label={`Change role for ${member.fullName}`} aria-describedby={describedBy} onClick={onChangeRole}>
          <Pencil aria-hidden="true" />
          Change role
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!actions.canRemove} aria-label={`Remove ${member.fullName}`} aria-describedby={describedBy} onClick={onRemove}>
          <UserMinus aria-hidden="true" />
          Remove
        </Button>
      </div>
      {actions.reason ? (
        <p id={reasonId} className="max-w-xs text-right text-xs text-muted-foreground">
          {actions.reason}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Members of the active workspace with their role and status. Every member sees the list; company admins also change
 * roles and remove members, never themselves, and never the last active company admin (the API and database enforce
 * both and the screen explains them).
 */
export function MembersSection({ isAdmin }: { isAdmin: boolean }) {
  const [page, setPage] = useState(1)
  const pageSize = DEFAULT_LIST_PAGE_SIZE
  const query = useMemberList({ page, pageSize, sort: 'fullName', direction: 'asc' })
  const activeAdminCount = useActiveAdminCount({ enabled: isAdmin })
  const currentUserId = useCurrentUserId()
  const remove = useRemoveMember()
  const [changing, setChanging] = useState<CompanyMember | null>(null)
  const [removing, setRemoving] = useState<CompanyMember | null>(null)

  const settled = query.isPlaceholderData ? undefined : query.data
  const lastPage = settled ? lastPageWhenPastEnd(page, settled) : null
  // A page past the end (the last record on it was removed) moves to the last page; adjusted during render.
  if (lastPage !== null) setPage(lastPage)

  async function confirmRemove() {
    if (!removing) return
    try {
      await remove.mutateAsync(removing.id)
      toast.success(`${removing.fullName} was removed from this workspace.`)
    } catch (error) {
      const copy = memberActionError('remove', error)
      toast.error(copy.title, { description: copy.description })
      throw error
    }
  }

  const columns: DataTableColumn<CompanyMember>[] = [
    {
      id: 'fullName',
      header: 'Name',
      cell: (member) => (
        <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          {member.fullName}
          {sameId(member.id, currentUserId) ? <Badge variant="secondary">You</Badge> : null}
        </span>
      ),
    },
    { id: 'email', header: 'Email', cell: (member) => <span className="break-all">{member.email}</span> },
    { id: 'role', header: 'Role', cell: (member) => labelFor(membershipOf(member)?.role ?? '') },
    { id: 'status', header: 'Status', cell: (member) => <StatusBadge status={member.status} /> },
    { id: 'joinedAt', header: 'Joined', hideBelow: 'md', cell: (member) => <DateDisplay value={membershipOf(member)?.joinedAt} /> },
  ]
  if (isAdmin) {
    columns.push({
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (member) => (
        <MemberActions
          member={member}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          activeAdminCount={activeAdminCount}
          onChangeRole={() => setChanging(member)}
          onRemove={() => setRemoving(member)}
        />
      ),
    })
  }

  const isPastEnd = query.data !== undefined && query.data.items.length === 0 && query.data.total > 0
  return (
    <>
      {query.isPending || isPastEnd ? (
        <LoadingState label="Loading the members…" />
      ) : query.isError ? (
        <ErrorState title="Could not load the members" error={describeApiError(query.error, 'Try again in a moment.')} onRetry={() => void query.refetch()} />
      ) : query.data.total === 0 ? (
        <EmptyState icon={Users} title="No members" />
      ) : (
        <DataTable
          caption="Members of this workspace"
          columns={columns}
          rows={query.data.items}
          getRowId={(member) => member.id}
          pagination={query.data.total > pageSize ? { page, pageSize, total: query.data.total, onPageChange: setPage } : undefined}
        />
      )}
      <ChangeRoleDialog member={changing} currentRole={changing ? membershipOf(changing)?.role : undefined} onClose={() => setChanging(null)} />
      <ConfirmationDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        title={removing ? `Remove ${removing.fullName}?` : 'Remove member?'}
        description="They lose access to this workspace immediately. Their LeaseGuard account and any other workspaces stay. You can invite them again later."
        confirmLabel="Remove member"
        destructive
        onConfirm={confirmRemove}
        isPending={remove.isPending}
      />
    </>
  )
}
