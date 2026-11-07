/** Pure list-query helpers shared by every repository. No store or React imports. */

export type SortDirection = 'asc' | 'desc'

export interface ListQuery<T> {
  /** Case-insensitive substring match across `searchFields`. */
  search?: string
  searchFields?: readonly (keyof T)[]
  /** Equality filter; an array value means "IN". `undefined` values are ignored. */
  filters?: Partial<Record<keyof T, unknown | readonly unknown[]>>
  sort?: { field: keyof T; direction: SortDirection }
  /** 1-based page number. */
  page?: number
  pageSize?: number
}

export interface PagedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export const DEFAULT_PAGE_SIZE = 25

function isScalar(value: unknown): value is string | number | boolean {
  const t = typeof value
  return t === 'string' || t === 'number' || t === 'boolean'
}

function matchesSearch<T>(item: T, needle: string, fields: readonly (keyof T)[]): boolean {
  for (const field of fields) {
    const value = item[field]
    if (isScalar(value) && String(value).toLowerCase().includes(needle)) return true
  }
  return false
}

function matchesFilters<T>(item: T, filters: NonNullable<ListQuery<T>['filters']>): boolean {
  for (const key of Object.keys(filters) as (keyof T)[]) {
    const expected = filters[key]
    if (expected === undefined) continue
    const actual: unknown = item[key]
    if (Array.isArray(expected)) {
      if (!(expected as readonly unknown[]).includes(actual)) return false
    } else if (actual !== expected) {
      return false
    }
  }
  return true
}

/**
 * Compare two field values for sorting. `undefined`/`null` always sort last regardless of
 * direction; numbers compare numerically; everything else compares as strings (ISO dates
 * sort correctly this way).
 */
export function compareValues(a: unknown, b: unknown): number {
  const aMissing = a === undefined || a === null
  const bMissing = b === undefined || b === null
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return String(a).localeCompare(String(b), 'en-ZA')
}

export function applyQuery<T>(items: readonly T[], query: ListQuery<T> = {}): PagedResult<T> {
  let result = [...items]

  const needle = query.search?.trim().toLowerCase()
  if (needle && query.searchFields && query.searchFields.length > 0) {
    const fields = query.searchFields
    result = result.filter((item) => matchesSearch(item, needle, fields))
  }

  if (query.filters) {
    const filters = query.filters
    result = result.filter((item) => matchesFilters(item, filters))
  }

  if (query.sort) {
    const { field, direction } = query.sort
    const sign = direction === 'desc' ? -1 : 1
    result.sort((a, b) => {
      const av = a[field]
      const bv = b[field]
      const missingA = av === undefined || av === null
      const missingB = bv === undefined || bv === null
      // Missing values stay last in both directions.
      if (missingA || missingB) return compareValues(av, bv)
      return sign * compareValues(av, bv)
    })
  }

  const total = result.length
  const pageSize = Math.max(1, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE))
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, Math.floor(query.page ?? 1)), pageCount)
  const start = (page - 1) * pageSize

  return { items: result.slice(start, start + pageSize), total, page, pageSize, pageCount }
}
