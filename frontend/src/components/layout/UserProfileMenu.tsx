import { Monitor, Moon, RotateCcw, Sun, UserRoundCog } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { labelFor } from '@/lib/labels'
import { setThemePreference, useThemePreference, type ThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { membershipFor, useCompanyUsers, useCurrentRole, useCurrentUser } from '@/services/users'
import { useWorkspace } from '@/services/repository'
import { switchDemoUser } from '@/services/workspace'

import { ResetDemoDataDialog } from './ResetDemoDataDialog'

export interface UserProfileMenuProps {
  className?: string
}

const THEME_OPTIONS: readonly { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function isThemePreference(value: string): value is ThemePreference {
  return THEME_OPTIONS.some((o) => o.value === value)
}

export function UserProfileMenu({ className }: UserProfileMenuProps) {
  const user = useCurrentUser()
  const role = useCurrentRole()
  const users = useCompanyUsers()
  const { activeCompanyId } = useWorkspace()
  const theme = useThemePreference()
  const [confirmReset, setConfirmReset] = useState(false)

  const name = user?.fullName ?? 'Unknown user'
  const switchableUsers = users.filter((u) => u.status === 'active')

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
            <span className="block truncate text-xs text-muted-foreground">{role ? labelFor(role) : 'No role'}</span>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
            <span className="block text-xs text-muted-foreground">{role ? labelFor(role) : 'No role'}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <UserRoundCog aria-hidden="true" />
              Switch demo user
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <DropdownMenuRadioGroup
                value={user?.id ?? ''}
                onValueChange={(userId) => {
                  switchDemoUser(userId)
                  const next = switchableUsers.find((u) => u.id === userId)
                  if (next) toast.success(`Now acting as ${next.fullName}`)
                }}
              >
                {switchableUsers.map((u) => {
                  const userRole = membershipFor(u, activeCompanyId)?.role
                  return (
                    <DropdownMenuRadioItem key={u.id} value={u.id}>
                      <span className="min-w-0">
                        <span className="block truncate">{u.fullName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {userRole ? labelFor(userRole) : ''}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {theme === 'dark' ? <Moon aria-hidden="true" /> : theme === 'light' ? <Sun aria-hidden="true" /> : <Monitor aria-hidden="true" />}
              Theme
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => {
                  if (isThemePreference(value)) setThemePreference(value)
                }}
              >
                {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <Icon aria-hidden="true" />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirmReset(true)}>
            <RotateCcw aria-hidden="true" />
            Reset demo data
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ResetDemoDataDialog open={confirmReset} onOpenChange={setConfirmReset} />
    </>
  )
}
