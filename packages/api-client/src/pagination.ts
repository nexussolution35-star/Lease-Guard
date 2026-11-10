/** Shape of every paginated list response (`items`, `total`, `page`, `pageSize`). */
export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export function pageCount(page: Pick<Page<unknown>, 'total' | 'pageSize'>): number {
  return page.total === 0 ? 1 : Math.ceil(page.total / page.pageSize)
}

/** Drops undefined, null and empty-string values so they are not sent as query parameters. */
export function compactQuery<T extends Record<string, unknown>>(query: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as Partial<T>
}
