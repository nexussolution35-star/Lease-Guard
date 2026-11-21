import type { ReactNode } from 'react'

import { TONE_CLASSES, type Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { STATUS_TEXT_CLASSES, TONE_SOLID_CLASSES } from './tone'

export interface StatusDotProps {
  tone: Tone
  /** The status text. */
  children: ReactNode
  /**
   * An open ring instead of a filled dot: the record waits on a person's sign-off (a tenant message
   * awaiting a property manager's approval). Used only for that, so the ring always means "not yet approved".
   */
  awaitingApproval?: boolean
  className?: string
}

/** A status as a dot in the tone's solid colour, then its text. `StatusBadge` resolves the tone from an enum value. */
export function StatusDot({ tone, children, awaitingApproval = false, className }: StatusDotProps) {
  return (
    <span data-tone={tone} className={cn(STATUS_TEXT_CLASSES, TONE_CLASSES[tone], className)}>
      {awaitingApproval ? (
        <ApprovalRing />
      ) : (
        <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', TONE_SOLID_CLASSES[tone])} />
      )}
      {children}
    </span>
  )
}

/** The awaiting-approval mark: an open ring in the warning tone, the same box as a status dot's row. */
export function ApprovalRing({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="approval-ring"
      className={cn('size-2 shrink-0 rounded-full border-[1.5px] border-warning', className)}
    />
  )
}
