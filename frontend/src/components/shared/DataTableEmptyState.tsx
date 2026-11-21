import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { EmptyState } from './EmptyState'

export interface DataTableEmptyStateProps {
  title?: string
  description?: string
  action?: ReactNode
  /** True when search/filters are active; changes the default copy and offers "Clear filters". */
  isFiltered?: boolean
  onClearFilters?: () => void
  className?: string
}

export function DataTableEmptyState({
  title,
  description,
  action,
  isFiltered = false,
  onClearFilters,
  className,
}: DataTableEmptyStateProps) {
  const resolvedTitle = title ?? (isFiltered ? 'No matching records' : 'No records yet')
  const resolvedDescription =
    description ?? (isFiltered ? 'Try a different search or remove some filters.' : undefined)
  const resolvedAction =
    action ??
    (isFiltered && onClearFilters ? (
      <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
        Clear filters
      </Button>
    ) : undefined)

  return (
    <EmptyState
      title={resolvedTitle}
      description={resolvedDescription}
      action={resolvedAction}
      className={cn('px-3 py-10', className)}
    />
  )
}
