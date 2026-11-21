import type { LucideIcon } from 'lucide-react'

import type { Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { ISODateTime } from '@leaseguard/domain'

import { DateDisplay } from './DateDisplay'
import { SignOff } from './SignOff'
import { TONE_SOLID_CLASSES } from './tone'

export interface ActivityTimelineEntry {
  id: string
  title: string
  description?: string
  at: ISODateTime
  actor?: string
  /** `danger` and `warning` colour the rail dot; every other tone is neutral. */
  tone?: Tone
  /** Accepted for compatibility; the timeline shows a dot, not an icon. */
  icon?: LucideIcon
}

export interface ActivityTimelineItemProps {
  entry: ActivityTimelineEntry
  className?: string
}

export function ActivityTimelineItem({ entry, className }: ActivityTimelineItemProps) {
  const tone = entry.tone ?? 'neutral'
  return (
    <li className={cn('relative flex gap-3 pb-5 last:pb-0', className)}>
      <span
        aria-hidden="true"
        className="absolute top-4 bottom-0 left-1 w-px -translate-x-1/2 bg-border group-last/timeline-item:hidden"
      />
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          tone === 'danger' || tone === 'warning' ? TONE_SOLID_CLASSES[tone] : 'bg-muted-foreground/40',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{entry.title}</p>
        {entry.description ? <p className="mt-0.5 text-sm break-words text-foreground">{entry.description}</p> : null}
        {/* An audit entry names who made the change: that is a sign-off, so it carries the logbook mark. */}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {entry.actor ? (
            <SignOff by={entry.actor} className="text-xs" />
          ) : null}
          {entry.actor ? <span aria-hidden="true">·</span> : null}
          <DateDisplay value={entry.at} style="datetime" />
        </p>
      </div>
    </li>
  )
}
