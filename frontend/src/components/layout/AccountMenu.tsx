import { Building2, KeyRound, LogOut, UserPen } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChangePasswordDialog, EditProfileDialog, sortedMemberships, useWorkspace, workspaceName } from '@/features/account'
import { useAuth } from '@/features/auth/authContext'
import { labelFor } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { initialsOf } from './initials'
import { ThemeSubMenu } from './ThemeSubMenu'
import { useSwitchWorkspace } from './useSwitchWorkspace'

export interface AccountMenuProps {
  className?: string
}

type OpenDialog = 'profile' | 'password' | null

/**
 * The signed-in user's account menu in the top bar: name, email and role in the active workspace;
 * edit profile, change password, switch workspace (with more than one membership), theme and sign
 * out. Falls back to the Supabase email address while the profile is not available.
 */
export function AccountMenu({ className }: AccountMenuProps) {
  const { user, signOut } = useAuth()
  const { profile, memberships, activeMembership } = useWorkspace()
  const switchWorkspace = useSwitchWorkspace()
  const [dialog, setDialog] = useState<OpenDialog>(null)

  const email = profile?.email ?? user?.email ?? null
  const name = profile?.fullName ?? email ?? 'Signed-in user'
  const role = activeMembership ? labelFor(activeMembership.role) : null
  const dialogProps = (which: Exclude<OpenDialog, null>) => ({
    open: dialog === which,
    onOpenChange: (open: boolean) => setDialog(open ? which : null),
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Account menu for ${name}`}
          className={cn(
            'flex items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            className,
          )}
        >
          <Avatar className="size-8">
            <AvatarFallback className="text-xs font-semibold">{initialsOf(name)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 min-w-0 lg:block">
            <span className="block truncate text-sm font-medium">{name}</span>
            {role ? <span className="block truncate text-xs text-muted-foreground">{role}</span> : null}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate font-medium">{name}</span>
            {email && email !== name ? <span className="block truncate text-xs text-muted-foreground">{email}</span> : null}
            {role && activeMembership ? (
              <span className="block truncate text-xs text-muted-foreground">
                {role} · {workspaceName(activeMembership)}
              </span>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!profile} onSelect={() => setDialog('profile')}>
            <UserPen aria-hidden="true" />
            Edit profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('password')}>
            <KeyRound aria-hidden="true" />
            Change password
          </DropdownMenuItem>
          {memberships.length > 1 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Building2 aria-hidden="true" />
                Switch workspace
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                <DropdownMenuRadioGroup
                  value={activeMembership?.companyId ?? ''}
                  onValueChange={(companyId) => {
                    const target = memberships.find((m) => m.companyId === companyId)
                    if (target) switchWorkspace(target)
                  }}
                >
                  {sortedMemberships(memberships).map((membership) => (
                    <DropdownMenuRadioItem key={membership.companyId} value={membership.companyId}>
                      <span className="min-w-0">
                        <span className="block truncate">{workspaceName(membership)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{labelFor(membership.role)}</span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <ThemeSubMenu />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              signOut().catch(() => toast.error('Could not sign out', { description: 'Try again in a moment.' }))
            }}
          >
            <LogOut aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {profile ? <EditProfileDialog {...dialogProps('profile')} profile={profile} /> : null}
      <ChangePasswordDialog {...dialogProps('password')} />
    </>
  )
}
