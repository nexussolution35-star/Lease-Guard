import { MailPlus } from 'lucide-react'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { NoActiveWorkspace, SectionHeader } from '@/components/shared'
import { Button } from '@/components/ui/button'
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
  const [inviting, setInviting] = useState(false)

  const header = (
    <PageHeader
      title="Users"
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
      <section>
        {header}
        <NoActiveWorkspace />
      </section>
    )
  }

  return (
    <section>
      {header}
      <div className="flex flex-col gap-8">
        {isAdmin ? null : (
          <p className="text-sm text-foreground">
            You can see who has access to this workspace. Only company admins can invite people, change roles or remove members.
          </p>
        )}
        <section aria-label="Members" className="space-y-4">
          <SectionHeader
            title="Members"
            {...(isAdmin
              ? { description: 'Nobody can change their own role or remove themselves, and the workspace always keeps at least one active company admin.' }
              : {})}
          />
          <MembersSection isAdmin={isAdmin} />
        </section>
        {isAdmin ? (
          <section aria-label="Invitations" className="space-y-4">
            <SectionHeader
              title="Invitations"
              description="Invitations are emailed shortly after you create or resend them. Someone who already has a LeaseGuard account sees the invitation when they sign in. Nobody joins until they accept."
            />
            <InvitationsSection onInvite={() => setInviting(true)} />
          </section>
        ) : null}
      </div>
      {isAdmin ? <InviteUserDialog open={inviting} onOpenChange={setInviting} /> : null}
    </section>
  )
}
