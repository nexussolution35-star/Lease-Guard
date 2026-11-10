/** A PostgREST / Postgres error as returned by supabase-js. */
export interface DbError {
  code: string
  message: string
}

/** A worker database operation failed. Retryable: the job is retried with backoff. */
export class WorkerDatabaseError extends Error {
  readonly code: string

  constructor(operation: string, error: DbError) {
    super(`${operation} failed (${error.code}): ${error.message}`)
    this.name = 'WorkerDatabaseError'
    this.code = error.code
  }
}

/** Returns `data` or throws WorkerDatabaseError. A null `data` without error becomes `fallback`. */
export function unwrap<T, F>(result: { data: T | null; error: DbError | null }, operation: string, fallback: F): T | F {
  if (result.error) throw new WorkerDatabaseError(operation, result.error)
  return result.data ?? fallback
}

/** Rows per request; matches the Data API `max_rows` limit (supabase/config.toml). */
export const PAGE_SIZE = 1000

/**
 * Reads every row of a query page by page, so a large company is never silently truncated at the Data
 * API row limit. `page` must apply a stable order (e.g. `.order('id')`) before `.range(from, to)`.
 */
export async function fetchAll<T>(
  operation: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const batch: T[] = unwrap(await page(from, from + PAGE_SIZE - 1), operation, [])
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
}

/** Splits `items` into arrays of at most `size` (keeps request URLs and bodies bounded). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
