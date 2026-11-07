import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface DataTablePaginationProps {
  /** 1-based. */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  /** Default [10, 25, 50, 100]. */
  pageSizeOptions?: number[]
  className?: string
}

export function DataTablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className,
}: DataTablePaginationProps) {
  const sizeLabelId = useId()
  const size = Math.max(1, pageSize)
  const pageCount = Math.max(1, Math.ceil(total / size))
  const current = Math.min(Math.max(1, page), pageCount)
  const start = total === 0 ? 0 : (current - 1) * size + 1
  const end = Math.min(current * size, total)
  const sizes = pageSizeOptions.includes(size) ? pageSizeOptions : [...pageSizeOptions, size].sort((a, b) => a - b)

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between', className)}
    >
      <p className="text-muted-foreground" aria-live="polite">
        {total === 0 ? (
          'No results'
        ) : (
          <>
            Showing <span className="font-medium tabular-nums text-foreground">{start}–{end}</span> of{' '}
            <span className="font-medium tabular-nums text-foreground">{total}</span>
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {onPageSizeChange ? (
          <div className="flex items-center gap-2">
            <span id={sizeLabelId} className="text-muted-foreground">
              Rows per page
            </span>
            <Select value={String(size)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger size="sm" aria-labelledby={sizeLabelId} className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-muted-foreground">
            Page {current} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(current - 1)}
            disabled={current <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(current + 1)}
            disabled={current >= pageCount}
            aria-label="Next page"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </nav>
  )
}
