import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react'

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
  /**
   * Hide the column while the table itself is narrower than this size (a container query on the table's
   * scroll container, so the sidebar and drawers are taken into account): `sm` 32rem, `md` 38rem, `lg` 44rem (an `lg`
   * column still shows at a 1024px viewport beside the full sidebar, as it did with viewport breakpoints).
   */
  hideBelow?: 'sm' | 'md' | 'lg'
  /**
   * The column that names the record (tenant, property, lease). Its cells render as `<th scope="row">`, so
   * screen readers announce it with every other cell in the row. Looks the same as a normal cell.
   */
  rowHeader?: boolean
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
  /**
   * With `onRowClick`: a cell already holds a link to the same record. The row then stays clickable for the
   * mouse but is not its own tab stop; the link is the single keyboard target and the row is highlighted
   * while it has focus.
   */
  rowLinkInCell?: boolean
  sort?: DataTableSort
  onSortChange?: (sort: DataTableSort) => void
  toolbar?: ReactNode
  pagination?: DataTablePaginationProps
  selectable?: boolean
  selectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  /** With `selectable`: rows that may be selected (default all). Other rows show no checkbox and select-all skips them. */
  isRowSelectable?: (row: T) => boolean
  /** With `selectable`: the accessible name of a row's checkbox (default `Select row n`). */
  rowSelectionLabel?: (row: T) => string
  className?: string
}

// Container variants: the table's scroll container in components/ui/table.tsx is an inline-size container.
const HIDE_CLASSES: Readonly<Record<'sm' | 'md' | 'lg', string>> = {
  sm: 'hidden @min-[32rem]:table-cell',
  md: 'hidden @min-[38rem]:table-cell',
  lg: 'hidden @min-[44rem]:table-cell',
}

const ALIGN_CLASSES: Readonly<Record<'left' | 'right' | 'center', string>> = {
  left: 'text-left',
  right: 'text-right tabular-nums',
  center: 'text-center',
}

const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, label, [role="checkbox"], [role="menuitem"], [data-row-click-ignore]'

function isFromInteractiveChild(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null
  if (!target || target === event.currentTarget) return false
  const interactive = target.closest(INTERACTIVE_SELECTOR)
  return interactive !== null && event.currentTarget.contains(interactive)
}

/** Only the sorted column's header carries `aria-sort`; the others carry none (not `none`). */
function ariaSort(column: DataTableColumn<unknown>, sort?: DataTableSort): 'ascending' | 'descending' | undefined {
  if (!column.sortable || sort?.field !== column.id) return undefined
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

/**
 * Whether the element scrolls sideways. A table that overflows becomes a named, focusable region so the
 * keyboard can scroll it; one that fits gets no extra tab stop.
 */
function useHorizontalOverflow<E extends HTMLElement>(): [RefObject<E | null>, boolean] {
  const ref = useRef<E | null>(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    measure()
    return () => observer.disconnect()
  })
  return [ref, overflowing]
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
  rowLinkInCell = false,
  sort,
  onSortChange,
  toolbar,
  pagination,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  isRowSelectable,
  rowSelectionLabel,
  className,
}: DataTableProps<T>) {
  const selected = new Set(selectedIds)
  const allRowIds = rows.map(getRowId)
  const canSelect = rows.map((row) => isRowSelectable?.(row) ?? true)
  const rowIds = allRowIds.filter((_, index) => canSelect[index])
  const selectedOnPage = rowIds.filter((id) => selected.has(id)).length
  const allSelected = rowIds.length > 0 && selectedOnPage === rowIds.length
  const someSelected = selectedOnPage > 0 && !allSelected
  const columnCount = columns.length + (selectable ? 1 : 0)
  const captionId = useId()
  const [scrollRef, overflowing] = useHorizontalOverflow<HTMLDivElement>()
  const sortedColumn = sort ? columns.find((column) => column.id === sort.field && column.sortable) : undefined

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
    body = (
      <div className="border-y border-border">
        <ErrorState title="Could not load records" error={error} onRetry={onRetry} className="rounded-none border-0 px-3" />
      </div>
    )
  } else if (rows.length === 0) {
    body = <div className="border-y border-border">{emptyState ?? <DataTableEmptyState />}</div>
  } else {
    body = (
      <Table
        containerProps={{
          ref: scrollRef,
          ...(overflowing
            ? { role: 'region', 'aria-labelledby': captionId, tabIndex: 0 }
            : {}),
          className: 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        }}
      >
        <TableCaption id={captionId} className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {selectable ? (
              <TableHead className="w-10">
                {rowIds.length > 0 ? (
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={(checked) => toggleAll(checked === true)}
                    aria-label="Select all rows on this page"
                  />
                ) : null}
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
                        '-mx-2 inline-flex items-center gap-1 rounded-sm px-2 py-1 font-medium transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden', isSorted && 'text-foreground',
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
            const id = allRowIds[index]!
            const isSelected = selected.has(id)
            const clickable = Boolean(onRowClick)
            const rowFocusable = clickable && !rowLinkInCell
            return (
              <TableRow
                key={id}
                data-state={isSelected ? 'selected' : undefined}
                tabIndex={rowFocusable ? 0 : undefined}
                onClick={
                  clickable
                    ? (event) => {
                        if (isFromInteractiveChild(event)) return
                        onRowClick?.(row)
                      }
                    : undefined
                }
                onKeyDown={
                  rowFocusable
                    ? (event) => {
                        if (event.key !== 'Enter' || event.target !== event.currentTarget) return
                        event.preventDefault()
                        onRowClick?.(row)
                      }
                    : undefined
                }
                className={cn(
                  clickable &&
                    'cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[state=selected]:bg-accent/60',
                  clickable && rowLinkInCell && 'has-[a:focus-visible]:bg-muted/50',
                )}
              >
                {selectable ? (
                  <TableCell className="w-10">
                    {canSelect[index] ? (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => toggleRow(id, checked === true)}
                        aria-label={rowSelectionLabel?.(row) ?? `Select row ${index + 1}`}
                      />
                    ) : null}
                  </TableCell>
                ) : null}
                {columns.map((column) => {
                  const cellClassName = cn(
                    ALIGN_CLASSES[column.align ?? 'left'],
                    column.hideBelow && HIDE_CLASSES[column.hideBelow],
                    column.className,
                  )
                  return column.rowHeader ? (
                    <th
                      key={column.id}
                      scope="row"
                      data-slot="table-cell"
                      className={cn('px-3 py-2.5 text-left align-middle font-normal whitespace-nowrap', cellClassName)}
                    >
                      {column.cell(row)}
                    </th>
                  ) : (
                    <TableCell key={column.id} className={cellClassName}>
                      {column.cell(row)}
                    </TableCell>
                  )
                })}
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
      {/* A ruled section of the logbook: header rule, hairline rows, no frame. */}
      <div className="min-w-0 text-foreground">
        {/* aria-sort changes are not reliably announced, so one polite live region says what the sort is (no role="status", which loading states use). */}
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {sortedColumn && sort ? `Sorted by ${sortedColumn.header}, ${sort.direction === 'asc' ? 'ascending' : 'descending'}` : ''}
        </p>
        {body}
        {pagination && !error ? (
          <DataTablePagination {...pagination} className={cn('border-t border-border px-3 pt-3', pagination.className)} />
        ) : null}
      </div>
    </div>
  )
}
