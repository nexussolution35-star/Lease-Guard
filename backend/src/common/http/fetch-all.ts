import { httpErrorFromDatabase, type DatabaseErrorLike } from './database-errors'

/**
 * Rows per request. It must equal the Data API `max_rows` limit (supabase/config.toml): PostgREST
 * silently caps every response at that many rows, so a page shorter than this is the last one.
 */
export const DATA_API_MAX_ROWS = 1000

/**
 * Reads every row of a query, page by page, so a large result is never silently truncated at the Data
 * API row limit. `page` must build the query with a deterministic total order (ending in a unique
 * column, e.g. `.order('id')`) before `.range(from, to)`, otherwise rows can repeat or go missing
 * between pages. A database error becomes the matching HTTP error.
 *
 * Example: `fetchAllRows('List line items', (from, to) => db.from('t').select('*').order('id').range(from, to))`
 */
export async function fetchAllRows<T>(
  operation: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DatabaseErrorLike | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += DATA_API_MAX_ROWS) {
    const { data, error } = await page(from, from + DATA_API_MAX_ROWS - 1)
    if (error) throw httpErrorFromDatabase(error, operation)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < DATA_API_MAX_ROWS) return rows
  }
}
