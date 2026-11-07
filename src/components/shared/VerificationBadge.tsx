import { ShieldAlert, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { formatSADateTime } from '@/domain'
import { TONE_CLASSES } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { ISODateTime } from '@/types'

export interface VerificationBadgeProps {
  verified: boolean
  verifiedAt?: ISODateTime
  /** Display name of the verifier. */
  verifiedBy?: string
  className?: string
}

function describe(verifiedAt?: ISODateTime, verifiedBy?: string): string | undefined {
  const parts: string[] = []
  if (verifiedAt) {
    try {
      parts.push(formatSADateTime(verifiedAt))
    } catch {
      parts.push(verifiedAt)
    }
  }
  if (verifiedBy) parts.push(`by ${verifiedBy}`)
  return parts.length > 0 ? `Verified ${parts.join(' ')}` : undefined
}

export function VerificationBadge({ verified, verifiedAt, verifiedBy, className }: VerificationBadgeProps) {
  if (!verified) {
    return (
      <Badge
        variant="outline"
        data-tone="warning"
        title="Not verified. Not used as financial evidence until verified."
        className={cn(TONE_CLASSES.warning, className)}
      >
        <ShieldAlert aria-hidden="true" />
        Unverified
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      data-tone="success"
      title={describe(verifiedAt, verifiedBy)}
      className={cn(TONE_CLASSES.success, className)}
    >
      <ShieldCheck aria-hidden="true" />
      Verified
    </Badge>
  )
}
