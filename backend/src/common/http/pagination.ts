import type { Type } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { z } from 'zod'

import { httpErrorFromDatabase, type DatabaseErrorLike } from './database-errors'

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100
export const SORT_DIRECTIONS = ['asc', 'desc'] as const
export type SortDirection = (typeof SORT_DIRECTIONS)[number]

/** Paging and free-text search shared by every list endpoint. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z
    .string()
    .trim()
    .max(100)
    .transform((value) => value || undefined)
    .optional(),
  direction: z.enum(SORT_DIRECTIONS).default('asc'),
})

/** Adds an allow-listed `sort` field and endpoint-specific filters to the shared paging schema. */
export function listQuerySchema<const S extends readonly [string, ...string[]], F extends z.ZodRawShape>(
  sortFields: S,
  filters: F,
) {
  return pageQuerySchema.extend({ sort: z.enum(sortFields).optional(), ...filters })
}

/** OpenAPI description of the shared query parameters. Extend it per endpoint. */
export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  page!: number

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  pageSize!: number

  @ApiPropertyOptional({ maxLength: 100, description: 'Case-insensitive text search' })
  search?: string

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS, enumName: 'SortDirection', default: 'asc' })
  direction!: SortDirection
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** Inclusive row range for PostgREST `.range(from, to)`. */
export function rangeFor(query: { page: number; pageSize: number }): [from: number, to: number] {
  const from = (query.page - 1) * query.pageSize
  return [from, from + query.pageSize - 1]
}

export function toPage<Row, T>(
  rows: readonly Row[] | null,
  count: number | null,
  query: { page: number; pageSize: number },
  map: (row: Row) => T,
): Page<T> {
  return { items: (rows ?? []).map(map), total: count ?? 0, page: query.page, pageSize: query.pageSize }
}

/** PostgREST answers 416 / PGRST103 when the requested page starts after the last row. */
export const PAGE_OUT_OF_RANGE_CODE = 'PGRST103'

export function isPageOutOfRange(error: Pick<DatabaseErrorLike, 'code'> | null): boolean {
  return error?.code === PAGE_OUT_OF_RANGE_CODE
}

/**
 * The page a client asked for starts after the last row (e.g. rows were deleted while paging): return
 * an empty page with the real total so the client can move back, instead of an error. PostgREST sends
 * no count with the 416, so `countQuery` re-runs the same filtered query for its first row only.
 */
export async function emptyPageWithTotal<T>(
  countQuery: PromiseLike<{ count: number | null; error: DatabaseErrorLike | null }>,
  query: { page: number; pageSize: number },
  operation: string,
): Promise<Page<T>> {
  const { count, error } = await countQuery
  if (error) throw httpErrorFromDatabase(error, operation)
  return { items: [], total: count ?? 0, page: query.page, pageSize: query.pageSize }
}

/** Builds a named OpenAPI page schema (`PropertyPage`) for one item DTO. */
export function createPageDto<T>(itemType: Type<T>, name: string): Type<Page<T>> {
  class PageDto implements Page<T> {
    @ApiProperty({ type: () => [itemType] })
    items!: T[]

    @ApiProperty({ minimum: 0 })
    total!: number

    @ApiProperty({ minimum: 1 })
    page!: number

    @ApiProperty({ minimum: 1 })
    pageSize!: number
  }
  Object.defineProperty(PageDto, 'name', { value: name })
  return PageDto
}

/** A double-quoted PostgREST filter value, with `"` and `\` escaped. */
function quotedValue(value: string): string {
  return `"${value.replace(/["\\]/g, (char) => `\\${char}`)}"`
}

/**
 * PostgREST `or` filter matching `term` literally and case-insensitively in any of `columns`. The value
 * is double-quoted, so commas, dots and parentheses cannot alter the filter expression.
 *
 * Normally `ilike "%term%"` with the LIKE wildcards `%` and `_` escaped. PostgREST rewrites every `*` in
 * a like/ilike value to `%` and offers no escape for it, so a term containing `*` is matched with
 * `imatch` (`~*`) instead, with every regex metacharacter escaped: the same case-insensitive substring
 * match, in which `*` is a literal character.
 */
export function searchFilter(columns: readonly string[], term: string): string {
  if (term.includes('*')) {
    const pattern = quotedValue(term.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`))
    return columns.map((column) => `${column}.imatch.${pattern}`).join(',')
  }
  const pattern = quotedValue(`%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
  return columns.map((column) => `${column}.ilike.${pattern}`).join(',')
}
