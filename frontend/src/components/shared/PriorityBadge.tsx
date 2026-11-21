import { AlertTriangle, ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { labelFor, toneFor, TONE_CLASSES } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { EventPriority } from '@leaseguard/domain'

import { STATUS_TEXT_CLASSES, TONE_TEXT_CLASSES } from './tone'

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
    <span
      data-tone={tone}
      title={`${labelFor(priority)} priority`}
      className={cn(STATUS_TEXT_CLASSES, TONE_CLASSES[tone], className)}
    >
      <Icon className={TONE_TEXT_CLASSES[tone]} aria-hidden="true" />
      {labelFor(priority)}
    </span>
  )
}
