import { initialsOf } from '@/components/layout/initials'
import { useDateFormatter, type DateFormatter } from '@/lib/dateFormat'
import { TONE_CLASSES } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { ISODateTime } from '@leaseguard/domain'

import { STATUS_TEXT_CLASSES } from './tone'

export interface VerificationBadgeProps {
  verified: boolean
  verifiedAt?: ISODateTime
  /** Display name of the verifier. */
  verifiedBy?: string
  className?: string
}

function describe(formatDateTime: DateFormatter['dateTime'], verifiedAt?: ISODateTime, verifiedBy?: string): string | undefined {
  const parts: string[] = []
  if (verifiedAt) {
    try {
      parts.push(formatDateTime(verifiedAt))
    } catch {
      parts.push(verifiedAt)
    }
  }
  if (verifiedBy) parts.push(`by ${verifiedBy}`)
  return parts.length > 0 ? `Verified ${parts.join(' ')}` : undefined
}

/**
 * A lease term's verification in the logbook's sign-off marks: verified by a known person, their initials in a
 * ring; verified with no name on record, a filled success dot; not yet verified, the open dashed ring that every
 * record still waiting on a person's sign-off carries (see `SignOff`).
 */
export function VerificationBadge({ verified, verifiedAt, verifiedBy, className }: VerificationBadgeProps) {
  const { dateTime: formatDateTime } = useDateFormatter()
  if (!verified) {
    return (
      <span className={cn(STATUS_TEXT_CLASSES, className)}>
        <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-[1.5px] border-dashed border-warning" />
        <span
          data-tone="warning"
          title="Not verified. Not used as financial evidence until verified."
          className={TONE_CLASSES.warning}
        >
          Unverified
        </span>
      </span>
    )
  }
  const by = verifiedBy?.trim()
  return (
    <span className={cn(STATUS_TEXT_CLASSES, className)}>
      {by ? (
        <span
          aria-hidden="true"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-medium text-foreground"
        >
          {initialsOf(by)}
        </span>
      ) : (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
      )}
      <span data-tone="success" title={describe(formatDateTime, verifiedAt, verifiedBy)} className={TONE_CLASSES.success}>
        Verified
      </span>
    </span>
  )
}
