import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SortDirection } from '@/services/query'
import { cn } from '@/lib/utils'

export interface SortControlProps<F extends string> {
  options: { value: F; label: string }[]
  value?: { field: F; direction: SortDirection }
  onChange: (value: { field: F; direction: SortDirection }) => void
  className?: string
}

export function SortControl<F extends string>({ options, value, onChange, className }: SortControlProps<F>) {
  const labelId = useId()
  const direction: SortDirection = value?.direction ?? 'asc'
  const nextDirection: SortDirection = direction === 'asc' ? 'desc' : 'asc'

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <span id={labelId} className="sr-only">
        Sort by
      </span>
      <Select
        value={value?.field ?? ''}
        onValueChange={(field) => onChange({ field: field as F, direction })}
      >
        <SelectTrigger aria-labelledby={labelId} className="h-9 min-w-36">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={!value}
        onClick={() => value && onChange({ field: value.field, direction: nextDirection })}
        aria-label={direction === 'asc' ? 'Sorted ascending, switch to descending' : 'Sorted descending, switch to ascending'}
      >
        {direction === 'asc' ? <ArrowUpNarrowWide aria-hidden="true" /> : <ArrowDownWideNarrow aria-hidden="true" />}
      </Button>
    </div>
  )
}
