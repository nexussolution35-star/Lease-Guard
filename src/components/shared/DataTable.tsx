import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { SortDirection } from '@/services/query'
import { cn } from '@/lib/utils'

import { DataTableEmptyState } from './DataTableEmptyState'
import { DataTableLoading } from './DataTableLoading'
import { DataTablePagination } from './DataTablePagination'
import type { DataTablePaginationProps } from './DataTablePagination'
import { ErrorState } from './ErrorState'

export interface DataTableColumn<T> {
  /** Stable id; also the sort field emitted by `onSortChange`. */
  id: string
  header: string
  cell: (row: T) => ReactNode
  sortable?: boolean
  align?: 'left' | 'right' | 'center'
  /** Hide the column below this breakpoint. */
  hideBelow?: 'sm' | 'md' | 'lg'
  className?: string
}

export interface DataTableSort {
  field: string
  direction: SortDirection
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: readonly T[]
  getRowId: (row: T) => string
  /** Screen-reader caption describing the table. */
  caption: string
  isLoading?: boolean
  error?: Error | string | null
  onRetry?: () => void
  /** Rendered when there are no rows. Defaults to `DataTableEmptyState`. */
  emptyState?: ReactNode
  onRowClick?: (row: T) => void
  sort?: DataTableSort
  onSortChange?: (sort: DataTableSort) => void
  toolbar?: ReactNode
  pagination?: DataTablePaginationProps
  selectable?: boolean
  selectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  className?: string
}

const HIDE_CLASSES: Readonly<Record<'sm' | 'md' | 'lg', string>> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
}

const ALIGN_CLASSES: Readonly<Record<'left' | 'right' | 'center', string>> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, label, [role="checkbox"], [role="menuitem"], [data-row-click-ignore]'

function isFromInteractiveChild(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null
  if (!target || target === event.currentTarget) return false
  const interactive = target.closest(INTERACTIVE_SELECTOR)
  return interactive !== null && event.currentTarget.contains(interactive)
}

function ariaSort(column: DataTableColumn<unknown>, sort?: DataTableSort): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sortable) return undefined
  if (sort?.field !== column.id) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  isLoading = false,
  error,
  onRetry,
  emptyState,
  onRowClick,
  sort,
  onSortChange,
  toolbar,
  pagination,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  className,
}: DataTableProps<T>) {
  const selected = new Set(selectedIds)
  const rowIds = rows.map(getRowId)
  const selectedOnPage = rowIds.filter((id) => selected.has(id)).length
  const allSelected = rowIds.length > 0 && selectedOnPage === rowIds.length
  const someSelected = selectedOnPage > 0 && !allSelected
  const columnCount = columns.length + (selectable ? 1 : 0)

  function toggleAll(checked: boolean) {
    if (!onSelectionChange) return
    if (checked) {
      onSelectionChange([...selectedIds, ...rowIds.filter((id) => !selected.has(id))])
    } else {
      const pageIds = new Set(rowIds)
      onSelectionChange(selectedIds.filter((id) => !pageIds.has(id)))
    }
  }

  function toggleRow(id: string, checked: boolean) {
    if (!onSelectionChange) return
    onSelectionChange(checked ? [...selectedIds, id] : selectedIds.filter((s) => s !== id))
  }

  function handleSort(column: DataTableColumn<T>) {
    if (!onSortChange) return
    const direction: SortDirection = sort?.field === column.id && sort.direction === 'asc' ? 'desc' : 'asc'
    onSortChange({ field: column.id, direction })
  }

  let body: ReactNode
  if (isLoading) {
    body = <DataTableLoading columns={Math.min(columnCount, 6)} />
  } else if (error) {
    body = <ErrorState title="Could not load records" error={error} onRetry={onRetry} className="m-4" />
  } else if (rows.length === 0) {
    body = emptyState ?? <DataTableEmptyState />
  } else {
    body = (
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {selectable ? (
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                  aria-label="Select all rows on this page"
                />
              </TableHead>
            ) : null}
            {columns.map((column) => {
              const align = column.align ?? 'left'
              const isSorted = sort?.field === column.id
              const SortIcon = !isSorted ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown
              return (
                <TableHead
                  key={column.id}
                  scope="col"
                  aria-sort={ariaSort(column as DataTableColumn<unknown>, sort)}
                  className={cn(
                    ALIGN_CLASSES[align],
                    column.hideBelow && HIDE_CLASSES[column.hideBelow],
                    column.className,
                  )}
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => handleSort(column)}
                      className={cn(
                        '-mx-2 inline-flex items-center gap-1 rounded-sm px-2 py-1 font-medium hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                        align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {column.header}
                      <SortIcon
                        className={cn('size-3.5', isSorted ? 'text-foreground' : 'text-muted-foreground')}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const id = rowIds[index]
            const isSelected = selected.has(id)
            const clickable = Boolean(onRowClick)
            return (
              <TableRow
                key={id}
                data-state={isSelected ? 'selected' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={
                  clickable
                    ? (event) => {
                        if (isFromInteractiveChild(event)) return
                        onRowClick?.(row)
                      }
                    : undefined
                }
                onKeyDown={
                  clickable
                    ? (event) => {
                        if (event.key !== 'Enter' || event.target !== event.currentTarget) return
                        event.preventDefault()
                        onRowClick?.(row)
                      }
                    : undefined
                }
                className={cn(
                  clickable &&
                    'cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                )}
              >
                {selectable ? (
                  <TableCell className="w-10">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => toggleRow(id, checked === true)}
                      aria-label={`Select row ${index + 1}`}
                    />
                  </TableCell>
                ) : null}
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn(
                      ALIGN_CLASSES[column.align ?? 'left'],
                      column.hideBelow && HIDE_CLASSES[column.hideBelow],
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      {toolbar}
      <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground">{body}</div>
      {pagination && !error ? <DataTablePagination {...pagination} /> : null}
    </div>
  )
}
