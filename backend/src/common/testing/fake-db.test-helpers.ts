import type { DbClient } from '../../infrastructure/database/rls-client.factory'

/** One recorded builder call, e.g. `['eq', ['company_id', 'c1']]`. */
export type BuilderCall = [method: string, args: unknown[]]

export interface RecordedQuery {
  table: string
  calls: BuilderCall[]
}

export interface FakeResult {
  data: unknown
  error: { code: string; message: string; details?: string | null; hint?: string | null } | null
  count?: number | null
}

/**
 * Test-only stand-in for a Supabase client. Every `from(table)` chain is recorded, and awaiting the chain
 * (or calling `single`/`maybeSingle`) resolves to the next result produced by `respond`. A database
 * function call `rpc(fn, args)` is recorded as the query `{ table: 'rpc:<fn>', calls: [['rpc', [args]]] }`.
 *
 * Example: `const db = fakeDb(() => ({ data: [row], error: null, count: 1 }))`, then assert on `db.queries`.
 */
export function fakeDb(respond: (query: RecordedQuery) => FakeResult): { client: DbClient; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = []

  const chain = (query: RecordedQuery): unknown => {
    const resolve = (): Promise<FakeResult> => Promise.resolve(respond(query))
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'then') {
            return (onFulfilled: (value: FakeResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
              resolve().then(onFulfilled, onRejected)
          }
          return (...args: unknown[]) => {
            query.calls.push([String(property), args])
            return property === 'single' || property === 'maybeSingle' ? resolve() : proxy
          }
        },
      },
    )
    return proxy
  }

  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, calls: [] }
      queries.push(query)
      return chain(query)
    },
    rpc(fn: string, args: unknown) {
      const query: RecordedQuery = { table: `rpc:${fn}`, calls: [['rpc', [args]]] }
      queries.push(query)
      return chain(query)
    },
  }
  return { client: client as unknown as DbClient, queries }
}

/** The arguments of a recorded `rpc(fn, args)` call. */
export function rpcArgs(query: RecordedQuery): Record<string, unknown> {
  return (callsTo(query, 'rpc')[0]?.[0] ?? {}) as Record<string, unknown>
}

/** The arguments of every recorded call to `method`. */
export function callsTo(query: RecordedQuery, method: string): unknown[][] {
  return query.calls.filter(([name]) => name === method).map(([, args]) => args)
}

/**
 * Simulates how the Data API answers `query` over `rows`: the slice selected by `.range(from, to)`,
 * capped at `maxRows` (supabase/config.toml `max_rows`) like PostgREST does, also without a range.
 */
export function dataApiPage<T>(rows: readonly T[], query: RecordedQuery, maxRows = 1000): T[] {
  const [from, to] = (callsTo(query, 'range').at(-1) ?? [0, rows.length - 1]) as [number, number]
  return rows.slice(from, Math.min(to + 1, from + maxRows))
}
