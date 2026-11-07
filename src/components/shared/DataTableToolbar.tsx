import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { SearchInput } from './SearchInput'

export interface DataTableToolbarProps {
  search?: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }
  /** `FilterDropdown` elements. */
  filters?: ReactNode
  /** `SortControl`. */
  sort?: ReactNode
  /** Primary actions, aligned right on wide screens. */
  actions?: ReactNode
  /** `FilterChips`, shown on their own row. */
  chips?: ReactNode
  className?: string
}

export function DataTableToolbar({ search, filters, sort, actions, chips, className }: DataTableToolbarProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {search ? (
            <SearchInput
              value={search.value}
              onChange={search.onChange}
              placeholder={search.placeholder}
              label={search.label}
            />
          ) : null}
          {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
          {sort ? <div className="flex items-center gap-2">{sort}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div> : null}
      </div>
      {chips}
    </div>
  )
}
