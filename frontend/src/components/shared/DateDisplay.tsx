import { daysBetween, isoToday } from '@leaseguard/domain'
import { useDateFormatter, type DateFormatter } from '@/lib/dateFormat'
import { cn } from '@/lib/utils'
import type { ISODate, ISODateTime } from '@leaseguard/domain'

/** `date` and `datetime` follow the display format chosen in Settings → Preferences. */
export type DateDisplayStyle = 'date' | 'datetime' | 'relative'

export interface DateDisplayProps {
  value: ISODate | ISODateTime | null | undefined
  /** Default `date` → `06 Nov 2026` in the default format. */
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

function formatValue(value: string, style: DateDisplayStyle, today: ISODate | undefined, formatter: DateFormatter): { text: string; title?: string } {
  const datePart = value.slice(0, 10)
  const hasTime = value.length > 10 && value.includes('T')
  switch (style) {
    case 'datetime':
      return { text: hasTime ? formatter.dateTime(value) : formatter.date(datePart) }
    case 'relative': {
      const reference = today ?? isoToday(new Date())
      return {
        text: relativeLabel(daysBetween(reference, datePart)),
        title: hasTime ? formatter.dateTime(value) : formatter.date(datePart),
      }
    }
    default:
      return { text: formatter.date(datePart) }
  }
}

export function DateDisplay({ value, style = 'date', today, className }: DateDisplayProps) {
  const formatter = useDateFormatter()
  if (!value) {
    return (
      <span className={cn('text-muted-foreground', className)}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">No date</span>
      </span>
    )
  }

  let formatted: { text: string; title?: string }
  try {
    formatted = formatValue(value, style, today, formatter)
  } catch {
    formatted = { text: value }
  }

  return (
    <time dateTime={value} title={formatted.title} className={cn('whitespace-nowrap tabular-nums', className)}>
      {formatted.text}
    </time>
  )
}
