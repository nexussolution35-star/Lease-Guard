import { Circle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { ISODateTime } from '@leaseguard/domain'

import { DateDisplay } from './DateDisplay'
import { TONE_SOFT_CLASSES } from './tone'

export interface ActivityTimelineEntry {
  id: string
  title: string
  description?: string
  at: ISODateTime
  actor?: string
  tone?: Tone
  icon?: LucideIcon
}

export interface ActivityTimelineItemProps {
  entry: ActivityTimelineEntry
  className?: string
}

export function ActivityTimelineItem({ entry, className }: ActivityTimelineItemProps) {
  const Icon = entry.icon ?? Circle
  const tone = entry.tone ?? 'neutral'
  return (
    <li className={cn('relative flex gap-3 pb-6 last:pb-0', className)}>
      <span
        aria-hidden="true"
        className="absolute top-8 bottom-0 left-4 w-px -translate-x-1/2 bg-border group-last/timeline-item:hidden"
      />
      <span
        className={cn(
          'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-background',
          TONE_SOFT_CLASSES[tone],
        )}
      >
        <Icon className={cn(entry.icon ? 'size-4' : 'size-2.5 fill-current')} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-sm font-medium text-foreground">{entry.title}</p>
        {entry.description ? <p className="mt-0.5 text-sm break-words text-muted-foreground">{entry.description}</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <DateDisplay value={entry.at} style="datetime" />
          {entry.actor ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{entry.actor}</span>
            </>
          ) : null}
        </p>
      </div>
    </li>
  )
}
