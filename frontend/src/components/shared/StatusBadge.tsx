import { Badge } from '@/components/ui/badge'
import { labelFor, toneFor, TONE_CLASSES } from '@/lib/labels'
import { cn } from '@/lib/utils'

export interface StatusBadgeProps {
  /** Enum value, e.g. `under_review`. */
  status: string
  /** Overrides the label from `labelFor(status)`. */
  label?: string
  className?: string
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const tone = toneFor(status)
  return (
    <Badge
      variant="outline"
      data-tone={tone}
      className={cn(TONE_CLASSES[tone], className)}
    >
      {label ?? labelFor(status)}
    </Badge>
  )
}
