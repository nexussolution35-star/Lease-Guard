import { labelFor, toneFor } from '@/lib/labels'

import { StatusDot } from './StatusDot'

export interface StatusBadgeProps {
  /** Enum value, e.g. `under_review`. */
  status: string
  /** Overrides the label from `labelFor(status)`. */
  label?: string
  className?: string
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <StatusDot tone={toneFor(status)} awaitingApproval={status === 'pending_approval'} {...(className ? { className } : {})}>
      {label ?? labelFor(status)}
    </StatusDot>
  )
}
