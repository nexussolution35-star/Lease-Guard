import type { ISODate, ISODateTime } from '@leaseguard/domain'

import { initialsOf } from '@/components/layout/initials'
import { cn } from '@/lib/utils'

import { DateDisplay } from './DateDisplay'

export interface SignOffProps {
  /** Who signed it off. Leave out while the sign-off is still pending. */
  by?: string | undefined
  /** When it was signed off (or requested, for a pending sign-off). */
  at?: ISODate | ISODateTime | undefined
  /** Text shown while nobody has signed it off. Default "Sign-off pending". */
  pendingLabel?: string
  className?: string
}

/**
 * LeaseGuard's logbook mark: who signed a record off and when. Signed, it shows the person's initials in a
 * ring, their name and the date. Pending, an open dashed ring and the pending text, so anything still
 * waiting on a person reads the same everywhere (lease verification, monitoring events, message approvals).
 */
export function SignOff({ by, at, pendingLabel = 'Sign-off pending', className }: SignOffProps) {
  const signed = by !== undefined && by.trim() !== ''
  return (
    <span data-slot="sign-off" data-state={signed ? 'signed' : 'pending'} className={cn('inline-flex min-w-0 items-center gap-2 text-sm', className)}>
      {signed ? (
        <span
          aria-hidden="true"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-medium text-foreground"
        >
          {initialsOf(by)}
        </span>
      ) : (
        <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-[1.5px] border-dashed border-warning" />
      )}
      <span className={cn('min-w-0 truncate', signed ? 'text-foreground' : 'text-muted-foreground')}>
        {signed ? by : pendingLabel}
        {at ? (
          <>
            <span className="text-muted-foreground"> · </span>
            <DateDisplay value={at} className="text-muted-foreground tabular-nums" />
          </>
        ) : null}
      </span>
    </span>
  )
}
