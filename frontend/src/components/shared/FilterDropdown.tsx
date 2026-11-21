import { ChevronDown } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface FilterOption<T extends string> {
  value: T
  label: string
  count?: number
}

export interface FilterDropdownProps<T extends string> {
  label: string
  options: FilterOption<T>[]
  selected: T[]
  onChange: (values: T[]) => void
  className?: string
}

export function FilterDropdown<T extends string>({ label, options, selected, onChange, className }: FilterDropdownProps<T>) {
  const baseId = useId()
  const selectedSet = new Set<string>(selected)

  function toggle(value: T, checked: boolean) {
    if (checked) {
      if (!selectedSet.has(value)) onChange([...selected, value])
    } else {
      onChange(selected.filter((v) => v !== value))
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('h-9', selected.length > 0 && 'border-primary/50', className)}
          aria-label={selected.length > 0 ? `${label}, ${selected.length} selected` : label}
        >
          {label}
          {selected.length > 0 ? (
            <span className="text-xs font-medium tabular-nums text-primary">
              {selected.length}
            </span>
          ) : null}
          <ChevronDown className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <fieldset className="max-h-72 space-y-0.5 overflow-y-auto overscroll-contain p-2">
          <legend className="sr-only">{label}</legend>
          {options.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">No options</p> : null}
          {options.map((option) => {
            const id = `${baseId}-${option.value}`
            return (
              <Label
                key={option.value}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 font-normal hover:bg-accent"
              >
                <Checkbox
                  id={id}
                  aria-labelledby={`${id}-label`}
                  checked={selectedSet.has(option.value)}
                  onCheckedChange={(checked) => toggle(option.value, checked === true)}
                />
                <span id={`${id}-label`} className="min-w-0 flex-1">
                  {option.label}
                </span>
                {option.count !== undefined ? (
                  <span className="text-xs tabular-nums text-muted-foreground">{option.count}</span>
                ) : null}
              </Label>
            )
          })}
        </fieldset>
        {selected.length > 0 ? (
          <div className="border-t border-border p-1">
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
              Clear {label.toLowerCase()}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
