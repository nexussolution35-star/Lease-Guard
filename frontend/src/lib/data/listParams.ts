import type { Page } from '@leaseguard/api-client'

import type { SortDirection } from '@/services/query'

export type { Page, SortDirection }

/** Default and maximum page sizes, matching the backend's shared list query (`common/http/pagination.ts`). */
export const DEFAULT_LIST_PAGE_SIZE = 25
export const MAX_LIST_PAGE_SIZE = 100
export const LIST_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50, 100]

/**
 * Paging, search and sort shared by every list data source. Mirrors the backend list query
 * (`page`, `pageSize`, `search`, `sort`, `direction`); features extend it with their filters, each a
 * single optional value exactly as the API accepts it.
 */
export interface ListParams<TSort extends string = string> {
  /** 1-based. */
  page: number
  pageSize: number
  search?: string
  sort?: TSort
  direction?: SortDirection
}

/** Number of pages for a page response (at least 1). */
export function pageCountOf(page: Pick<Page<unknown>, 'total' | 'pageSize'>): number {
  return page.total === 0 ? 1 : Math.ceil(page.total / Math.max(1, page.pageSize))
}

/**
 * The last page to move to when `requestedPage` lies past the end of a list that has records (a stale
 * `?page=` link, a workspace switch, records removed elsewhere); null when the page is in range or the
 * list is empty. The API answers such a page with `{ items: [], total }`.
 */
export function lastPageWhenPastEnd(requestedPage: number, page: Pick<Page<unknown>, 'total' | 'pageSize'>): number | null {
  if (page.total === 0) return null
  const last = pageCountOf(page)
  return requestedPage > last ? last : null
}

/** Longest search the list endpoints accept (backend `common/http/pagination.ts`). */
export const MAX_LIST_SEARCH_LENGTH = 100

/**
 * The search term a data source sends: trimmed and capped at `MAX_LIST_SEARCH_LENGTH` UTF-16 units
 * (the backend's limit), undefined when blank. A cut that would split a surrogate pair (e.g. an emoji)
 * drops the lone high surrogate, which could not be URL-encoded. Only data sources normalise; the URL
 * and the search box keep the text exactly as typed.
 */
export function listSearchTerm(search: string | undefined): string | undefined {
  const term = search
    ?.trim()
    .slice(0, MAX_LIST_SEARCH_LENGTH)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trimEnd()
  return term ? term : undefined
}
