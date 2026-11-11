import { Info, MailPlus } from 'lucide-react'
import { useId, useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { NoActiveWorkspace } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useIsCompanyAdmin } from '@/features/account/useActiveRole'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'

import { InvitationsSection } from './InvitationsSection'
import { InviteUserDialog } from './InviteUserDialog'
import { MembersSection } from './MembersSection'

/**
 * Settings → Users: who has access to the active workspace. Company admins manage members (change role, remove,
 * never themselves, never the last active company admin) and invitations (invite, resend, revoke); other members see
 * a read-only member list. The API enforces every rule; the screen explains them.
 */
export function UsersSettingsScreen() {
  const isAdmin = useIsCompanyAdmin()
  const companyId = useActiveCompanyId()
  const membersId = useId()
  const invitationsId = useId()
  const [inviting, setInviting] = useState(false)

  const header = (
    <PageHeader
      title="Users"
      description="People with access to this workspace and their roles."
      className="pb-0"
      actions={
        isAdmin && companyId !== null ? (
          <Button type="button" onClick={() => setInviting(true)}>
            <MailPlus aria-hidden="true" />
            Invite user
          </Button>
        ) : null
      }
    />
  )

  if (companyId === null) {
    return (
      <section className="space-y-6">
        {header}
        <NoActiveWorkspace />
      </section>
    )
  }

  return (
    <section className="space-y-6">
      {header}
      {isAdmin ? null : (
        <p className="flex gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          You can see who has access to this workspace. Only company admins can invite people, change roles or remove members.
        </p>
      )}
      <Card role="region" aria-labelledby={membersId}>
        <CardHeader>
          <CardTitle id={membersId} className="text-base">
            Members
          </CardTitle>
          <CardDescription>
            {isAdmin
              ? 'Nobody can change their own role or remove themselves, and the workspace always keeps at least one active company admin.'
              : 'Everyone who can sign in to this workspace.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MembersSection isAdmin={isAdmin} />
        </CardContent>
      </Card>
      {isAdmin ? (
        <Card role="region" aria-labelledby={invitationsId}>
          <CardHeader>
            <CardTitle id={invitationsId} className="text-base">
              Invitations
            </CardTitle>
            <CardDescription>
              Invitations are emailed shortly after you create or resend them. Someone who already has a LeaseGuard account sees the invitation
              when they sign in. Nobody joins until they accept.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvitationsSection onInvite={() => setInviting(true)} />
          </CardContent>
        </Card>
      ) : null}
      {isAdmin ? <InviteUserDialog open={inviting} onOpenChange={setInviting} /> : null}
    </section>
  )
}
