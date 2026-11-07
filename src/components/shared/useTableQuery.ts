import { useCallback, useMemo, useState } from 'react'

import { DEFAULT_PAGE_SIZE } from '@/services/query'
import type { ListQuery, SortDirection } from '@/services/query'

export interface TableQueryState<T> {
  /** Pass straight to service list hooks, e.g. `useProperties(query)`. */
  query: ListQuery<T>
  setSearch: (search: string) => void
  /** Set an "IN" filter for a field. An empty array or `undefined` removes the filter. */
  setFilter: <K extends keyof T>(field: K, values: readonly T[K][] | undefined) => void
  clearFilters: () => void
  setSort: (sort: { field: keyof T; direction: SortDirection } | undefined) => void
  /** 1-based. */
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  /** `query.sort` shaped for `DataTable`'s `sort` prop. */
  tableSort: { field: string; direction: SortDirection } | undefined
  /** Adapter for `DataTable`'s `onSortChange` (column ids must be field names of `T`). */
  setTableSort: (sort: { field: string; direction: SortDirection }) => void
  /** Selected values for a filter field (empty when unset). */
  getFilter: <K extends keyof T>(field: K) => T[K][]
  /** True when search or any filter is active. */
  isFiltered: boolean
}

type Filters<T> = NonNullable<ListQuery<T>['filters']>

/** UI state for a list screen. Changing search, filters, sort or page size resets to page 1. */
export function useTableQuery<T>(initial: Partial<ListQuery<T>> = {}): TableQueryState<T> {
  const [query, setQuery] = useState<ListQuery<T>>(() => ({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    ...initial,
  }))

  const setSearch = useCallback((search: string) => {
    setQuery((q) => (q.search === search ? q : { ...q, search, page: 1 }))
  }, [])

  const setFilter = useCallback(<K extends keyof T>(field: K, values: readonly T[K][] | undefined) => {
    setQuery((q) => {
      const filters: Filters<T> = { ...(q.filters ?? {}) }
      if (!values || values.length === 0) {
        delete filters[field]
      } else {
        filters[field] = [...values]
      }
      return { ...q, filters, page: 1 }
    })
  }, [])

  const clearFilters = useCallback(() => {
    setQuery((q) => ({ ...q, filters: {}, search: '', page: 1 }))
  }, [])

  const setSort = useCallback((sort: { field: keyof T; direction: SortDirection } | undefined) => {
    setQuery((q) => ({ ...q, sort, page: 1 }))
  }, [])

  const setPage = useCallback((page: number) => {
    setQuery((q) => ({ ...q, page: Math.max(1, Math.floor(page)) }))
  }, [])

  const setPageSize = useCallback((pageSize: number) => {
    setQuery((q) => ({ ...q, pageSize: Math.max(1, Math.floor(pageSize)), page: 1 }))
  }, [])

  const setTableSort = useCallback(
    (sort: { field: string; direction: SortDirection }) => setSort({ field: sort.field as keyof T, direction: sort.direction }),
    [setSort],
  )

  const getFilter = useCallback(
    <K extends keyof T>(field: K): T[K][] => {
      const value: unknown = query.filters?.[field]
      if (value === undefined) return []
      return (Array.isArray(value) ? value : [value]) as T[K][]
    },
    [query.filters],
  )

  const tableSort = useMemo(
    () => (query.sort ? { field: String(query.sort.field), direction: query.sort.direction } : undefined),
    [query.sort],
  )

  const isFiltered =
    Boolean(query.search && query.search.trim() !== '') ||
    Object.values(query.filters ?? {}).some((v) => v !== undefined && (!Array.isArray(v) || v.length > 0))

  return {
    query,
    setSearch,
    setFilter,
    clearFilters,
    setSort,
    setPage,
    setPageSize,
    tableSort,
    setTableSort,
    getFilter,
    isFiltered,
  }
}
