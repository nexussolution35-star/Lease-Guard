/** List-query state types shared by table components. No store or React imports. */

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

export const DEFAULT_PAGE_SIZE = 25
