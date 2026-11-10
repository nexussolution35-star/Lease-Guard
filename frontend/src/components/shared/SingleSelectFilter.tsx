import { useId } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const ALL = '__all__'

export interface SingleSelectFilterProps<T extends string> {
  label: string
  /** Label of the "no filter" option, e.g. "All statuses". */
  allLabel: string
  value: T | undefined
  options: readonly { value: T; label: string }[]
  onChange: (value: T | undefined) => void
}

/** Single-value list filter with an "all" option (API list filters accept one value each). */
export function SingleSelectFilter<T extends string>({ label, allLabel, value, options, onChange }: SingleSelectFilterProps<T>) {
  const labelId = useId()
  return (
    <div className="flex items-center gap-2">
      <span id={labelId} className="sr-only">
        {label}
      </span>
      <Select
        value={value ?? ALL}
        onValueChange={(next) => onChange(next === ALL ? undefined : options.find((o) => o.value === next)?.value)}
      >
        <SelectTrigger size="sm" aria-labelledby={labelId} className="h-9 min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
