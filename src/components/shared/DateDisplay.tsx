import { daysBetween, formatSADate, formatSADateTime, isoToday } from '@/domain'
import { cn } from '@/lib/utils'
import type { ISODate, ISODateTime } from '@/types'

export type DateDisplayStyle = 'short' | 'long' | 'numeric' | 'datetime' | 'relative'

export interface DateDisplayProps {
  value: ISODate | ISODateTime | null | undefined
  /** Default `short` → `06 Nov 2026`. */
  style?: DateDisplayStyle
  /** Reference date for `relative`. Defaults to the current local date. */
  today?: ISODate
  className?: string
}

function relativeLabel(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`
}

function formatValue(value: string, style: DateDisplayStyle, today: ISODate | undefined): { text: string; title?: string } {
  const datePart = value.slice(0, 10)
  const hasTime = value.length > 10 && value.includes('T')
  switch (style) {
    case 'datetime':
      return { text: hasTime ? formatSADateTime(value) : formatSADate(datePart) }
    case 'relative': {
      const reference = today ?? isoToday(new Date())
      return {
        text: relativeLabel(daysBetween(reference, datePart)),
        title: hasTime ? formatSADateTime(value) : formatSADate(datePart),
      }
    }
    default:
      return { text: formatSADate(datePart, style) }
  }
}

export function DateDisplay({ value, style = 'short', today, className }: DateDisplayProps) {
  if (!value) {
    return (
      <span className={cn('text-muted-foreground', className)} aria-label="No date">
        —
      </span>
    )
  }

  let formatted: { text: string; title?: string }
  try {
    formatted = formatValue(value, style, today)
  } catch {
    formatted = { text: value }
  }

  return (
    <time dateTime={value} title={formatted.title} className={cn('whitespace-nowrap tabular-nums', className)}>
      {formatted.text}
    </time>
  )
}
