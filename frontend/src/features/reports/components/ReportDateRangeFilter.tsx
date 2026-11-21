import { CalendarIcon } from 'lucide-react'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { parseISODate, toISODate, type ISODate } from '@leaseguard/domain'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDateFormatter } from '@/lib/dateFormat'
import { cn } from '@/lib/utils'

export interface ReportDateRangeFilterProps {
  /** What the range bounds, e.g. "Statement date". */
  field: string
  from: ISODate | undefined
  to: ISODate | undefined
  onChange: (range: { from: ISODate | undefined; to: ISODate | undefined }) => void
}

/** An inclusive date range on the report's primary date, shown in the viewer's date format. */
export function ReportDateRangeFilter({ field, from, to, onChange }: ReportDateRangeFilterProps) {
  const [open, setOpen] = useState(false)
  const { date } = useDateFormatter()
  const selected: DateRange | undefined = from ? { from: parseISODate(from), ...(to ? { to: parseISODate(to) } : {}) } : undefined
  const summary = from && to ? `${date(from)} – ${date(to)}` : from ? `From ${date(from)}` : to ? `Until ${date(to)}` : field

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('h-9 tabular-nums', (from || to) && 'border-primary/50')}
          aria-label={from || to ? `${field}: ${summary}` : `${field}: any date`}
        >
          <CalendarIcon className="text-muted-foreground" aria-hidden="true" />
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0" aria-label={`Choose the ${field.toLowerCase()} range`}>
        <Calendar
          mode="range"
          selected={selected}
          defaultMonth={selected?.from}
          onSelect={(range: DateRange | undefined) => {
            onChange({ from: range?.from ? toISODate(range.from) : undefined, to: range?.to ? toISODate(range.to) : undefined })
            if (range?.from && range.to) setOpen(false)
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
