import { Check, ChevronsUpDown, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { labelFor, toneFor, type Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { useWorkspaceSwitcher } from '@/services/workspace'

import { ResetDemoDataDialog } from './ResetDemoDataDialog'

export interface WorkspaceSwitcherProps {
  collapsed?: boolean
  className?: string
}

const DOT_CLASSES: Readonly<Record<Tone, string>> = {
  neutral: 'bg-muted-foreground',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  primary: 'bg-primary',
}

export function WorkspaceSwitcher({ collapsed = false, className }: WorkspaceSwitcherProps) {
  const { activeCompany, companies, switchTo } = useWorkspaceSwitcher()
  const [confirmReset, setConfirmReset] = useState(false)

  const initials = activeCompany?.initials ?? '—'
  const name = activeCompany?.tradingName ?? activeCompany?.name ?? 'No workspace'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Workspace: ${name}. Switch workspace`}
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-border bg-background p-1.5 text-left text-sm transition-colors',
            'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            collapsed && 'justify-center border-transparent bg-transparent p-1',
            className,
          )}
        >
          <Avatar className="size-7 rounded-md">
            <AvatarFallback className="rounded-md bg-primary text-xs font-semibold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{name}</span>
                <span className="block truncate text-xs text-muted-foreground">Workspace</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-72">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
          {companies.map(({ company, isMember, isActive }) => {
            const status = company.whatsapp.connectionStatus
            return (
              <DropdownMenuItem
                key={company.id}
                className="gap-2.5"
                onSelect={() => {
                  if (isActive) return
                  if (switchTo(company.id)) {
                    toast.success(`Switched to ${company.tradingName ?? company.name}`, {
                      description: isMember ? undefined : 'Signed in as a demo user from that company.',
                    })
                  } else {
                    toast.error('Could not switch workspace', {
                      description: 'No active user is a member of that company.',
                    })
                  }
                }}
              >
                <Avatar className="size-7 rounded-md">
                  <AvatarFallback className="rounded-md text-xs font-semibold">{company.initials}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{company.tradingName ?? company.name}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className={cn('size-1.5 rounded-full', DOT_CLASSES[toneFor(status)])}
                      aria-hidden="true"
                    />
                    WhatsApp: {labelFor(status)}
                    {isMember ? null : ' · not a member'}
                  </span>
                </span>
                {isActive ? <Check className="size-4 text-primary" aria-label="Active workspace" /> : null}
              </DropdownMenuItem>
            )
          })}
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
