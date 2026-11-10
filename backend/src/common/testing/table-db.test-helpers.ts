import type { DbClient } from '../../infrastructure/database/rls-client.factory'

type Row = Record<string, unknown>

/**
 * Test-only in-memory tables behind the Supabase client shape, for testing a module through its own
 * interface: reads honour `eq` / `is` filters, `order` and `range`, so a test states which rows exist
 * (in which company) rather than which query chain the module builds. Selected columns are not
 * projected; every matching row is returned whole. `failing` makes every read of a table fail.
 *
 * Read-only on purpose: writes belong to tests against local Postgres.
 */
export function tableDb(tables: Readonly<Record<string, readonly Row[]>>, failing: Readonly<Record<string, { code: string; message: string }>> = {}): DbClient {
  const client = {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = []
      let order: string | undefined
      let range: [number, number] | undefined
      const result = () => {
        const error = failing[table]
        if (error) return { data: null, error }
        let rows = (tables[table] ?? []).filter((row) => filters.every((keep) => keep(row)))
        if (order) rows = [...rows].sort((a, b) => String(a[order!]).localeCompare(String(b[order!])))
        if (range) rows = rows.slice(range[0], range[1] + 1)
        return { data: rows, error: null }
      }
      // A promise of the result, computed in a microtask, i.e. after the synchronous chain added its
      // filters; the builder methods are attached to it so the chain can be awaited at any point.
      const settled = Promise.resolve().then(result)
      const builder = Object.assign(settled, {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value)
          return builder
        },
        is: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value)
          return builder
        },
        order: (column: string) => {
          order = column
          return builder
        },
        range: (from: number, to: number) => {
          range = [from, to]
          return builder
        },
        maybeSingle: async () => {
          const { data, error } = result()
          if (error) return { data: null, error }
          if (data.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } }
          return { data: data[0] ?? null, error: null }
        },
      })
      return builder
    },
  }
  return client as unknown as DbClient
}
