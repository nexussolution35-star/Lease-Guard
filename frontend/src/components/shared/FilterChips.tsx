import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface FilterChip {
  id: string
  label: string
  onRemove: () => void
}

export interface FilterChipsProps {
  chips: FilterChip[]
  onClearAll?: () => void
  className?: string
}

export function FilterChips({ chips, onClearAll, className }: FilterChipsProps) {
  if (chips.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <li
            key={chip.id}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted py-0.5 pr-1 pl-2.5 text-xs font-medium text-foreground"
          >
            {chip.label}
            <button
              type="button"
              onClick={chip.onRemove}
              aria-label={`Remove filter: ${chip.label}`}
              className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {onClearAll && chips.length > 1 ? (
        <Button type="button" variant="link" size="xs" onClick={onClearAll}>
          Clear all
        </Button>
      ) : null}
    </div>
  )
}
