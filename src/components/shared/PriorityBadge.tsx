import { AlertTriangle, ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { labelFor, toneFor, TONE_CLASSES } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { EventPriority } from '@/types'

export interface PriorityBadgeProps {
  priority: EventPriority
  className?: string
}

const PRIORITY_ICONS: Readonly<Record<EventPriority, LucideIcon>> = {
  low: ArrowDown,
  medium: Minus,
  high: ArrowUp,
  critical: AlertTriangle,
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const tone = toneFor(priority)
  const Icon = PRIORITY_ICONS[priority]
  return (
    <Badge
      variant="outline"
      data-tone={tone}
      title={`${labelFor(priority)} priority`}
      className={cn(TONE_CLASSES[tone], className)}
    >
      <Icon aria-hidden="true" />
      {labelFor(priority)}
    </Badge>
  )
}
